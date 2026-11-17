import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany } from "@/lib/auth";
import { decidePrice, decideSchema } from "@/lib/price-decisions";
import { actorLabel, notifyManagers } from "@/lib/notify";

async function guard(req: NextRequest) {
  const user = await getCurrentUser(req);
  // Le patron choisit ; le gérant peut consulter
  if (user.role !== "COMPANY_OWNER" && user.role !== "CENTER_MANAGER") throw new ApiError(403, "Réservé à la direction");
  return { user, companyId: requireCompany(user) };
}

// GET /api/price-decisions/[id] — Le détail pour choisir
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, companyId } = await guard(req);
    const { id } = await params;
    const d = await prisma.priceDecision.findFirst({ where: { id, companyId } });
    if (!d) throw new ApiError(404, "Décision introuvable");
    const [product, proposer, decider, receipt] = await Promise.all([
      prisma.product.findUniqueOrThrow({
        where: { id: d.productId },
        select: {
          name: true,
          sellingPrice: true,
          pendingPrice: true,
          pendingPriceLeft: true,
          baseUnit: { select: { symbol: true } },
          unitConversions: { select: { fromUnitId: true, factor: true, sellingPrice: true, fromUnit: { select: { symbol: true, name: true } } } },
        },
      }),
      prisma.user.findUnique({ where: { id: d.proposedById }, select: { firstName: true, lastName: true } }),
      d.decidedById ? prisma.user.findUnique({ where: { id: d.decidedById }, select: { firstName: true, lastName: true } }) : null,
      prisma.goodsReceipt.findUnique({ where: { id: d.receiptId }, select: { receivedAt: true, supplier: { select: { name: true } } } }),
    ]);
    const sold = await prisma.saleLine.aggregate({
      where: { productId: d.productId, sale: { createdAt: { gte: d.createdAt }, status: { not: "CANCELLED" } } },
      _sum: { baseQuantity: true },
    });
    return NextResponse.json({
      success: true,
      data: {
        ...d,
        canDecide: user.role === "COMPANY_OWNER",
        product,
        oldLeft: Math.max(0, Number(d.oldQty) - Number(sold._sum.baseQuantity ?? 0)),
        proposedBy: proposer ? `${proposer.firstName} ${proposer.lastName}`.trim() : null,
        decidedBy: decider ? `${decider.firstName} ${decider.lastName}`.trim() : null,
        receipt,
      },
    });
  } catch (error) {
    return handleApiError(error, "PRICE_DECISIONS");
  }
}

// POST /api/price-decisions/[id] — Le patron choisit le prix : il entre dans le système
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, companyId } = await guard(req);
    if (user.role !== "COMPANY_OWNER") throw new ApiError(403, "C'est le patron qui choisit le prix");
    const { id } = await params;
    const { price, packagings } = parseBody(decideSchema, await readJson(req));
    const result = await decidePrice({ decisionId: id, companyId, userId: user.id, price, packagings });
    const d = await prisma.priceDecision.findUniqueOrThrow({ where: { id }, select: { centerId: true, productId: true, proposedById: true } });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: d.productId }, select: { name: true } });
    notifyManagers({
      companyId,
      centerId: d.centerId,
      actorId: user.id,
      type: "PRICE_CHANGED",
      title: `Prix choisi — ${product.name} : ${price.toLocaleString("fr-FR")} F`,
      message: result.applied
        ? `${await actorLabel(user.id)} a fixé le prix de vente à ${price.toLocaleString("fr-FR")} F. C'est déjà le prix à la caisse.`
        : `${await actorLabel(user.id)} a fixé le prix du nouveau stock à ${price.toLocaleString("fr-FR")} F. L'ancien stock garde son prix : le nouveau passera tout seul à la caisse quand il sera vendu.`,
      link: `/prix/${id}`,
      data: { decisionId: id, productId: d.productId },
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, "PRICE_DECISIONS");
  }
}

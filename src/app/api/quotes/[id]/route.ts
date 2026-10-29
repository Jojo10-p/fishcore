import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";

// GET /api/quotes/[id] — Devis complet (impression A4, chargement à la caisse)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "quote:view");
    const companyId = requireCompany(user);
    const { id } = await params;

    const quote = await prisma.quote.findFirst({
      where: { id, companyId },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true, address: true, taxId: true } },
        sale: { select: { id: true, saleNumber: true } },
        lines: {
          orderBy: { position: "asc" },
          include: { product: { select: { name: true, barcode: true, baseUnitId: true, baseUnit: { select: { symbol: true } } } } },
        },
      },
    });
    if (!quote) throw new ApiError(404, "Devis introuvable");
    // Pas de restriction par centre : le client peut présenter son devis
    // dans n'importe quelle agence de l'entreprise (l'entreprise reste vérifiée).

    const [company, center, author, units] = await Promise.all([
      prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: {
          tradeName: true,
          legalName: true,
          logoUrl: true,
          phone: true,
          email: true,
          address: true,
          city: true,
          poBox: true,
          taxId: true,
          tradeRegNumber: true,
          currency: true,
          vatEnabled: true,
          invoiceNotes: true,
        },
      }),
      prisma.center.findUnique({ where: { id: quote.centerId }, select: { name: true, address: true, city: true, phone: true } }),
      prisma.user.findUnique({ where: { id: quote.createdById }, select: { firstName: true, lastName: true } }),
      prisma.unit.findMany({ where: { id: { in: [...new Set(quote.lines.map((l) => l.unitId))] } }, select: { id: true, symbol: true } }),
    ]);
    const symbolOf = new Map(units.map((u) => [u.id, u.symbol]));

    return NextResponse.json({
      success: true,
      data: {
        ...quote,
        expired: quote.status === "OPEN" && quote.validUntil < new Date(),
        lines: quote.lines.map((l) => ({ ...l, unitSymbol: symbolOf.get(l.unitId) ?? l.product.baseUnit.symbol })),
        company,
        center,
        createdBy: author ? `${author.firstName} ${author.lastName}` : "",
      },
    });
  } catch (error) {
    return handleApiError(error, "QUOTES");
  }
}

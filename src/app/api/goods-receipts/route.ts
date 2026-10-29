import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { goodsReceiptSchema } from "@/lib/validations";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
  resolveCenterScope,
} from "@/lib/auth";

// POST /api/goods-receipts — Créer une réception (brouillon : le stock n'augmente
// qu'à la validation, cahier §8.3)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:receive");
    const companyId = requireCompany(user);
    const data = parseBody(goodsReceiptSchema, await readJson(req));
    await requireCenterAccess(user, data.centerId);

    // Produits, fournisseur et achat doivent appartenir à l'entreprise
    const productIds = [...new Set(data.lines.map((l) => l.productId))];
    const productCount = await prisma.product.count({ where: { id: { in: productIds }, companyId } });
    if (productCount !== productIds.length) throw new ApiError(400, "Produit invalide dans la réception");

    if (data.supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: data.supplierId, companyId }, select: { id: true } });
      if (!supplier) throw new ApiError(400, "Fournisseur introuvable");
    }
    if (data.purchaseId) {
      const purchase = await prisma.purchase.findFirst({
        where: { id: data.purchaseId, centerId: data.centerId },
        select: { id: true },
      });
      if (!purchase) throw new ApiError(400, "Achat introuvable pour ce centre");
    }

    const receipt = await prisma.goodsReceipt.create({
      data: {
        centerId: data.centerId,
        supplierId: data.supplierId,
        purchaseId: data.purchaseId,
        reference: data.reference,
        receivedAt: data.receivedAt,
        transportCost: data.transportCost,
        iceCost: data.iceCost,
        handlingCost: data.handlingCost,
        otherCosts: data.otherCosts,
        notes: data.notes,
        createdById: user.id,
        isDraft: true,
        isValidated: false,
        lines: {
          create: data.lines.map((line) => ({
            productId: line.productId,
            packageCount: line.packageCount,
            grossWeight: line.grossWeight,
            quantity: line.quantity,
            unitId: line.unitId,
            unitPrice: line.unitPrice,
            totalPrice: line.totalPrice,
            lotNumber: line.lotNumber || null,
            expiresAt: line.expiresAt ?? null,
          })),
        },
      },
      include: { lines: { include: { product: { select: { name: true } } } } },
    });

    return NextResponse.json({ success: true, data: receipt }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "GOODS_RECEIPTS");
  }
}

// GET /api/goods-receipts — Réceptions des centres visibles
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:view");
    const companyId = requireCompany(user);

    const { searchParams } = new URL(req.url);
    const validated = searchParams.get("validated");
    const centerScope = await resolveCenterScope(user, searchParams.get("centerId"));

    const receipts = await prisma.goodsReceipt.findMany({
      where: {
        center: { companyId },
        ...(centerScope ? { centerId: centerScope } : {}),
        ...(validated !== null ? { isValidated: validated === "true" } : {}),
      },
      include: {
        lines: { include: { product: { select: { name: true, baseUnit: { select: { symbol: true } } } } } },
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ success: true, data: receipts });
  } catch (error) {
    return handleApiError(error, "GOODS_RECEIPTS");
  }
}

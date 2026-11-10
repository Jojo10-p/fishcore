import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, requireCenterAccess, requireCompany, requirePermission } from "@/lib/auth";

// GET /api/stock/overview?centerId=… — La page Stock en un coup d'œil : tous les
// articles de la boutique (disponibles ou épuisés), le stock, le prix de vente de
// chaque format et le dernier prix d'achat noté chez le fournisseur.
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:view");
    const companyId = requireCompany(user);
    const centerId = req.nextUrl.searchParams.get("centerId");
    if (!centerId) throw new ApiError(400, "centerId requis");
    await requireCenterAccess(user, centerId);

    const products = await prisma.product.findMany({
      where: { companyId, isActive: true, OR: [{ centerId: null }, { centerId }] },
      select: {
        id: true,
        name: true,
        sellingPrice: true,
        purchasePrice: true,
        stockAlertQty: true,
        baseUnit: { select: { id: true, name: true, symbol: true, allowsDecimal: true } },
        unitConversions: { select: { factor: true, sellingPrice: true, fromUnit: { select: { name: true, symbol: true } } } },
        stocks: { where: { centerId }, select: { quantity: true, reservedQty: true } },
      },
      orderBy: { name: "asc" },
    });

    // Dernier achat validé de chaque article (prix noté, fournisseur, date)
    const lines = products.length
      ? await prisma.goodsReceiptLine.findMany({
          where: { productId: { in: products.map((p) => p.id) }, receipt: { centerId, isValidated: true } },
          select: {
            productId: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            receipt: { select: { validatedAt: true, receivedAt: true, supplier: { select: { name: true, phone: true } } } },
          },
          orderBy: { receipt: { validatedAt: "desc" } },
          take: 3000,
        })
      : [];
    const last = new Map<string, (typeof lines)[number]>();
    for (const l of lines) if (!last.has(l.productId)) last.set(l.productId, l);

    const data = products.map((p) => {
      const s = p.stocks[0];
      const l = last.get(p.id);
      return {
        id: p.id,
        name: p.name,
        unit: p.baseUnit,
        sellingPrice: Number(p.sellingPrice),
        stockAlertQty: Number(p.stockAlertQty),
        quantity: Number(s?.quantity ?? 0),
        reserved: Number(s?.reservedQty ?? 0),
        packagings: p.unitConversions.map((c) => ({ name: c.fromUnit.name, symbol: c.fromUnit.symbol, factor: Number(c.factor), sellingPrice: c.sellingPrice != null ? Number(c.sellingPrice) : null })),
        lastPurchase: l
          ? {
              unitPrice: Number(l.unitPrice),
              quantity: Number(l.quantity),
              total: Number(l.totalPrice),
              date: l.receipt.validatedAt ?? l.receipt.receivedAt,
              supplier: l.receipt.supplier?.name ?? null,
              supplierPhone: l.receipt.supplier?.phone ?? null,
            }
          : Number(p.purchasePrice) > 0
            ? { unitPrice: Number(p.purchasePrice), quantity: null, total: null, date: null, supplier: null, supplierPhone: null }
            : null,
      };
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, "STOCK");
  }
}

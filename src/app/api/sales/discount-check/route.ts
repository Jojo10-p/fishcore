import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCenterAccess, requireCompany, requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { priceLines } from "@/lib/sales";

const schema = z.object({
  centerId: z.string().min(1),
  cartDiscount: z.coerce.number().min(0),
  lines: z.array(z.object({ productId: z.string().min(1), unitId: z.string().optional(), quantity: z.coerce.number().positive() })).min(1).max(200),
});

// POST /api/sales/discount-check — Avec cette réduction, reste-t-on en bénéfice ?
// Simple indication à la caisse : ne bloque jamais la vente. Le caissier voit
// seulement « bénéfice » ou « vente à perte » ; le gérant et la direction voient les montants.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);
    const { centerId, cartDiscount, lines } = parseBody(schema, await readJson(req));
    await requireCenterAccess(user, centerId);

    const pricing = await priceLines(companyId, lines.map((l) => ({ ...l, unitPrice: 0 })), false);
    const stocks = await prisma.stock.findMany({
      where: { centerId, productId: { in: [...pricing.baseQtyByProduct.keys()] } },
      select: { productId: true, avgCost: true },
    });
    const avg = new Map(stocks.map((s) => [s.productId, new Prisma.Decimal(s.avgCost)]));
    let cost = new Prisma.Decimal(0);
    for (const [productId, qty] of pricing.baseQtyByProduct) {
      const a = avg.get(productId);
      const unit = a && a.gt(0) ? a : pricing.productInfo.get(productId)!.purchasePrice;
      cost = cost.add(unit.mul(qty));
    }
    const total = Number(pricing.totalAmount);
    if (cartDiscount >= total) throw new ApiError(400, "La réduction doit être inférieure au total", "INVALID_DISCOUNT");
    const after = total - cartDiscount;
    const taxAfter = total > 0 ? (Number(pricing.taxAmount) * after) / total : 0;
    const margin = Math.round((after - taxAfter - Number(cost)) * 100) / 100;
    const showAmounts = hasPermission(user.role, "report:view");
    return NextResponse.json({
      success: true,
      data: {
        status: margin > 0 ? "PROFIT" : "LOSS",
        total,
        after,
        // Réduction d'un caissier : la vente passe, la réduction est à valider
        needsValidation: !hasPermission(user.role, "sale:discount"),
        ...(showAmounts ? { margin, cost: Math.round(Number(cost)) } : {}),
      },
    });
  } catch (error) {
    return handleApiError(error, "SALES/DISCOUNT");
  }
}

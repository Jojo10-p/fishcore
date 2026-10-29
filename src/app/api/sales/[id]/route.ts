import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

// GET /api/sales/[id] — Détail d'une vente (reçu)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:view");
    const companyId = requireCompany(user);
    const { id } = await params;

    const sale = await prisma.sale.findFirst({
      where: { id, companyId },
      include: {
        lines: { include: { product: { select: { name: true, baseUnit: { select: { symbol: true } } } } } },
        payments: true,
        refunds: true,
        cashier: { select: { firstName: true, lastName: true } },
        session: { select: { cashRegister: { select: { name: true, center: { select: { name: true, address: true, city: true, phone: true } } } } } },
      },
    });
    if (!sale) throw new ApiError(404, "Vente introuvable");
    await requireCenterAccess(user, sale.centerId);
    if (!hasPermission(user.role, "sale:view_all") && sale.cashierId !== user.id) {
      throw new ApiError(404, "Vente introuvable");
    }

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { tradeName: true, legalName: true, logoUrl: true, phone: true, address: true, city: true, taxId: true, tradeRegNumber: true, currency: true, vatEnabled: true },
    });

    // Symbole de l'unité vendue (unité de base ou conditionnement : carton, boîte…)
    const unitIds = [...new Set(sale.lines.map((l) => l.unitId).filter((u): u is string => !!u))];
    const units = await prisma.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, symbol: true } });
    const symbolOf = new Map(units.map((u) => [u.id, u.symbol]));
    // Lots délivrés (traçabilité pharmacie / alimentaire : rappel de lot possible)
    const lotMovements = await prisma.stockMovement.findMany({
      where: { referenceType: "Sale", referenceId: sale.id, type: "SALE", batchId: { not: null } },
      select: { quantity: true, stock: { select: { productId: true } }, batch: { select: { lotNumber: true, expiresAt: true } } },
    });
    const lines = sale.lines.map((l) => ({
      ...l,
      unitSymbol: (l.unitId && symbolOf.get(l.unitId)) || l.product.baseUnit.symbol,
      lots: lotMovements
        .filter((m) => m.stock.productId === l.productId && m.batch)
        .map((m) => ({ lotNumber: m.batch!.lotNumber, expiresAt: m.batch!.expiresAt, quantity: m.quantity.negated().toString() })),
    }));

    return NextResponse.json({ success: true, data: { ...sale, lines, company } });
  } catch (error) {
    return handleApiError(error, "SALES");
  }
}

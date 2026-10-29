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
      select: { tradeName: true, legalName: true, logoUrl: true, phone: true, address: true, city: true, taxId: true, tradeRegNumber: true, currency: true },
    });

    return NextResponse.json({ success: true, data: { ...sale, company } });
  } catch (error) {
    return handleApiError(error, "SALES");
  }
}

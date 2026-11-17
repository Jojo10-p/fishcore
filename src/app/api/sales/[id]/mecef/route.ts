import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, requireCenterAccess, requireCompany, requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { emitCreditNote, emitSale, mecefActive, saleMecef } from "@/lib/mecef";

// POST /api/sales/[id]/mecef — Renvoyer à la DGI la facture normalisée d'une vente
// (restée en attente ou refusée après correction des réglages), et son avoir si annulée.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:view");
    const companyId = requireCompany(user);
    const { id } = await params;
    const sale = await prisma.sale.findFirst({ where: { id, companyId }, select: { id: true, centerId: true, cashierId: true, status: true } });
    if (!sale) throw new ApiError(404, "Vente introuvable");
    await requireCenterAccess(user, sale.centerId);
    if (!hasPermission(user.role, "sale:view_all") && sale.cashierId !== user.id) throw new ApiError(404, "Vente introuvable");
    if (!(await mecefActive(companyId))) throw new ApiError(409, "La facture normalisée e-MECeF n'est pas activée (Paramètres)", "MECEF_OFF");

    const current = await saleMecef(sale.id);
    // Une vente annulée avant d'avoir été normalisée n'a rien à envoyer
    if (sale.status !== "CANCELLED" || current.invoice) await emitSale(companyId, sale.id, true);
    if (sale.status === "CANCELLED") await emitCreditNote(companyId, sale.id, undefined, true);
    return NextResponse.json({ success: true, data: await saleMecef(sale.id) });
  } catch (error) {
    return handleApiError(error, "MECEF");
  }
}

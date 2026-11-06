import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, requireCenterAccess, requireCompany, requirePermission } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { sessionJournal } from "@/lib/cash-journal";

// GET /api/cash/sessions/[id]/journal — Journal d'une caisse fermée.
// La direction et le gérant : toutes les caisses, à tout moment. Le caissier : les siennes.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "cash:view_session");
    const companyId = requireCompany(user);
    const { id } = await params;
    const session = await prisma.cashSession.findFirst({
      where: { id, cashRegister: { center: { companyId } } },
      select: { cashierId: true, cashRegister: { select: { centerId: true } } },
    });
    if (!session) throw new ApiError(404, "Caisse introuvable");
    await requireCenterAccess(user, session.cashRegister.centerId);
    if (session.cashierId !== user.id && !hasPermission(user.role, "cash:view_all_sessions")) {
      throw new ApiError(404, "Caisse introuvable");
    }
    const journal = await sessionJournal(id);
    if (!journal) throw new ApiError(409, "Cette caisse n'est pas encore fermée", "NOT_CLOSED");
    return NextResponse.json({ success: true, data: journal });
  } catch (error) {
    return handleApiError(error, "CASH");
  }
}

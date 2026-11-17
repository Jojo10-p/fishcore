import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, requireCenterAccess, requireCompany } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";

/** Le demandeur, et ceux qui décident des annulations dans cette boutique. */
export async function loadThread(req: NextRequest, id: string) {
  const user = await getCurrentUser(req);
  const companyId = requireCompany(user);
  const c = await prisma.cancellation.findFirst({
    where: { id, sale: { companyId } },
    select: { id: true, status: true, requesterId: true, sale: { select: { id: true, saleNumber: true, centerId: true, companyId: true } } },
  });
  if (!c) throw new ApiError(404, "Demande introuvable");
  const decider = hasPermission(user.role, "sale:cancel_approve");
  if (!decider && c.requesterId !== user.id) throw new ApiError(404, "Demande introuvable");
  if (decider) await requireCenterAccess(user, c.sale.centerId);
  return { user, c, decider };
}

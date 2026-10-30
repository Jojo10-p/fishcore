import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { createResetLink, publicOrigin, RESET_LINK_HOURS } from "@/lib/password-reset";
import { ApiError, getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/users/[id]/reset-link — Lien de réinitialisation du mot de passe
// d'un employé, à lui envoyer par WhatsApp ou SMS (valable 24 h, usage unique).
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "user:edit");
    const companyId = requireCompany(user);
    const { id } = await params;
    const target = await prisma.user.findFirst({ where: { id, companyId }, select: { id: true, role: true, isActive: true, firstName: true, lastName: true } });
    if (!target) throw new ApiError(404, "Utilisateur introuvable");
    if (target.role === "COMPANY_OWNER" && user.role !== "COMPANY_OWNER") throw new ApiError(403, "Seul un propriétaire peut réinitialiser un propriétaire", "FORBIDDEN");
    if (!target.isActive) throw new ApiError(400, "Réactivez d'abord ce compte", "USER_INACTIVE");

    const link = await prisma.$transaction(async (tx) => {
      const created = await createResetLink(target.id, user.id, publicOrigin(req.nextUrl.origin), tx);
      await writeAuditLog(
        {
          eventType: "PASSWORD_RESET_LINK_CREATED",
          companyId,
          userId: user.id,
          referenceType: "User",
          referenceId: target.id,
          result: "SUCCESS",
          newValues: { for: `${target.firstName} ${target.lastName}`, expiresAt: created.expiresAt.toISOString() },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return created;
    });
    return NextResponse.json({ success: true, data: { ...link, hours: RESET_LINK_HOURS } }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "USERS");
  }
}

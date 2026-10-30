import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { updateUserSchema } from "@/lib/validations";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/users/[id] — Modifier un compte : identité, rôle, centres,
// désactivation / réactivation (un compte désactivé est déconnecté aussitôt).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    const companyId = requireCompany(user);
    const { id } = await params;
    const data = parseBody(updateUserSchema, await readJson(req));
    const deactivating = data.isActive === false;
    await requirePermission(user, deactivating ? "user:deactivate" : "user:edit");

    const target = await prisma.user.findFirst({
      where: { id, companyId },
      select: { id: true, role: true, isActive: true, firstName: true, lastName: true, phone: true, centers: { where: { isActive: true }, select: { centerId: true } } },
    });
    if (!target) throw new ApiError(404, "Utilisateur introuvable");
    const isOwner = user.role === "COMPANY_OWNER";
    if (!isOwner && (target.role === "COMPANY_OWNER" || data.role === "COMPANY_OWNER")) {
      throw new ApiError(403, "Seul le propriétaire peut modifier un compte propriétaire", "FORBIDDEN");
    }
    if (target.id === user.id && (data.isActive === false || (data.role && data.role !== target.role))) {
      throw new ApiError(400, "Vous ne pouvez ni désactiver votre propre compte ni changer votre rôle", "SELF_CHANGE");
    }
    // Un responsable n'agit que sur les employés de ses centres
    if (!isOwner && !target.centers.some((c) => user.centerIds.includes(c.centerId))) {
      throw new ApiError(403, "Ce compte n'est pas affecté à vos centres", "FORBIDDEN");
    }

    let centerIds: string[] | undefined;
    if (data.centerIds) {
      centerIds = [...new Set(data.centerIds)];
      if (!isOwner && centerIds.some((c) => !user.centerIds.includes(c))) throw new ApiError(403, "Vous ne pouvez affecter qu'à vos propres centres", "FORBIDDEN");
      const valid = await prisma.center.count({ where: { id: { in: centerIds }, companyId } });
      if (valid !== centerIds.length) throw new ApiError(400, "Un ou plusieurs centres sont invalides");
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Toujours au moins un propriétaire actif
      if (target.role === "COMPANY_OWNER" && ((data.role && data.role !== "COMPANY_OWNER") || deactivating)) {
        const owners = await tx.user.count({ where: { companyId, role: "COMPANY_OWNER", isActive: true, NOT: { id: target.id } } });
        if (owners === 0) throw new ApiError(400, "L'entreprise doit garder au moins un propriétaire actif", "LAST_OWNER");
      }
      const u = await tx.user.update({
        where: { id: target.id },
        data: {
          ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          ...(data.phone !== undefined ? { phone: data.phone || null } : {}),
          ...(data.role ? { role: data.role } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive, deactivatedAt: data.isActive ? null : new Date(), ...(data.isActive ? { loginAttempts: 0, lockedUntil: null } : {}) } : {}),
        },
        select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, isActive: true },
      });
      if (centerIds) {
        await tx.userCenter.deleteMany({ where: { userId: target.id, centerId: { notIn: centerIds } } });
        for (const centerId of centerIds) {
          await tx.userCenter.upsert({
            where: { userId_centerId: { userId: target.id, centerId } },
            create: { userId: target.id, centerId },
            update: { isActive: true },
          });
        }
      }
      if (deactivating) await tx.authSession.deleteMany({ where: { userId: target.id } });

      const event = deactivating ? "USER_DEACTIVATED" : data.isActive === true && !target.isActive ? "USER_REACTIVATED" : data.role && data.role !== target.role ? "ROLE_CHANGED" : "USER_UPDATED";
      await writeAuditLog(
        {
          eventType: event,
          companyId,
          userId: user.id,
          referenceType: "User",
          referenceId: target.id,
          result: "SUCCESS",
          oldValues: { role: target.role, isActive: target.isActive, centerIds: target.centers.map((c) => c.centerId) },
          newValues: { ...data, ...(centerIds ? { centerIds } : {}) },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return u;
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, "USERS");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/invitations/[id] — annuler un lien pas encore utilisé
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "user:create");
    const companyId = requireCompany(user);
    const { id } = await params;
    const r = await prisma.invitation.updateMany({ where: { id, companyId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new ApiError(404, "Invitation introuvable");
    await writeAuditLog({ eventType: "INVITATION_REVOKED", companyId, userId: user.id, referenceType: "Invitation", referenceId: id, result: "SUCCESS", ipAddress: user.ipAddress, userAgent: user.userAgent });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "USERS");
  }
}

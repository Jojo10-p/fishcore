import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError } from "@/lib/auth";
import { ROLE_NAMES, attachUserToInvitation, boutiqueMismatch, findValidInvitation } from "@/lib/invitations";

const MAX_TRIES = 5;

// POST /api/invitations/join { code } — un compte sans entreprise rejoint l'entreprise
// avec le code donné par le patron (comme le code de WhatsApp Web).
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (user.companyId) throw new ApiError(400, "Ce compte fait déjà partie d'une entreprise", "ALREADY_MEMBER");
    const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { joinAttempts: true, joinLockedUntil: true } });
    if (me.joinLockedUntil && me.joinLockedUntil > new Date()) {
      const min = Math.ceil((me.joinLockedUntil.getTime() - Date.now()) / 60000);
      throw new ApiError(429, `Trop de codes faux. Réessayez dans ${min} minute(s).`, "JOIN_LOCKED");
    }
    const body = (await req.json().catch(() => ({}))) as { code?: string; boutiqueId?: string };
    const raw = await findValidInvitation(String(body.code ?? ""));
    const wrongShop = raw.ok ? boutiqueMismatch(raw.invitation, body.boutiqueId) : null;
    const found = wrongShop ? ({ ok: false, error: wrongShop } as const) : raw;
    if (!found.ok) {
      const tries = me.joinAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: tries >= MAX_TRIES ? { joinAttempts: 0, joinLockedUntil: new Date(Date.now() + 15 * 60_000) } : { joinAttempts: tries },
      });
      throw new ApiError(400, tries >= MAX_TRIES ? "Trop de codes faux : réessayez dans 15 minutes." : found.error, "BAD_CODE");
    }
    let joined;
    try {
      joined = await attachUserToInvitation(found.invitation, user.id);
    } catch (e) {
      if ((e as Error).message === "INVITATION_USED") throw new ApiError(410, "Ce code a déjà servi.", "BAD_CODE");
      throw e;
    }
    await writeAuditLog({
      eventType: "INVITATION_ACCEPTED",
      companyId: joined.companyId ?? undefined,
      userId: user.id,
      referenceType: "Invitation",
      referenceId: found.invitation.id,
      result: "SUCCESS",
      newValues: { role: joined.role, via: "code" },
      ipAddress: user.ipAddress,
      userAgent: user.userAgent,
    });
    return NextResponse.json({ success: true, data: { companyName: found.invitation.company.tradeName, role: joined.role, roleName: ROLE_NAMES[joined.role] } });
  } catch (error) {
    return handleApiError(error, "USERS");
  }
}

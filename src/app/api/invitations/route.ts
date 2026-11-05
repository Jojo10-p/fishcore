import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, getCurrentUser, handleApiError, parseBody, readJson, requireCompany, requirePermission } from "@/lib/auth";
import { publicOrigin } from "@/lib/password-reset";
import { CODE_MINUTES, INVITATION_DAYS, formatCode, hashInviteToken, inviteUrl, newInviteCode, newInviteToken } from "@/lib/invitations";

const schema = z.object({
  role: z.enum(["COMPANY_OWNER", "CENTER_MANAGER", "CASHIER", "ACCOUNTANT", "STOCK_MANAGER", "SALES_EMPLOYEE"]),
  centerId: z.string().optional(),
  label: z.string().trim().max(60).optional(),
  /** « code » : à taper dans son compte (30 min) ; « link » : lien WhatsApp (7 jours). */
  kind: z.enum(["code", "link"]).default("code"),
});

// POST /api/invitations — créer un lien d'invitation (rôle + boutique)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "user:create");
    const companyId = requireCompany(user);
    const { role, centerId, label, kind } = parseBody(schema, await readJson(req));
    if (role === "COMPANY_OWNER" && user.role !== "COMPANY_OWNER") throw new ApiError(403, "Seul le propriétaire peut inviter un propriétaire", "FORBIDDEN");
    let center: string | null = null;
    if (role !== "COMPANY_OWNER") {
      if (!centerId) throw new ApiError(400, "Choisissez la boutique");
      const c = await prisma.center.findFirst({ where: { id: centerId, companyId }, select: { id: true } });
      if (!c) throw new ApiError(400, "Boutique invalide");
      if (user.role !== "COMPANY_OWNER" && !user.centerIds.includes(centerId)) throw new ApiError(403, "Vous ne pouvez inviter que dans vos boutiques", "FORBIDDEN");
      center = centerId;
    }
    const token = kind === "code" ? newInviteCode() : newInviteToken();
    const expiresAt = new Date(Date.now() + (kind === "code" ? CODE_MINUTES * 60_000 : INVITATION_DAYS * 24 * 3600_000));
    const inv = await prisma.invitation.create({
      data: { companyId, centerId: center, role, label: label || null, tokenHash: hashInviteToken(token), createdById: user.id, expiresAt },
    });
    await writeAuditLog({
      eventType: "INVITATION_CREATED",
      companyId,
      userId: user.id,
      referenceType: "Invitation",
      referenceId: inv.id,
      result: "SUCCESS",
      newValues: { role, centerId: center, label: label ?? null, kind },
      ipAddress: user.ipAddress,
      userAgent: user.userAgent,
    });
    const origin = publicOrigin(req.nextUrl.origin);
    return NextResponse.json(
      {
        success: true,
        data: kind === "code" ? { id: inv.id, code: formatCode(token), signupUrl: `${origin.replace(/\/$/, "")}/register`, expiresAt } : { id: inv.id, url: inviteUrl(origin, token), expiresAt },
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, "USERS");
  }
}

// GET /api/invitations — invitations en attente
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "user:view");
    const companyId = requireCompany(user);
    const list = await prisma.invitation.findMany({
      where: { companyId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, role: true, label: true, createdAt: true, expiresAt: true, center: { select: { name: true } }, createdBy: { select: { firstName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, data: list });
  } catch (error) {
    return handleApiError(error, "USERS");
  }
}

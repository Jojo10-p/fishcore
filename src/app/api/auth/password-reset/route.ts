import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { passwordResetSchema } from "@/lib/validations";
import { hashResetToken } from "@/lib/password-reset";
import { ApiError, handleApiError, parseBody, readJson, requestMeta } from "@/lib/auth";

async function findValid(token: string) {
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: { select: { id: true, firstName: true, isActive: true, companyId: true, company: { select: { tradeName: true } } } } },
  });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.isActive) {
    throw new ApiError(400, "Ce lien n'est plus valable : demandez-en un nouveau à votre responsable", "RESET_LINK_INVALID");
  }
  return row;
}

// GET /api/auth/password-reset?token= — Vérifie un lien (public)
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token") ?? "";
    if (token.length < 20) throw new ApiError(400, "Lien invalide", "RESET_LINK_INVALID");
    const row = await findValid(token);
    return NextResponse.json({ success: true, data: { firstName: row.user.firstName, companyName: row.user.company?.tradeName ?? null, expiresAt: row.expiresAt } });
  } catch (error) {
    return handleApiError(error, "PASSWORD_RESET");
  }
}

// POST /api/auth/password-reset — Nouveau mot de passe (public, lien à usage unique)
export async function POST(req: NextRequest) {
  try {
    const { token, password } = parseBody(passwordResetSchema, await readJson(req));
    const row = await findValid(token);
    const passwordHash = await bcrypt.hash(password, 12);
    const meta = requestMeta(req);

    await prisma.$transaction(async (tx) => {
      // Usage unique, même en cas de double clic
      const used = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count === 0) throw new ApiError(400, "Ce lien a déjà servi", "RESET_LINK_INVALID");
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, loginAttempts: 0, lockedUntil: null } });
      // Toutes les sessions ouvertes avec l'ancien mot de passe sont fermées
      await tx.authSession.deleteMany({ where: { userId: row.userId } });
      if (row.user.companyId) {
        await writeAuditLog(
          {
            eventType: "PASSWORD_CHANGED",
            companyId: row.user.companyId,
            userId: row.userId,
            referenceType: "User",
            referenceId: row.userId,
            result: "SUCCESS",
            newValues: { via: "lien de réinitialisation" },
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          },
          tx
        );
      }
    });
    return NextResponse.json({ success: true, data: { reset: true } });
  } catch (error) {
    return handleApiError(error, "PASSWORD_RESET");
  }
}

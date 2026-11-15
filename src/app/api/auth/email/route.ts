import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { changeEmailSchema } from "@/lib/validations";
import { ApiError, getCurrentUser, handleApiError, isUniqueViolation, parseBody, readJson } from "@/lib/auth";

// POST /api/auth/email — Changer sa propre adresse e-mail (mot de passe demandé).
// Mêmes mot de passe et données : seule l'adresse de connexion change.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const { password, newEmail } = parseBody(changeEmailSchema, await readJson(req));
    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, passwordHash: true } });
    if (!row || !(await bcrypt.compare(password, row.passwordHash))) throw new ApiError(400, "Mot de passe incorrect", "BAD_PASSWORD");
    if (newEmail === row.email) throw new ApiError(400, "C'est déjà votre adresse actuelle", "SAME_EMAIL");
    if (await prisma.user.count({ where: { email: newEmail } })) throw new ApiError(409, "Un compte avec cet email existe déjà", "EMAIL_TAKEN");

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { email: newEmail } });
      if (user.companyId) {
        await writeAuditLog(
          {
            eventType: "USER_UPDATED",
            companyId: user.companyId,
            userId: user.id,
            referenceType: "User",
            referenceId: user.id,
            result: "SUCCESS",
            oldValues: { email: row.email },
            newValues: { email: newEmail, via: "changement par l'utilisateur" },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
      }
    });
    return NextResponse.json({ success: true, data: { email: newEmail } });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ success: false, error: "Un compte avec cet email existe déjà" }, { status: 409 });
    return handleApiError(error, "EMAIL");
  }
}

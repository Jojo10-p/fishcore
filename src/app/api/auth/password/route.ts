import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { changePasswordSchema } from "@/lib/validations";
import { SESSION_COOKIE } from "@/lib/secrets";
import { ApiError, getCurrentUser, handleApiError, hashSessionToken, parseBody, readJson } from "@/lib/auth";

// POST /api/auth/password — Changer son propre mot de passe (les autres
// appareils connectés sont déconnectés, celui-ci reste connecté)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const { currentPassword, newPassword } = parseBody(changePasswordSchema, await readJson(req));
    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    if (!row || !(await bcrypt.compare(currentPassword, row.passwordHash))) throw new ApiError(400, "Mot de passe actuel incorrect", "BAD_PASSWORD");
    if (currentPassword === newPassword) throw new ApiError(400, "Choisissez un mot de passe différent de l'actuel", "SAME_PASSWORD");
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const current = req.cookies.get(SESSION_COOKIE)?.value;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.authSession.deleteMany({ where: { userId: user.id, ...(current ? { NOT: { sessionToken: hashSessionToken(current) } } : {}) } });
      if (user.companyId) {
        await writeAuditLog(
          {
            eventType: "PASSWORD_CHANGED",
            companyId: user.companyId,
            userId: user.id,
            referenceType: "User",
            referenceId: user.id,
            result: "SUCCESS",
            newValues: { via: "changement par l'utilisateur" },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
      }
    });
    return NextResponse.json({ success: true, data: { changed: true } });
  } catch (error) {
    return handleApiError(error, "PASSWORD");
  }
}

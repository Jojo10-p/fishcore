import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/secrets";
import { getCurrentUser, hashSessionToken } from "@/lib/auth";

// POST /api/auth/logout — Révoque la session courante
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    try {
      const user = await getCurrentUser(req);
      await prisma.authSession.deleteMany({ where: { sessionToken: hashSessionToken(token) } });
      await writeAuditLog({
        eventType: "USER_LOGOUT",
        companyId: user.companyId,
        userId: user.id,
        result: "SUCCESS",
        ipAddress: user.ipAddress,
        userAgent: user.userAgent,
      });
    } catch {
      // Session déjà invalide : on supprime quand même l'éventuelle trace en base
      await prisma.authSession
        .deleteMany({ where: { sessionToken: hashSessionToken(token) } })
        .catch(() => undefined);
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

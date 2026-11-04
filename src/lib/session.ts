import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getJwtSecret, SESSION_COOKIE, SESSION_DURATION_MS } from "@/lib/secrets";
import { hashSessionToken } from "@/lib/auth";

/**
 * Ouvre une session pour cet utilisateur et pose le cookie sur la réponse.
 * Utilisé par la connexion classique, la connexion Google et l'invitation.
 */
export async function startSession(
  response: NextResponse,
  user: { id: string; role: UserRole; companyId: string | null },
  meta: { ipAddress?: string | null; userAgent?: string | null }
): Promise<NextResponse> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  // Le JWT ne porte que l'identité minimale : les droits et les centres
  // sont relus en base à chaque requête (getCurrentUser).
  const token = await new SignJWT({ sub: user.id, role: user.role, companyId: user.companyId, jti: crypto.randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .setIssuedAt()
    .sign(getJwtSecret());
  // Seule l'empreinte du jeton est enregistrée
  await prisma.authSession.create({
    data: { userId: user.id, sessionToken: hashSessionToken(token), expires: expiresAt, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null },
  });
  await prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
  return response;
}

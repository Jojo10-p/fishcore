import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/session-token";
import type { PermissionKey } from "@/lib/permissions";
import { getSettings } from "@/server/settings";
import { requestMeta } from "@/server/request";

export async function createSession(user: { id: string; type: "CUSTOMER" | "STAFF" }) {
  const settings = await getSettings();
  const days = user.type === "STAFF" ? Math.min(settings.security.sessionDays, 1) : settings.security.sessionDays;
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);
  const meta = await requestMeta();
  const session = await db.session.create({ data: { userId: user.id, expiresAt, ip: meta.ip, userAgent: meta.userAgent } });
  const token = await signSession({ sid: session.id, uid: user.id, typ: user.type }, expiresAt);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (claims) await db.session.updateMany({ where: { id: claims.sid, revokedAt: null }, data: { revokedAt: new Date() } });
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) }, data: { revokedAt: new Date() } });
}

/** Utilisateur courant, vérifié en base (session non révoquée, compte actif). */
export const getCurrentUser = cache(async () => {
  const claims = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const session = await db.session.findUnique({
    where: { id: claims.sid },
    include: { user: { include: { role: { include: { permissions: true } }, customer: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const u = session.user;
  if (u.deletedAt || u.status !== "ACTIVE" || u.id !== claims.uid) return null;
  const permissions = new Set<string>(u.role?.permissions.map((p) => p.key) ?? []);
  return {
    id: u.id,
    sessionId: session.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    type: u.type,
    roleKey: u.role?.key ?? null,
    roleName: u.role?.name ?? null,
    customer: u.customer,
    notifyByEmail: u.notifyByEmail,
    notifyInApp: u.notifyInApp,
    permissions,
    can: (p: PermissionKey) => permissions.has(p),
  };
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export async function requireCustomer() {
  const user = await getCurrentUser();
  if (!user || user.type !== "CUSTOMER") redirect("/connexion");
  if (!user.customer) redirect("/connexion");
  return user as CurrentUser & { customer: NonNullable<CurrentUser["customer"]> };
}

export async function requireStaff(permission?: PermissionKey) {
  const user = await getCurrentUser();
  if (!user || user.type !== "STAFF") redirect("/admin/connexion");
  if (permission && !user.can(permission)) redirect("/admin?denied=1");
  return user;
}

/** Variante pour les Server Actions : lève une erreur au lieu de rediriger. */
export async function assertStaff(permission: PermissionKey) {
  const user = await getCurrentUser();
  if (!user || user.type !== "STAFF" || !user.can(permission)) throw new Error("FORBIDDEN");
  return user;
}

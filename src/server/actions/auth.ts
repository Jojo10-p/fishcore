"use server";
import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession, destroySession, getCurrentUser, revokeAllSessions } from "@/server/auth/session";
import { DUMMY_HASH, hashPassword, passwordSchema, verifyPassword } from "@/server/auth/password";
import { rateLimit } from "@/server/rate-limit";
import { requestMeta } from "@/server/request";
import { audit } from "@/server/audit";
import { getSettings } from "@/server/settings";
import { sendTemplatedEmail } from "@/server/mail";
import type { ActionState } from "@/components/ui/form-status";

const safeNext = (n: unknown, fallback: string) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : fallback);

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email("Email invalide"), password: z.string().min(1, "Mot de passe requis").max(200) });
const GENERIC = "Email ou mot de passe incorrect.";

async function login(kind: "CUSTOMER" | "STAFF", form: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Vérifiez les champs.", errors: parsed.error.flatten().fieldErrors };
  const { email, password } = parsed.data;
  const { ip } = await requestMeta();
  const settings = await getSettings();
  const okIp = await rateLimit(`login:ip:${ip}`, 30, 900);
  const okEmail = await rateLimit(`login:email:${email}`, 10, 900);
  if (!okIp || !okEmail) return { ok: false, message: "Trop de tentatives. Réessayez dans 15 minutes." };

  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.deletedAt || user.type !== kind) {
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, message: GENERIC };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, message: "Compte temporairement verrouillé après plusieurs échecs. Réessayez plus tard ou réinitialisez votre mot de passe." };
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLogins + 1;
    const lock = failed >= settings.security.maxLoginAttempts;
    await db.user.update({ where: { id: user.id }, data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + settings.security.lockMinutes * 60000) : null } });
    await audit({ actorId: user.id, action: lock ? "auth.locked" : "auth.failed", entity: "User", entityId: user.id });
    return { ok: false, message: GENERIC };
  }
  if (user.status !== "ACTIVE") return { ok: false, message: "Ce compte est suspendu. Contactez le service client." };
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession({ id: user.id, type: kind });
  await audit({ actorId: user.id, action: "auth.login", entity: "User", entityId: user.id });
  redirect(safeNext(form.get("next"), kind === "STAFF" ? "/admin" : "/espace"));
}

export async function customerLogin(_: ActionState, form: FormData) {
  return login("CUSTOMER", form);
}
export async function staffLogin(_: ActionState, form: FormData) {
  return login("STAFF", form);
}

export async function logout(redirectTo: string = "/") {
  const u = await getCurrentUser();
  if (u) await audit({ actorId: u.id, action: "auth.logout", entity: "User", entityId: u.id });
  await destroySession();
  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}

const registerSchema = z
  .object({
    firstName: z.string().trim().min(2, "Prénom requis").max(120),
    lastName: z.string().trim().min(2, "Nom requis").max(80),
    email: z.string().trim().toLowerCase().email("Email invalide").max(200),
    phone: z.string().trim().min(6, "Téléphone invalide").max(30).regex(/^[+0-9 ().-]+$/, "Téléphone invalide"),
    password: passwordSchema,
    passwordConfirm: z.string(),
    acceptData: z.literal("on", { errorMap: () => ({ message: "Votre consentement est nécessaire" }) }),
  })
  .refine((d) => d.password === d.passwordConfirm, { path: ["passwordConfirm"], message: "Les mots de passe ne correspondent pas" });

export async function register(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Vérifiez les champs signalés.", errors: parsed.error.flatten().fieldErrors };
  const { ip } = await requestMeta();
  if (!(await rateLimit(`register:${ip}`, 5, 3600))) return { ok: false, message: "Trop de créations de compte. Réessayez plus tard." };
  const d = parsed.data;
  if (await db.user.findUnique({ where: { email: d.email } })) return { ok: false, message: "Un compte existe déjà avec cet email.", errors: { email: ["Compte existant"] } };
  const user = await db.user.create({
    data: {
      email: d.email,
      passwordHash: await hashPassword(d.password),
      firstName: d.firstName,
      lastName: d.lastName,
      phone: d.phone,
      type: "CUSTOMER",
      customer: { create: { firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, country: "", city: "", address: "" } },
    },
  });
  await audit({ actorId: user.id, action: "auth.register", entity: "User", entityId: user.id });
  await sendTemplatedEmail({ to: d.email, templateKey: "welcome", vars: { firstName: d.firstName }, userId: user.id });
  await createSession({ id: user.id, type: "CUSTOMER" });
  redirect(safeNext(form.get("next"), "/espace"));
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function requestPasswordReset(_: ActionState, form: FormData): Promise<ActionState> {
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  const neutral: ActionState = { ok: true, message: "Si un compte correspond à cet email, un lien de réinitialisation vient d'être envoyé." };
  if (!email.success) return { ok: false, message: "Email invalide.", errors: { email: ["Email invalide"] } };
  const { ip } = await requestMeta();
  if (!(await rateLimit(`reset:${ip}`, 5, 3600)) || !(await rateLimit(`reset:${email.data}`, 3, 3600))) return neutral;
  const user = await db.user.findUnique({ where: { email: email.data } });
  if (!user || user.deletedAt || user.status !== "ACTIVE") return neutral;
  const token = randomBytes(32).toString("base64url");
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600 * 1000) } });
  const path = user.type === "STAFF" ? "/admin/reinitialiser" : "/reinitialiser";
  await sendTemplatedEmail({ to: user.email, templateKey: "password_reset", vars: { firstName: user.firstName, resetUrl: `${env().APP_URL}${path}?token=${token}` }, userId: user.id });
  await audit({ actorId: user.id, action: "auth.reset_requested", entity: "User", entityId: user.id });
  return neutral;
}

export async function resetPassword(_: ActionState, form: FormData): Promise<ActionState> {
  const token = String(form.get("token") ?? "");
  const pw = passwordSchema.safeParse(form.get("password"));
  if (!pw.success) return { ok: false, message: "Mot de passe invalide.", errors: { password: pw.error.flatten().formErrors } };
  if (form.get("password") !== form.get("passwordConfirm")) return { ok: false, message: "Les mots de passe ne correspondent pas.", errors: { passwordConfirm: ["Les mots de passe ne correspondent pas"] } };
  const rec = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) return { ok: false, message: "Ce lien est invalide ou a expiré. Faites une nouvelle demande." };
  await db.$transaction([
    db.user.update({ where: { id: rec.userId }, data: { passwordHash: await hashPassword(pw.data), failedLogins: 0, lockedUntil: null } }),
    db.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllSessions(rec.userId);
  await audit({ actorId: rec.userId, action: "auth.password_reset", entity: "User", entityId: rec.userId });
  redirect(rec.user.type === "STAFF" ? "/admin/connexion?reset=1" : "/connexion?reset=1");
}

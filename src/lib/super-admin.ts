import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Super administrateur unique, créé avec le code d'installation
// ─────────────────────────────────────────────
// Tant qu'il n'existe pas, la première adresse qui se connecte doit saisir le
// code d'installation (connu seulement du responsable). Elle devient alors le
// super administrateur (direction), choisit son mot de passe et renseigne
// l'entreprise. Ensuite : connexion normale e-mail + mot de passe. Le même code
// permet au super administrateur de redéfinir son mot de passe s'il l'oublie.
// Le code n'est jamais stocké en clair : SETUP_CODE_HASH = sha256(code) en hex.

export const SETUP_MAX_FAILS_PER_HOUR = 10;

export const normalizeSetupCode = (code: string) => code.replace(/\s+/g, "");

export function setupCodeConfigured(): boolean {
  return /^[0-9a-f]{64}$/i.test(process.env.SETUP_CODE_HASH?.trim() ?? "");
}

export function checkSetupCode(code: string): boolean {
  if (!setupCodeConfigured()) return false;
  const want = Buffer.from(process.env.SETUP_CODE_HASH!.trim().toLowerCase(), "hex");
  const got = crypto.createHash("sha256").update(normalizeSetupCode(code)).digest();
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export async function superAdmin() {
  return prisma.user.findFirst({ where: { isSuperAdmin: true }, select: { id: true, email: true, companyId: true, isActive: true } });
}

/** Trop d'essais ratés dans l'heure : on bloque (protège contre les essais en rafale). */
export async function setupLocked(): Promise<boolean> {
  const fails = await prisma.setupAttempt.count({ where: { success: false, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  return fails >= SETUP_MAX_FAILS_PER_HOUR;
}

/** Vérifie le code et garde une trace de l'essai. */
export async function verifySetupCode(email: string, code: string, ipAddress?: string | null): Promise<"ok" | "bad" | "locked"> {
  if (await setupLocked()) return "locked";
  const ok = checkSetupCode(code);
  await prisma.setupAttempt.create({ data: { email, success: ok, ipAddress: ipAddress ?? null } });
  return ok ? "ok" : "bad";
}

/** Un super administrateur existe dans cette entreprise : le rôle de direction ne s'attribue plus. */
export async function ownerRoleLocked(companyId: string): Promise<boolean> {
  return (await prisma.user.count({ where: { companyId, isSuperAdmin: true } })) > 0;
}

export const SINGLE_OWNER_MSG = "Il n'y a qu'un seul super administrateur : ce rôle ne peut pas être attribué";

import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Durée de validité d'un lien de réinitialisation. */
export const RESET_LINK_HOURS = 24;

export const hashResetToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * Crée un lien de réinitialisation pour `userId` (les liens précédents non
 * utilisés sont annulés). Seule l'empreinte du jeton est stockée.
 */
export async function createResetLink(
  userId: string,
  createdById: string | null,
  origin: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{ url: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_LINK_HOURS * 3600_000);
  await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  await tx.passwordResetToken.create({ data: { userId, tokenHash: hashResetToken(token), expiresAt, createdById } });
  return { url: `${origin.replace(/\/$/, "")}/reinitialiser/${token}`, expiresAt };
}

/** Adresse publique de l'application (liens envoyés par WhatsApp/SMS). */
export function publicOrigin(reqOrigin: string): string {
  return process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes("localhost") ? process.env.NEXT_PUBLIC_APP_URL : reqOrigin;
}

import crypto from "crypto";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Invitations : la direction crée un lien (rôle + boutique), l'employé ouvre le
// lien et crée lui-même son compte (mot de passe ou Google). Usage unique.
// ─────────────────────────────────────────────

export const INVITATION_DAYS = 7;
/** Code à taper (comme le code de WhatsApp Web) : court, donc valable peu de temps. */
export const CODE_MINUTES = 30;
export const hashInviteToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
export const newInviteToken = () => crypto.randomBytes(24).toString("base64url");

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I/L
/** Code de 8 caractères, affiché « K7PQ-4XZM ». */
export function newInviteCode(): string {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
/** « k7pq 4xzm », « K7PQ-4XZM » → « K7PQ4XZM ». */
export const normalizeCode = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const ROLE_NAMES: Record<UserRole, string> = {
  PLATFORM_ADMIN: "Administrateur",
  COMPANY_OWNER: "Propriétaire",
  CENTER_MANAGER: "Gérant",
  CASHIER: "Caissier",
  ACCOUNTANT: "Comptable",
  STOCK_MANAGER: "Magasinier",
  SALES_EMPLOYEE: "Vendeur",
};

export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/rejoindre/${token}`;
}

/** Lit un jeton (ou un lien complet collé) et renvoie l'invitation encore valable. */
export async function findValidInvitation(tokenOrUrl: string) {
  const raw = tokenOrUrl.trim().split("/").filter(Boolean).pop() ?? "";
  // Code à 8 caractères (tapé à la main) ou jeton long (lien)
  const code = normalizeCode(raw);
  const token = code.length === 8 ? code : raw;
  if (token.length !== 8 && token.length < 20) return { ok: false as const, error: "Code ou lien invalide" };
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { company: { select: { id: true, tradeName: true, isActive: true } }, center: { select: { id: true, name: true } } },
  });
  if (!inv || inv.revokedAt) return { ok: false as const, error: "Code incorrect, ou annulé par la direction" };
  if (inv.usedAt) return { ok: false as const, error: "Ce code a déjà servi. Demandez-en un nouveau à la direction." };
  if (inv.expiresAt < new Date()) return { ok: false as const, error: "Ce code a expiré. Demandez-en un nouveau à la direction." };
  if (!inv.company.isActive) return { ok: false as const, error: "Entreprise suspendue" };
  return { ok: true as const, invitation: inv, token };
}

export type ValidInvitation = Extract<Awaited<ReturnType<typeof findValidInvitation>>, { ok: true }>["invitation"];

/**
 * Crée le compte lié à l'invitation (dans une transaction : l'invitation ne sert qu'une fois).
 */
export async function createUserFromInvitation(
  inv: ValidInvitation,
  data: { email: string; firstName: string; lastName: string; passwordHash: string; phone?: string | null; googleSub?: string | null }
) {
  return prisma.$transaction(async (tx) => {
    // Verrou : deux personnes qui ouvrent le même lien en même temps
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new Error("INVITATION_USED");
    const user = await tx.user.create({
      data: {
        companyId: inv.companyId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone ?? null,
        passwordHash: data.passwordHash,
        googleSub: data.googleSub ?? null,
        role: inv.role,
        ...(inv.centerId && inv.role !== "COMPANY_OWNER" ? { centers: { create: [{ centerId: inv.centerId }] } } : {}),
      },
      select: { id: true, role: true, companyId: true, email: true, firstName: true },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { usedById: user.id } });
    return user;
  });
}

/** Rattache un compte déjà créé (sans entreprise) à l'entreprise du code. */
export async function attachUserToInvitation(inv: ValidInvitation, userId: string) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date(), usedById: userId } });
    if (claimed.count !== 1) throw new Error("INVITATION_USED");
    const user = await tx.user.update({
      where: { id: userId },
      data: { companyId: inv.companyId, role: inv.role, joinAttempts: 0, joinLockedUntil: null },
      select: { id: true, role: true, companyId: true },
    });
    await tx.userCenter.deleteMany({ where: { userId } });
    if (inv.centerId && inv.role !== "COMPANY_OWNER") await tx.userCenter.create({ data: { userId, centerId: inv.centerId } });
    return user;
  });
}

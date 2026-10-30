import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/auth";

// ─────────────────────────────────────────────
// Abonnements à la plateforme
// ─────────────────────────────────────────────
// Essai gratuit à l'inscription, puis abonnement payé jusqu'à `paidUntil`.
// Après l'échéance, un délai de grâce ; ensuite l'accès passe en lecture seule
// (consultation, exports, clôture de caisse et envoi des ventes faites hors
// connexion AVANT l'échéance restent possibles) jusqu'au paiement.

export const TRIAL_DAYS = Math.max(1, Number(process.env.PLATFORM_TRIAL_DAYS ?? 14));
export const GRACE_DAYS = Math.max(0, Number(process.env.PLATFORM_GRACE_DAYS ?? 7));
const DAY = 86_400_000;

export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "GRACE" | "EXPIRED" | "SUSPENDED";

export const DEFAULT_PLANS = [
  { code: "TRIAL", name: "Essai gratuit", monthlyPrice: 0, maxCenters: null, maxUsers: null, description: "Toutes les fonctions pendant 14 jours", isActive: false, sortOrder: 0 },
  { code: "ESSENTIEL", name: "Essentiel", monthlyPrice: 10000, maxCenters: 1, maxUsers: 3, description: "Une boutique, jusqu'à 3 utilisateurs", isActive: true, sortOrder: 1 },
  { code: "PRO", name: "Pro", monthlyPrice: 25000, maxCenters: 3, maxUsers: 10, description: "Jusqu'à 3 magasins ou dépôts, 10 utilisateurs", isActive: true, sortOrder: 2 },
  { code: "ENTREPRISE", name: "Entreprise", monthlyPrice: 50000, maxCenters: null, maxUsers: null, description: "Magasins et utilisateurs illimités", isActive: true, sortOrder: 3 },
] as const;

/** Offres par défaut (sans écraser les prix déjà modifiés). */
export async function ensureDefaultPlans(tx: Prisma.TransactionClient | typeof prisma = prisma) {
  await tx.plan.createMany({ data: DEFAULT_PLANS.map((p) => ({ ...p })), skipDuplicates: true });
}

export interface AccessInfo {
  status: SubscriptionStatus;
  /** Fin de l'essai ou de la période payée (la plus tardive). */
  accessEndsAt: Date | null;
  /** Début de la lecture seule (échéance + délai de grâce). */
  readOnlyFrom: Date | null;
  /** Jours restants avant l'échéance (négatif : dépassée). */
  daysLeft: number | null;
}

export function computeAccess(c: { isActive: boolean; trialEndsAt: Date | null; paidUntil: Date | null }, now = new Date()): AccessInfo {
  const ends = [c.trialEndsAt, c.paidUntil].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const readOnlyFrom = ends ? new Date(ends.getTime() + GRACE_DAYS * DAY) : null;
  const daysLeft = ends ? Math.ceil((ends.getTime() - now.getTime()) / DAY) : null;
  let status: SubscriptionStatus;
  if (!c.isActive) status = "SUSPENDED";
  else if (!ends) status = "ACTIVE"; // compte historique sans échéance
  else if (c.paidUntil && c.paidUntil > now) status = "ACTIVE";
  else if (c.trialEndsAt && c.trialEndsAt > now) status = "TRIAL";
  else if (readOnlyFrom && readOnlyFrom > now) status = "GRACE";
  else status = "EXPIRED";
  return { status, accessEndsAt: ends, readOnlyFrom, daysLeft };
}

/** Ajoute des mois calendaires (le 31 janvier + 1 mois = dernier jour de février). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Limites effectives : celles fixées pour l'entreprise, sinon celles de l'offre. */
export async function companyLimits(companyId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const c = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { customMaxCenters: true, customMaxUsers: true, plan: { select: { code: true, name: true, maxCenters: true, maxUsers: true } } },
  });
  return {
    plan: c.plan,
    maxCenters: c.customMaxCenters ?? c.plan.maxCenters,
    maxUsers: c.customMaxUsers ?? c.plan.maxUsers,
  };
}

export async function assertCanAddCenter(companyId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const { maxCenters, plan } = await companyLimits(companyId, tx);
  if (maxCenters === null) return;
  const count = await tx.center.count({ where: { companyId, status: "ACTIVE" } });
  if (count >= maxCenters) {
    throw new ApiError(403, `L'offre ${plan.name} est limitée à ${maxCenters} centre(s). Passez à une offre supérieure pour en ajouter.`, "PLAN_LIMIT_CENTERS");
  }
}

export async function assertCanAddUser(companyId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const { maxUsers, plan } = await companyLimits(companyId, tx);
  if (maxUsers === null) return;
  const count = await tx.user.count({ where: { companyId, isActive: true } });
  if (count >= maxUsers) {
    throw new ApiError(403, `L'offre ${plan.name} est limitée à ${maxUsers} utilisateur(s) actif(s). Passez à une offre supérieure ou désactivez un compte.`, "PLAN_LIMIT_USERS");
  }
}

/**
 * Opérations encore permises en lecture seule : se connecter / gérer son mot de
 * passe, clôturer sa caisse, envoyer les ventes faites hors connexion avant
 * l'échéance (vérifié par la route des ventes), supprimer son compte.
 */
const READ_ONLY_ALLOWED = ["/api/auth/", "/api/cash/sessions", "/api/sales", "/api/company/delete", "/api/sync/"];

export function isAllowedWhenExpired(pathname: string, method: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  return READ_ONLY_ALLOWED.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`) || pathname === p.replace(/\/$/, ""));
}

export const EXPIRED_MESSAGE =
  "L'abonnement de votre entreprise est arrivé à échéance : l'application est en consultation seule. Renouvelez l'abonnement pour reprendre les ventes (Paramètres → Abonnement).";

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIAL: "Essai gratuit",
  ACTIVE: "Actif",
  GRACE: "Échéance dépassée (délai de grâce)",
  EXPIRED: "Expiré — consultation seule",
  SUSPENDED: "Suspendu",
};

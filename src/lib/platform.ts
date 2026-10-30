import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, type AuthUser } from "@/lib/auth";
import { computeAccess, type SubscriptionStatus } from "@/lib/subscription";
import type { NextRequest } from "next/server";

// Espace d'administration de la plateforme (l'éditeur de fishcore) : réservé
// aux comptes PLATFORM_ADMIN, qui n'appartiennent à aucune entreprise.

export async function requirePlatformAdmin(req: NextRequest): Promise<AuthUser> {
  const user = await getCurrentUser(req);
  if (user.role !== "PLATFORM_ADMIN" || user.companyId) throw new ApiError(403, "Réservé à l'administration de la plateforme", "FORBIDDEN");
  return user;
}

export const companyListSelect = {
  id: true,
  tradeName: true,
  ownerName: true,
  email: true,
  phone: true,
  city: true,
  businessType: true,
  createdAt: true,
  isActive: true,
  suspendedReason: true,
  trialEndsAt: true,
  paidUntil: true,
  planCode: true,
  plan: { select: { name: true, monthlyPrice: true } },
  _count: { select: { centers: true, users: true } },
} satisfies Prisma.CompanySelect;

export type CompanyRow = Prisma.CompanyGetPayload<{ select: typeof companyListSelect }>;

/** Activité des 30 derniers jours (ventes, dernière vente, dernière connexion) pour une liste d'entreprises. */
export async function companyActivity(ids: string[]) {
  const map = new Map<string, { sales30d: number; revenue30d: number; lastSaleAt: Date | null; lastLoginAt: Date | null }>();
  if (ids.length === 0) return map;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [sales, last, logins] = await Promise.all([
    prisma.sale.groupBy({ by: ["companyId"], where: { companyId: { in: ids }, createdAt: { gte: since }, status: { not: "CANCELLED" } }, _count: true, _sum: { totalAmount: true } }),
    prisma.sale.groupBy({ by: ["companyId"], where: { companyId: { in: ids } }, _max: { createdAt: true } }),
    prisma.user.groupBy({ by: ["companyId"], where: { companyId: { in: ids } }, _max: { lastLoginAt: true } }),
  ]);
  for (const id of ids) {
    const s = sales.find((x) => x.companyId === id);
    map.set(id, {
      sales30d: s?._count ?? 0,
      revenue30d: Number(s?._sum.totalAmount ?? 0),
      lastSaleAt: last.find((x) => x.companyId === id)?._max.createdAt ?? null,
      lastLoginAt: logins.find((x) => x.companyId === id)?._max.lastLoginAt ?? null,
    });
  }
  return map;
}

export function withAccess<T extends { isActive: boolean; trialEndsAt: Date | null; paidUntil: Date | null }>(c: T) {
  const access = computeAccess(c);
  return { ...c, status: access.status as SubscriptionStatus, accessEndsAt: access.accessEndsAt, readOnlyFrom: access.readOnlyFrom, daysLeft: access.daysLeft };
}

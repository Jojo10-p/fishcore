import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, type AuthUser } from "@/lib/auth";
import type { NextRequest } from "next/server";

// Console du créateur de la plateforme : vue d'ensemble de toutes les
// entreprises inscrites. Réservée aux comptes PLATFORM_ADMIN (sans entreprise).

export async function requirePlatformAdmin(req: NextRequest): Promise<AuthUser> {
  const user = await getCurrentUser(req);
  if (user.role !== "PLATFORM_ADMIN" || user.companyId) throw new ApiError(403, "Réservé au créateur de la plateforme", "FORBIDDEN");
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
  _count: { select: { centers: true, users: true, products: true } },
} satisfies Prisma.CompanySelect;

export interface Activity {
  sales30d: number;
  revenue30d: number;
  lastSaleAt: Date | null;
  lastLoginAt: Date | null;
  /** Dernier signe de vie : vente ou connexion. */
  lastActivityAt: Date | null;
}

/** Activité des 30 derniers jours pour une liste d'entreprises (3 requêtes groupées). */
export async function companyActivity(ids: string[]): Promise<Map<string, Activity>> {
  const map = new Map<string, Activity>();
  if (ids.length === 0) return map;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [sales, last, logins] = await Promise.all([
    prisma.sale.groupBy({ by: ["companyId"], where: { companyId: { in: ids }, createdAt: { gte: since }, status: { not: "CANCELLED" } }, _count: true, _sum: { totalAmount: true } }),
    prisma.sale.groupBy({ by: ["companyId"], where: { companyId: { in: ids } }, _max: { createdAt: true } }),
    prisma.user.groupBy({ by: ["companyId"], where: { companyId: { in: ids } }, _max: { lastLoginAt: true } }),
  ]);
  for (const id of ids) {
    const s = sales.find((x) => x.companyId === id);
    const lastSaleAt = last.find((x) => x.companyId === id)?._max.createdAt ?? null;
    const lastLoginAt = logins.find((x) => x.companyId === id)?._max.lastLoginAt ?? null;
    const lastActivityAt = [lastSaleAt, lastLoginAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    map.set(id, { sales30d: s?._count ?? 0, revenue30d: Number(s?._sum.totalAmount ?? 0), lastSaleAt, lastLoginAt, lastActivityAt });
  }
  return map;
}

/** Inactive : aucune vente ni connexion depuis 14 jours. */
export const INACTIVE_DAYS = 14;
export const isInactive = (a: Activity | undefined) => !a?.lastActivityAt || a.lastActivityAt.getTime() < Date.now() - INACTIVE_DAYS * 86_400_000;

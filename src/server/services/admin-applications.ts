import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { APPLICATION_STATUSES } from "@/lib/status";
import type { ApplicationStatus } from "@/generated/prisma/enums";

export type AppFilters = { q?: string; statut?: string; produit?: string; du?: string; au?: string; tri?: string; page?: string; demo?: string };

export function buildApplicationWhere(f: AppFilters): Prisma.LoanApplicationWhereInput {
  const where: Prisma.LoanApplicationWhereInput = { deletedAt: null };
  const q = f.q?.trim();
  if (q) {
    where.OR = [
      { reference: { contains: q, mode: "insensitive" } },
      { customer: { lastName: { contains: q, mode: "insensitive" } } },
      { customer: { firstName: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (f.statut && APPLICATION_STATUSES.includes(f.statut as ApplicationStatus)) where.status = f.statut as ApplicationStatus;
  if (f.produit && /^[0-9a-f-]{36}$/i.test(f.produit)) where.productId = f.produit;
  const from = f.du ? new Date(f.du) : null;
  const to = f.au ? new Date(f.au + "T23:59:59") : null;
  if ((from && !isNaN(+from)) || (to && !isNaN(+to))) where.createdAt = { ...(from && !isNaN(+from) ? { gte: from } : {}), ...(to && !isNaN(+to) ? { lte: to } : {}) };
  if (f.demo === "non") where.isDemo = false;
  return where;
}

export function buildApplicationOrder(tri?: string): Prisma.LoanApplicationOrderByWithRelationInput {
  switch (tri) {
    case "ancien": return { createdAt: "asc" };
    case "montant-desc": return { amount: "desc" };
    case "montant-asc": return { amount: "asc" };
    case "nom": return { customer: { lastName: "asc" } };
    default: return { createdAt: "desc" };
  }
}

import "server-only";
import { cache } from "react";
import { db, tbl } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import { getSettings } from "@/server/settings";
import type { ProductCategory } from "@/generated/prisma/enums";

export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  category: ProductCategory;
  tagline: string | null;
  description: string;
  minAmount: number;
  maxAmount: number;
  minDurationMonths: number;
  maxDurationMonths: number;
  annualRate: number;
  feesFixed: number;
  feesPercent: number;
  insuranceRate: number;
  eligibility: string[];
  requiredDocuments: { key: string; label: string; required: boolean }[];
}

export const getActiveProducts = cache(async (): Promise<PublicProduct[]> => {
  const rows = await db.loanProduct.findMany({ where: { isActive: true, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    tagline: p.tagline,
    description: p.description,
    minAmount: toNumber(p.minAmount),
    maxAmount: toNumber(p.maxAmount),
    minDurationMonths: p.minDurationMonths,
    maxDurationMonths: p.maxDurationMonths,
    annualRate: toNumber(p.annualRate),
    feesFixed: toNumber(p.feesFixed),
    feesPercent: toNumber(p.feesPercent),
    insuranceRate: toNumber(p.insuranceRate),
    eligibility: p.eligibility,
    requiredDocuments: Array.isArray(p.requiredDocuments) ? (p.requiredDocuments as PublicProduct["requiredDocuments"]) : [],
  }));
});

export const getPublishedFaqs = cache(async (locale: string, limit?: number) => {
  let rows = await db.faq.findMany({ where: { isPublished: true, locale }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }], take: limit });
  if (!rows.length && locale !== "fr") rows = await db.faq.findMany({ where: { isPublished: true, locale: "fr" }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }], take: limit });
  return rows;
});

/** Seuls les témoignages publiés ET dont le consentement est enregistré sont affichés. */
export const getPublishedTestimonials = cache(async (locale: string) =>
  db.testimonial.findMany({ where: { isPublished: true, consentObtained: true, locale }, orderBy: { sortOrder: "asc" }, take: 6 }),
);

/**
 * Indicateurs publics calculés sur les données réelles (hors démo), affichés
 * uniquement si l'administrateur les active et si le volume est significatif.
 */
export const getPublicStats = cache(async () => {
  const settings = await getSettings();
  if (!settings.publicStats.enabled) return null;
  const [reviewed, products] = await Promise.all([
    db.loanApplication.count({ where: { isDemo: false, deletedAt: null, status: { not: "NEW" } } }),
    db.loanProduct.count({ where: { isActive: true, archivedAt: null } }),
  ]);
  if (reviewed < settings.publicStats.minApplications) return null;
  const firstMoves = await db.$queryRaw<{ hours: number | null }[]>`
    SELECT AVG(EXTRACT(EPOCH FROM (h."createdAt" - a."createdAt")) / 3600)::float AS hours
    FROM ${tbl("loan_applications")} a
    JOIN LATERAL (SELECT "createdAt" FROM ${tbl("application_status_history")} WHERE "applicationId" = a.id AND "fromStatus" IS NOT NULL ORDER BY "createdAt" LIMIT 1) h ON true
    WHERE a."isDemo" = false AND a."deletedAt" IS NULL`;
  return { reviewed, products, avgFirstResponseHours: firstMoves[0]?.hours ?? null };
});

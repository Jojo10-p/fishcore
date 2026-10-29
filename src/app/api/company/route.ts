import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCompany,
  requirePermission,
} from "@/lib/auth";
import { seedCompanyCatalog } from "@/lib/catalog";

const companySelect = {
  id: true,
  tradeName: true,
  legalName: true,
  logoUrl: true,
  ownerName: true,
  phone: true,
  email: true,
  address: true,
  city: true,
  commune: true,
  country: true,
  poBox: true,
  taxId: true,
  tradeRegNumber: true,
  currency: true,
  timezone: true,
  invoicePrefix: true,
  businessType: true,
  vatEnabled: true,
  defaultTaxRate: true,
  quotePrefix: true,
  quoteValidityDays: true,
  invoiceNotes: true,
  requiresPickup: true,
} as const;

const settingsSchema = z
  .object({
    tradeName: z.string().trim().min(2).optional(),
    legalName: z.string().trim().optional(),
    phone: z.string().trim().min(8).optional(),
    address: z.string().trim().optional(),
    city: z.string().trim().optional(),
    commune: z.string().trim().optional(),
    poBox: z.string().trim().optional(),
    taxId: z.string().trim().optional(),
    tradeRegNumber: z.string().trim().optional(),
    businessType: z
      .enum(["GENERAL", "FISHMONGER", "HARDWARE", "BUILDING_MATERIALS", "OIL_DISTRIBUTION", "SUPERMARKET", "PHARMACY", "WHOLESALE"])
      .optional(),
    vatEnabled: z.boolean().optional(),
    defaultTaxRate: z.coerce.number().min(0).max(100).optional(),
    quoteValidityDays: z.coerce.number().int().min(1).max(365).optional(),
    invoiceNotes: z.string().trim().max(600).optional(),
    requiresPickup: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "Aucune modification");

// GET /api/company — Paramètres de l'entreprise
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "company:view");
    const companyId = requireCompany(user);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: companySelect });
    return NextResponse.json({ success: true, data: company });
  } catch (error) {
    return handleApiError(error, "COMPANY");
  }
}

// PATCH /api/company — Modifier les paramètres (propriétaire).
// Changer de métier ajoute les unités et catégories de ce métier (rien n'est supprimé).
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "company:edit");
    const companyId = requireCompany(user);
    const data = parseBody(settingsSchema, await readJson(req));

    const company = await prisma.$transaction(async (tx) => {
      const before = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: companySelect });
      const updated = await tx.company.update({ where: { id: companyId }, data, select: companySelect });
      if (data.businessType && data.businessType !== before.businessType) {
        await seedCompanyCatalog(tx, companyId, data.businessType);
      }
      await writeAuditLog(
        {
          eventType: "COMPANY_SETTINGS_CHANGED",
          companyId,
          userId: user.id,
          referenceType: "Company",
          referenceId: companyId,
          result: "SUCCESS",
          reason: "Modification des paramètres de l'entreprise",
          oldValues: Object.fromEntries(Object.keys(data).map((k) => [k, String(before[k as keyof typeof before] ?? "")])),
          newValues: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? "")])),
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return updated;
    });

    return NextResponse.json({ success: true, data: company });
  } catch (error) {
    return handleApiError(error, "COMPANY");
  }
}

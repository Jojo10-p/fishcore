import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, handleApiError, parseBody, readJson } from "@/lib/auth";
import { companyActivity, requirePlatformAdmin, withAccess } from "@/lib/platform";
import { companyLimits } from "@/lib/subscription";

type Ctx = { params: Promise<{ id: string }> };

async function detail(id: string) {
  const c = await prisma.company.findUnique({
    where: { id },
    select: {
      id: true,
      tradeName: true,
      legalName: true,
      ownerName: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      taxId: true,
      businessType: true,
      createdAt: true,
      isActive: true,
      suspendedAt: true,
      suspendedReason: true,
      trialEndsAt: true,
      paidUntil: true,
      planCode: true,
      customMaxCenters: true,
      customMaxUsers: true,
      platformNotes: true,
      plan: { select: { code: true, name: true, monthlyPrice: true, maxCenters: true, maxUsers: true } },
      centers: { select: { id: true, name: true, code: true, status: true }, orderBy: { createdAt: "asc" } },
      users: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true }, orderBy: { createdAt: "asc" } },
      subscriptionPayments: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!c) throw new ApiError(404, "Entreprise introuvable");
  const [activity, limits, products] = await Promise.all([companyActivity([id]), companyLimits(id), prisma.product.count({ where: { companyId: id } })]);
  return { ...withAccess(c), activity: activity.get(id)!, limits, products };
}

// GET /api/platform/companies/[id] — Fiche client
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    await requirePlatformAdmin(req);
    const { id } = await params;
    return NextResponse.json({ success: true, data: await detail(id) });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}

const patchSchema = z.object({
  planCode: z.string().min(1).optional(),
  /** Prolonger (ou raccourcir) l'essai de N jours à partir de sa fin actuelle (ou d'aujourd'hui). */
  extendTrialDays: z.coerce.number().int().min(-365).max(365).optional(),
  customMaxCenters: z.coerce.number().int().min(1).nullable().optional(),
  customMaxUsers: z.coerce.number().int().min(1).nullable().optional(),
  platformNotes: z.string().max(2000).nullable().optional(),
  /** Suspendre (motif obligatoire) ou réactiver. */
  suspend: z.object({ reason: z.string().trim().min(3, "Motif obligatoire") }).optional(),
  reactivate: z.literal(true).optional(),
});

// PATCH /api/platform/companies/[id] — Offre, essai, limites, notes, suspension
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const admin = await requirePlatformAdmin(req);
    const { id } = await params;
    const data = parseBody(patchSchema, await readJson(req));
    const before = await prisma.company.findUnique({ where: { id }, select: { planCode: true, trialEndsAt: true, isActive: true, customMaxCenters: true, customMaxUsers: true } });
    if (!before) throw new ApiError(404, "Entreprise introuvable");
    if (data.planCode) {
      const plan = await prisma.plan.findUnique({ where: { code: data.planCode } });
      if (!plan) throw new ApiError(400, "Offre inconnue");
    }

    await prisma.$transaction(async (tx) => {
      const trialEndsAt =
        data.extendTrialDays !== undefined
          ? new Date(Math.max(before.trialEndsAt?.getTime() ?? 0, Date.now()) + data.extendTrialDays * 86_400_000)
          : undefined;
      await tx.company.update({
        where: { id },
        data: {
          ...(data.planCode ? { planCode: data.planCode } : {}),
          ...(trialEndsAt ? { trialEndsAt } : {}),
          ...(data.customMaxCenters !== undefined ? { customMaxCenters: data.customMaxCenters } : {}),
          ...(data.customMaxUsers !== undefined ? { customMaxUsers: data.customMaxUsers } : {}),
          ...(data.platformNotes !== undefined ? { platformNotes: data.platformNotes } : {}),
          ...(data.suspend ? { isActive: false, suspendedAt: new Date(), suspendedReason: data.suspend.reason } : {}),
          ...(data.reactivate ? { isActive: true, suspendedAt: null, suspendedReason: null } : {}),
        },
      });
      // Suspension : tous les utilisateurs sont déconnectés aussitôt
      if (data.suspend) await tx.authSession.deleteMany({ where: { user: { companyId: id } } });
      const event = data.suspend ? "COMPANY_SUSPENDED" : data.reactivate ? "COMPANY_REACTIVATED" : "SUBSCRIPTION_CHANGED";
      const { platformNotes: _notes, ...visible } = data;
      void _notes;
      if (Object.keys(visible).length > 0) {
        await writeAuditLog(
          {
            eventType: event,
            companyId: id,
            userId: admin.id,
            referenceType: "Company",
            referenceId: id,
            result: "SUCCESS",
            reason: data.suspend?.reason,
            oldValues: { planCode: before.planCode, trialEndsAt: before.trialEndsAt?.toISOString() ?? null, isActive: before.isActive, customMaxCenters: before.customMaxCenters, customMaxUsers: before.customMaxUsers },
            newValues: { ...visible, ...(trialEndsAt ? { trialEndsAt: trialEndsAt.toISOString() } : {}), by: "plateforme" },
            ipAddress: admin.ipAddress,
            userAgent: admin.userAgent,
          },
          tx
        );
      }
    });
    return NextResponse.json({ success: true, data: await detail(id) });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}

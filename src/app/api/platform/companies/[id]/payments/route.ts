import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ApiError, handleApiError, parseBody, readJson } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform";
import { addMonths } from "@/lib/subscription";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  planCode: z.string().min(1, "Offre requise"),
  months: z.coerce.number().int().min(1, "Au moins 1 mois").max(36),
  /** Montant encaissé (par défaut : prix de l'offre × mois). */
  amount: z.coerce.number().int().min(0).optional(),
  method: z.enum(["MOBILE_MONEY", "VIREMENT", "ESPECES", "AUTRE"]),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

// POST /api/platform/companies/[id]/payments — Enregistre un paiement d'abonnement :
// la période commence à la fin de la période payée en cours (ou aujourd'hui).
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const admin = await requirePlatformAdmin(req);
    const { id } = await params;
    const data = parseBody(schema, await readJson(req));
    const plan = await prisma.plan.findUnique({ where: { code: data.planCode } });
    if (!plan || plan.code === "TRIAL") throw new ApiError(400, "Choisissez une offre payante");

    const result = await prisma.$transaction(async (tx) => {
      const [company] = await tx.$queryRaw<Array<{ id: string; paidUntil: Date | null }>>`
        SELECT "id", "paidUntil" FROM "companies" WHERE "id" = ${id} FOR UPDATE`;
      if (!company) throw new ApiError(404, "Entreprise introuvable");
      const now = new Date();
      const periodStart = company.paidUntil && company.paidUntil > now ? company.paidUntil : now;
      const periodEnd = addMonths(periodStart, data.months);
      const amount = data.amount ?? plan.monthlyPrice * data.months;
      const payment = await tx.subscriptionPayment.create({
        data: { companyId: id, planCode: plan.code, amount, months: data.months, method: data.method, reference: data.reference || null, notes: data.notes || null, periodStart, periodEnd, recordedById: admin.id },
      });
      // Un paiement réactive aussi un compte suspendu pour impayé
      await tx.company.update({ where: { id }, data: { paidUntil: periodEnd, planCode: plan.code, isActive: true, suspendedAt: null, suspendedReason: null } });
      await writeAuditLog(
        {
          eventType: "SUBSCRIPTION_PAYMENT_RECORDED",
          companyId: id,
          userId: admin.id,
          referenceType: "SubscriptionPayment",
          referenceId: payment.id,
          result: "SUCCESS",
          newValues: { plan: plan.name, months: data.months, amount, method: data.method, reference: data.reference ?? null, paidUntil: periodEnd.toISOString(), by: "plateforme" },
          ipAddress: admin.ipAddress,
          userAgent: admin.userAgent,
        },
        tx
      );
      return payment;
    });
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}

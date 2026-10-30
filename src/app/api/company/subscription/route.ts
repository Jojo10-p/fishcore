import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, requireCompany, requirePermission } from "@/lib/auth";
import { companyLimits, computeAccess, GRACE_DAYS } from "@/lib/subscription";

// GET /api/company/subscription — Abonnement de l'entreprise (offre, échéance, usage, paiements)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "company:view");
    const companyId = requireCompany(user);
    const [company, limits, centers, users, payments, plans] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { isActive: true, trialEndsAt: true, paidUntil: true, suspendedReason: true } }),
      companyLimits(companyId),
      prisma.center.count({ where: { companyId, status: "ACTIVE" } }),
      prisma.user.count({ where: { companyId, isActive: true } }),
      prisma.subscriptionPayment.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 24,
        select: { id: true, createdAt: true, planCode: true, amount: true, months: true, method: true, reference: true, periodStart: true, periodEnd: true },
      }),
      prisma.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true, monthlyPrice: true, maxCenters: true, maxUsers: true, description: true } }),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        ...computeAccess(company),
        graceDays: GRACE_DAYS,
        trialEndsAt: company.trialEndsAt,
        paidUntil: company.paidUntil,
        plan: limits.plan,
        limits: { maxCenters: limits.maxCenters, maxUsers: limits.maxUsers },
        usage: { centers, users },
        payments,
        plans,
        paymentInstructions: process.env.PLATFORM_PAYMENT_INSTRUCTIONS || null,
        supportContact: process.env.NEXT_PUBLIC_SUPPORT_CONTACT || null,
      },
    });
  } catch (error) {
    return handleApiError(error, "SUBSCRIPTION");
  }
}

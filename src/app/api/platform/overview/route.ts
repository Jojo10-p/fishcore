import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/auth";
import { companyListSelect, requirePlatformAdmin, withAccess } from "@/lib/platform";

// GET /api/platform/overview — Chiffres clés de la plateforme
export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin(req);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [companies, paidThisMonth, signups30d] = await Promise.all([
      prisma.company.findMany({ select: companyListSelect }),
      prisma.subscriptionPayment.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { amount: true }, _count: true }),
      prisma.company.count({ where: { createdAt: { gte: since30 } } }),
    ]);
    const rows = companies.map(withAccess);
    const byStatus = rows.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
    // Revenu mensuel récurrent : prix mensuel des abonnements payés en cours
    const mrr = rows.filter((c) => c.status === "ACTIVE" && c.paidUntil).reduce((s, c) => s + c.plan.monthlyPrice, 0);
    const soon = rows
      .filter((c) => (c.status === "TRIAL" || c.status === "ACTIVE") && c.daysLeft !== null && c.daysLeft <= 7)
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      .slice(0, 20);
    return NextResponse.json({
      success: true,
      data: {
        total: rows.length,
        byStatus,
        mrr,
        paidThisMonth: { amount: paidThisMonth._sum.amount ?? 0, count: paidThisMonth._count },
        signups30d,
        expiringSoon: soon,
        graceOrExpired: rows.filter((c) => c.status === "GRACE" || c.status === "EXPIRED").slice(0, 20),
      },
    });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}

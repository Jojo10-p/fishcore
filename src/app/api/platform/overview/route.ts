import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/auth";
import { companyActivity, companyListSelect, isInactive, requirePlatformAdmin } from "@/lib/platform";

// GET /api/platform/overview — Vue d'ensemble de la plateforme
export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin(req);
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const yearAgo = new Date();
    yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 11, 1);
    yearAgo.setUTCHours(0, 0, 0, 0);

    const [companies, centers, users, products, sales30, activeSellers7d, signups, deletionsTotal, deletions30d, recentDeletions] = await Promise.all([
      prisma.company.findMany({ select: companyListSelect, orderBy: { createdAt: "desc" } }),
      prisma.center.count(),
      prisma.user.count({ where: { companyId: { not: null } } }),
      prisma.product.count(),
      prisma.sale.aggregate({ where: { createdAt: { gte: since30 }, status: { not: "CANCELLED" } }, _count: true, _sum: { totalAmount: true } }),
      prisma.sale.groupBy({ by: ["companyId"], where: { createdAt: { gte: since7 } } }),
      prisma.$queryRaw<Array<{ month: string; n: bigint }>>`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, COUNT(*) AS n
          FROM "companies" WHERE "createdAt" >= ${yearAgo} GROUP BY 1 ORDER BY 1`,
      prisma.accountDeletion.count(),
      prisma.accountDeletion.count({ where: { deletedAt: { gte: since30 } } }),
      prisma.accountDeletion.findMany({ orderBy: { deletedAt: "desc" }, take: 5, select: { id: true, tradeName: true, deletedAt: true, reasons: true, otherReason: true } }),
    ]);
    const activity = await companyActivity(companies.map((c) => c.id));

    // 12 derniers mois, y compris les mois sans inscription
    const months: Array<{ month: string; count: number }> = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(yearAgo);
      d.setUTCMonth(d.getUTCMonth() + i);
      const key = d.toISOString().slice(0, 7);
      months.push({ month: key, count: Number(signups.find((s) => s.month === key)?.n ?? 0) });
    }
    const byType = companies.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.businessType]: (acc[c.businessType] ?? 0) + 1 }), {});

    return NextResponse.json({
      success: true,
      data: {
        companies: companies.length,
        suspended: companies.filter((c) => !c.isActive).length,
        withSeveralCenters: companies.filter((c) => c._count.centers > 1).length,
        centers,
        users,
        products,
        sales30d: { count: sales30._count, amount: Number(sales30._sum.totalAmount ?? 0) },
        activeLast7d: activeSellers7d.length,
        inactive: companies.filter((c) => c.isActive && isInactive(activity.get(c.id))).length,
        signups30d: companies.filter((c) => c.createdAt >= since30).length,
        signupsByMonth: months,
        byBusinessType: byType,
        recentSignups: companies.slice(0, 6).map((c) => ({ id: c.id, tradeName: c.tradeName, ownerName: c.ownerName, city: c.city, businessType: c.businessType, createdAt: c.createdAt, centers: c._count.centers })),
        deletions: { total: deletionsTotal, last30d: deletions30d, recent: recentDeletions },
      },
    });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}

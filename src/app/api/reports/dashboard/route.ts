import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  handleApiError,
  requireCompany,
  requirePermission,
  resolveCenterScope,
} from "@/lib/auth";
import { dayBounds, todayIn } from "@/lib/time";
import { hasPermission } from "@/lib/rbac";

// GET /api/reports/dashboard — Indicateurs du jour (centres visibles uniquement).
// Tout le monde a son tableau de bord : le caissier y voit SES ventes ; la direction
// et le gérant voient toute la boutique et qui est connecté en ce moment.
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "dashboard:view");
    const seesAll = hasPermission(user.role, "sale:view_all");
    const companyId = requireCompany(user);

    const { searchParams } = new URL(req.url);
    const centerScope = await resolveCenterScope(user, searchParams.get("centerId"));

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    });
    const tz = company.timezone || "Africa/Porto-Novo";
    const dateParam = searchParams.get("date");
    const dateStr = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIn(tz);
    const { start, end } = dayBounds(dateStr, tz);

    const centerWhere = centerScope ? { centerId: centerScope } : {};
    const mine = seesAll ? {} : { cashierId: user.id };
    const saleWhere: Prisma.SaleWhereInput = {
      companyId,
      ...centerWhere,
      ...mine,
      status: { not: "CANCELLED" },
      createdAt: { gte: start, lte: end },
    };

    // Filtre SQL équivalent pour le comptage des stocks bas
    const centerSql =
      typeof centerScope === "string"
        ? Prisma.sql`AND s."centerId" = ${centerScope}`
        : centerScope?.in
          ? centerScope.in.length
            ? Prisma.sql`AND s."centerId" IN (${Prisma.join(centerScope.in as string[])})`
            : Prisma.sql`AND FALSE`
          : Prisma.empty;

    // Lots à surveiller : périmés encore en stock, et péremption sous 30 jours
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const soon = new Date(today.getTime() + 30 * 24 * 3600 * 1000);
    const batchCenter = centerScope ? { centerId: centerScope } : { centerId: { not: null } };
    const batchBase = { remainingQty: { gt: 0 }, product: { companyId }, ...batchCenter };

    const [salesStats, daySales, lowStockRows, openSessions, recentSales, expiredBatches, expiringBatches] = await Promise.all([
      prisma.sale.aggregate({ where: saleWhere, _sum: { totalAmount: true }, _count: { id: true } }),

      prisma.sale.findMany({ where: saleWhere, select: { createdAt: true, totalAmount: true } }),

      // Stocks au niveau ou sous le seuil d'alerte (du plus bas au plus haut)
      prisma.$queryRaw<{ productId: string; name: string; quantity: Prisma.Decimal; unit: string; center: string }[]>`
        SELECT p."id" AS "productId", p."name", s."quantity", u."symbol" AS unit, c."name" AS center
          FROM "stocks" s
          JOIN "products" p ON p."id" = s."productId"
          JOIN "units" u ON u."id" = p."baseUnitId"
          JOIN "centers" c ON c."id" = s."centerId"
         WHERE c."companyId" = ${companyId}
           AND p."isActive" = TRUE
           AND s."quantity" <= p."stockAlertQty"
           ${centerSql}
         ORDER BY s."quantity" ASC, p."name" ASC`,

      prisma.cashSession.count({
        where: { closedAt: null, cashRegister: { center: { companyId }, ...centerWhere } },
      }),

      prisma.sale.findMany({
        where: { companyId, ...centerWhere, ...mine },
        include: {
          cashier: { select: { firstName: true, lastName: true } },
          lines: { include: { product: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),

      prisma.batch.count({ where: { ...batchBase, expiresAt: { lt: today } } }),
      prisma.batch.count({ where: { ...batchBase, expiresAt: { gte: today, lte: soon } } }),
    ]);

    // CA par heure locale (24 tranches) calculé sur TOUTES les ventes du jour
    const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" });
    const buckets = Array.from({ length: 24 }, () => ({ revenue: new Prisma.Decimal(0), count: 0 }));
    for (const s of daySales) {
      const h = Number(hourFmt.format(s.createdAt)) % 24;
      buckets[h].revenue = buckets[h].revenue.add(s.totalAmount);
      buckets[h].count += 1;
    }
    const hourlyRevenue = buckets.map((b, hour) => ({
      hour: `${String(hour).padStart(2, "0")}h`,
      revenue: Number(b.revenue),
      count: b.count,
    }));

    // Qui est connecté en ce moment (activité depuis moins de 3 minutes) et sa caisse ouverte
    let activeUsers: Array<{ id: string; name: string; role: string; lastSeenAt: Date; openSession: { registerName: string; openedAt: Date; salesCount: number; total: number } | null }> = [];
    let perCashier: Array<{ cashierId: string; name: string; salesCount: number; revenue: number }> = [];
    if (seesAll) {
      const since = new Date(Date.now() - 3 * 60_000);
      const sessions = await prisma.authSession.findMany({
        where: { lastSeenAt: { gte: since }, expires: { gt: new Date() }, user: { companyId, isActive: true } },
        select: { lastSeenAt: true, user: { select: { id: true, firstName: true, lastName: true, role: true } } },
        orderBy: { lastSeenAt: "desc" },
      });
      const seen = new Map<string, (typeof sessions)[number]>();
      for (const s of sessions) if (s.user.id !== user.id && !seen.has(s.user.id)) seen.set(s.user.id, s);
      const ids = [...seen.keys()];
      const open = await prisma.cashSession.findMany({
        where: { cashierId: { in: ids }, closedAt: null },
        select: { id: true, cashierId: true, openedAt: true, cashRegister: { select: { name: true } } },
      });
      const openStats = open.length
        ? await prisma.sale.groupBy({
            by: ["sessionId"],
            where: { sessionId: { in: open.map((o) => o.id) }, status: { not: "CANCELLED" } },
            _count: { id: true },
            _sum: { totalAmount: true },
          })
        : [];
      activeUsers = [...seen.values()].map((s) => {
        const o = open.find((x) => x.cashierId === s.user.id);
        const st = o ? openStats.find((x) => x.sessionId === o.id) : undefined;
        return {
          id: s.user.id,
          name: `${s.user.firstName} ${s.user.lastName}`.trim(),
          role: s.user.role,
          lastSeenAt: s.lastSeenAt!,
          openSession: o ? { registerName: o.cashRegister.name, openedAt: o.openedAt, salesCount: st?._count.id ?? 0, total: Number(st?._sum.totalAmount ?? 0) } : null,
        };
      });
      // Ventes du jour par caissier (chacun son total, un seul stock)
      const byCashier = await prisma.sale.groupBy({ by: ["cashierId"], where: saleWhere, _count: { id: true }, _sum: { totalAmount: true } });
      const names = await prisma.user.findMany({ where: { id: { in: byCashier.map((b) => b.cashierId) } }, select: { id: true, firstName: true, lastName: true } });
      perCashier = byCashier
        .map((b) => {
          const u = names.find((n) => n.id === b.cashierId);
          return { cashierId: b.cashierId, name: u ? `${u.firstName} ${u.lastName}`.trim() : "—", salesCount: b._count.id, revenue: Number(b._sum.totalAmount ?? 0) };
        })
        .sort((a, b) => b.revenue - a.revenue);
    }

    return NextResponse.json({
      success: true,
      data: {
        date: dateStr,
        scope: seesAll ? "all" : "mine",
        activeUsers,
        perCashier,
        today: {
          salesCount: salesStats._count.id,
          revenue: Number(salesStats._sum.totalAmount ?? 0),
        },
        lowStockCount: lowStockRows.length,
        lowStock: lowStockRows.slice(0, 10).map((r) => ({ ...r, quantity: Number(r.quantity) })),
        expiredBatches,
        expiringBatches,
        openSessions,
        recentSales,
        hourlyRevenue,
      },
    });
  } catch (error) {
    return handleApiError(error, "REPORTS");
  }
}

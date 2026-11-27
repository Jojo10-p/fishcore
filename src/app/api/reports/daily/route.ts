import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, getCurrentUser, handleApiError, hasCompanyWideAccess, requireCenterAccess, requireCompany } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { ISO_DATE, periodBounds, todayIn } from "@/lib/time";

const num = (v: Prisma.Decimal | number | bigint | null | undefined) => Number(v ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

// GET /api/reports/daily?date=AAAA-MM-JJ&centerId=…
// Rapport journalier : chaque article vendu dans la journée (quantité, prix, total),
// les encaissements par moyen de paiement, les réductions et les annulations.
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    // Tout utilisateur de l'entreprise peut tirer le rapport ; le bénéfice reste pour le gérant et la direction
    const seesProfit = hasPermission(user.role, "report:view");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        tradeName: true,
        legalName: true,
        logoUrl: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        poBox: true,
        taxId: true,
        tradeRegNumber: true,
        currency: true,
        vatEnabled: true,
        invoiceNotes: true,
        timezone: true,
      },
    });
    const tz = company.timezone || "Africa/Porto-Novo";
    const date = sp.get("date") ?? todayIn(tz);
    if (!ISO_DATE.test(date)) throw new ApiError(400, "Date invalide");
    let centerId = sp.get("centerId") || null;
    if (!centerId && !hasCompanyWideAccess(user)) {
      // Caissier sans boutique précisée : sa boutique (une seule), sinon il doit choisir
      if (user.centerIds.length !== 1) throw new ApiError(400, "Choisissez la boutique", "CENTER_REQUIRED");
      centerId = user.centerIds[0];
    }
    if (centerId) await requireCenterAccess(user, centerId);
    const { start, end } = periodBounds(date, date, tz);
    const centerSql = centerId ? Prisma.sql`AND s."centerId" = ${centerId}` : Prisma.empty;

    const expenseCenterSql = centerId ? Prisma.sql`AND e."centerId" = ${centerId}` : Prisma.empty;
    const [lines, totals, payments, refunds, cancelled, center, costs, expenses] = await Promise.all([
      // Une ligne par article et par façon de le vendre (bidon, litre, ½ L…) ; prix moyen si plusieurs prix
      prisma.$queryRaw<Array<{ productId: string; name: string; unit: string | null; qty: Prisma.Decimal; total: Prisma.Decimal; sales: bigint; minPrice: Prisma.Decimal; maxPrice: Prisma.Decimal }>>`
        SELECT sl."productId", p."name", u."symbol" AS unit, SUM(sl."quantity") AS qty, SUM(sl."lineTotal") AS total,
               COUNT(DISTINCT sl."saleId") AS sales, MIN(sl."unitPrice" - sl."discount") AS "minPrice", MAX(sl."unitPrice" - sl."discount") AS "maxPrice"
          FROM "sale_lines" sl
          JOIN "sales" s ON s."id" = sl."saleId"
          JOIN "products" p ON p."id" = sl."productId"
          LEFT JOIN "units" u ON u."id" = COALESCE(sl."unitId", p."baseUnitId")
         WHERE s."companyId" = ${companyId} AND s."status" <> 'CANCELLED' AND s."createdAt" BETWEEN ${start} AND ${end} ${centerSql}
         GROUP BY sl."productId", p."name", u."symbol"
         ORDER BY p."name", u."symbol"`,
      prisma.$queryRaw<[{ count: bigint; total: Prisma.Decimal | null; tax: Prisma.Decimal | null; cart: Prisma.Decimal | null; withDiscount: bigint; first: Date | null; last: Date | null }]>`
        SELECT COUNT(*) AS count, SUM(s."totalAmount") AS total, SUM(s."taxAmount") AS tax, SUM(s."cartDiscount") AS cart,
               COUNT(*) FILTER (WHERE s."cartDiscount" > 0) AS "withDiscount", MIN(s."createdAt") AS first, MAX(s."createdAt") AS last
          FROM "sales" s
         WHERE s."companyId" = ${companyId} AND s."status" <> 'CANCELLED' AND s."createdAt" BETWEEN ${start} AND ${end} ${centerSql}`,
      prisma.$queryRaw<Array<{ method: string; amount: Prisma.Decimal }>>`
        SELECT p."method", SUM(p."amount") AS amount
          FROM "payments" p JOIN "sales" s ON s."id" = p."saleId"
         WHERE s."companyId" = ${companyId} AND s."status" <> 'CANCELLED' AND s."createdAt" BETWEEN ${start} AND ${end} ${centerSql}
         GROUP BY 1 ORDER BY 2 DESC`,
      prisma.$queryRaw<[{ amount: Prisma.Decimal | null }]>`
        SELECT SUM(r."amount") AS amount FROM "refunds" r JOIN "sales" s ON s."id" = r."saleId"
         WHERE s."companyId" = ${companyId} AND r."createdAt" BETWEEN ${start} AND ${end} ${centerSql}`,
      prisma.$queryRaw<[{ count: bigint; total: Prisma.Decimal | null }]>`
        SELECT COUNT(*) AS count, SUM(s."totalAmount") AS total FROM "sales" s
         WHERE s."companyId" = ${companyId} AND s."status" = 'CANCELLED' AND s."createdAt" BETWEEN ${start} AND ${end} ${centerSql}`,
      centerId ? prisma.center.findUnique({ where: { id: centerId }, select: { name: true, address: true, city: true, phone: true } }) : null,
      // Prix d'achat des articles vendus (figé sur chaque ligne au moment de la vente)
      prisma.$queryRaw<[{ cost: Prisma.Decimal | null }]>`
        SELECT SUM(sl."costAmount") AS cost FROM "sale_lines" sl JOIN "sales" s ON s."id" = sl."saleId"
         WHERE s."companyId" = ${companyId} AND s."status" <> 'CANCELLED' AND s."createdAt" BETWEEN ${start} AND ${end} ${centerSql}`,
      // Dépenses du jour (non annulées)
      prisma.$queryRaw<[{ amount: Prisma.Decimal | null }]>`
        SELECT SUM(e."amount") AS amount FROM "expenses" e
         WHERE e."companyId" = ${companyId} AND e."isCancelled" = FALSE AND e."date" BETWEEN ${start} AND ${end} ${expenseCenterSql}`,
    ]);

    const items = lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      unit: l.unit,
      quantity: num(l.qty),
      sales: Number(l.sales),
      unitPrice: num(l.minPrice) === num(l.maxPrice) ? num(l.minPrice) : null, // plusieurs prix dans la journée → prix moyen
      averagePrice: num(l.qty) > 0 ? r2(num(l.total) / num(l.qty)) : 0,
      total: r2(num(l.total)),
    }));
    const t = totals[0];
    // Bénéfice de la journée : ventes (hors TVA) − prix d'achat des articles vendus − dépenses
    const salesHT = num(t.total) - num(t.tax);
    const costOfSales = num(costs[0].cost);
    const expensesTotal = num(expenses[0].amount);
    const profit = {
      salesHT: r2(salesHT),
      costOfSales: r2(costOfSales),
      grossProfit: r2(salesHT - costOfSales),
      expenses: r2(expensesTotal),
      netProfit: r2(salesHT - costOfSales - expensesTotal),
    };
    return NextResponse.json({
      success: true,
      data: {
        date,
        company,
        center,
        items,
        summary: {
          salesCount: Number(t.count),
          articlesTotal: r2(items.reduce((s, i) => s + i.total, 0)),
          cartDiscounts: r2(num(t.cart)),
          salesWithDiscount: Number(t.withDiscount),
          netTotal: r2(num(t.total)),
          firstSale: t.first,
          lastSale: t.last,
          cancelledCount: Number(cancelled[0].count),
          cancelledTotal: r2(num(cancelled[0].total)),
          refunds: r2(num(refunds[0].amount)),
        },
        ...(seesProfit ? { profit } : {}),
        payments: payments.map((p) => ({ method: p.method, amount: r2(num(p.amount)) })),
        printedBy: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      },
    });
  } catch (error) {
    return handleApiError(error, "REPORTS/DAILY");
  }
}

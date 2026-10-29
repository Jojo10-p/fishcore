import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Rapport financier (cahier §14, §15)
// ─────────────────────────────────────────────
// Le chiffre d'affaires, les encaissements et le bénéfice ne sont pas confondus :
//  - Chiffre d'affaires : ventes validées de la période (TTC, et HT = TTC − TVA).
//  - Coût des ventes : coût de revient figé sur chaque ligne au moment de la vente.
//  - Marge brute = CA HT − coût des ventes.
//  - Résultat estimé = marge brute − dépenses.
//  - Encaissements : argent réellement reçu (ventes hors crédit + règlements
//    clients − remboursements), par moyen de paiement.

const num = (v: Prisma.Decimal | number | bigint | null | undefined) => Number(v ?? 0);
const round = (n: number) => Math.round(n * 100) / 100;

export interface FinanceScope {
  companyId: string;
  /** Centres inclus (null = tous les centres de l'entreprise). */
  centerIds: string[] | null;
  start: Date;
  end: Date;
  timeZone: string;
}

export async function computeFinance(scope: FinanceScope) {
  const { companyId, centerIds, start, end, timeZone } = scope;
  const centerIn = (col: Prisma.Sql) =>
    centerIds === null ? Prisma.empty : centerIds.length ? Prisma.sql`AND ${col} IN (${Prisma.join(centerIds)})` : Prisma.sql`AND FALSE`;
  const saleScope = Prisma.sql`s."companyId" = ${companyId} AND s."createdAt" BETWEEN ${start} AND ${end} ${centerIn(Prisma.sql`s."centerId"`)}`;

  const [sales, cancelled, cogs, payments, refunds, customerPayments, expenses, discrepancies, byCenter, byCashier, topProducts, daily, receivables, payables] =
    await Promise.all([
      prisma.$queryRaw<[{ count: bigint; ttc: Prisma.Decimal | null; tax: Prisma.Decimal | null; discount: Prisma.Decimal | null }]>`
        SELECT COUNT(*) AS count, SUM(s."totalAmount") AS ttc, SUM(s."taxAmount") AS tax, SUM(s."discountAmount") AS discount
          FROM "sales" s WHERE ${saleScope} AND s."status" <> 'CANCELLED'`,
      prisma.$queryRaw<[{ count: bigint; amount: Prisma.Decimal | null }]>`
        SELECT COUNT(*) AS count, SUM(s."totalAmount") AS amount FROM "sales" s WHERE ${saleScope} AND s."status" = 'CANCELLED'`,
      prisma.$queryRaw<[{ cost: Prisma.Decimal | null }]>`
        SELECT SUM(sl."costAmount") AS cost FROM "sale_lines" sl JOIN "sales" s ON s."id" = sl."saleId"
         WHERE ${saleScope} AND s."status" <> 'CANCELLED'`,
      // Encaissements des ventes de la période (toutes, y compris celles annulées ensuite :
      // leur remboursement est compté à part)
      prisma.$queryRaw<Array<{ method: string; amount: Prisma.Decimal }>>`
        SELECT p."method", SUM(p."amount") AS amount FROM "payments" p JOIN "sales" s ON s."id" = p."saleId"
         WHERE ${saleScope} GROUP BY p."method"`,
      prisma.$queryRaw<Array<{ method: string; amount: Prisma.Decimal }>>`
        SELECT r."method", SUM(r."amount") AS amount FROM "refunds" r JOIN "sales" s ON s."id" = r."saleId"
         WHERE s."companyId" = ${companyId} AND r."createdAt" BETWEEN ${start} AND ${end} ${centerIn(Prisma.sql`s."centerId"`)}
         GROUP BY r."method"`,
      prisma.$queryRaw<Array<{ method: string; amount: Prisma.Decimal }>>`
        SELECT cp."method", SUM(cp."amount") AS amount
          FROM "customer_payments" cp
          LEFT JOIN "cash_sessions" cs ON cs."id" = cp."sessionId"
          LEFT JOIN "cash_registers" cr ON cr."id" = cs."cashRegisterId"
         WHERE cp."companyId" = ${companyId} AND cp."createdAt" BETWEEN ${start} AND ${end}
           ${centerIds === null ? Prisma.empty : centerIn(Prisma.sql`cr."centerId"`)}
         GROUP BY cp."method"`,
      prisma.$queryRaw<Array<{ category: string; amount: Prisma.Decimal; count: bigint }>>`
        SELECT e."category", SUM(e."amount") AS amount, COUNT(*) AS count FROM "expenses" e
         WHERE e."companyId" = ${companyId} AND e."isCancelled" = FALSE AND e."date" BETWEEN ${start} AND ${end}
           ${centerIn(Prisma.sql`e."centerId"`)}
         GROUP BY e."category" ORDER BY amount DESC`,
      prisma.$queryRaw<[{ total: Prisma.Decimal | null; count: bigint }]>`
        SELECT SUM(cs."discrepancy") AS total, COUNT(*) FILTER (WHERE cs."discrepancy" <> 0) AS count
          FROM "cash_sessions" cs JOIN "cash_registers" cr ON cr."id" = cs."cashRegisterId" JOIN "centers" c ON c."id" = cr."centerId"
         WHERE c."companyId" = ${companyId} AND cs."closedAt" BETWEEN ${start} AND ${end} ${centerIn(Prisma.sql`cr."centerId"`)}`,
      prisma.$queryRaw<Array<{ centerId: string; name: string; count: bigint }>>`
        SELECT s."centerId", c."name", COUNT(*) AS count
          FROM "sales" s JOIN "centers" c ON c."id" = s."centerId"
         WHERE ${saleScope} AND s."status" <> 'CANCELLED'
         GROUP BY s."centerId", c."name"`,
      prisma.$queryRaw<Array<{ cashierId: string; firstName: string; lastName: string; count: bigint; ttc: Prisma.Decimal }>>`
        SELECT s."cashierId", u."firstName", u."lastName", COUNT(*) AS count, SUM(s."totalAmount") AS ttc
          FROM "sales" s JOIN "users" u ON u."id" = s."cashierId"
         WHERE ${saleScope} AND s."status" <> 'CANCELLED'
         GROUP BY s."cashierId", u."firstName", u."lastName" ORDER BY ttc DESC`,
      prisma.$queryRaw<Array<{ productId: string; name: string; unit: string; qty: Prisma.Decimal; ttc: Prisma.Decimal; tax: Prisma.Decimal; cost: Prisma.Decimal }>>`
        SELECT sl."productId", p."name", u."symbol" AS unit, SUM(sl."baseQuantity") AS qty, SUM(sl."lineTotal") AS ttc,
               SUM(sl."taxAmount") AS tax, SUM(sl."costAmount") AS cost
          FROM "sale_lines" sl JOIN "sales" s ON s."id" = sl."saleId"
          JOIN "products" p ON p."id" = sl."productId" JOIN "units" u ON u."id" = p."baseUnitId"
         WHERE ${saleScope} AND s."status" <> 'CANCELLED'
         GROUP BY sl."productId", p."name", u."symbol" ORDER BY ttc DESC LIMIT 15`,
      prisma.$queryRaw<Array<{ day: Date; ttc: Prisma.Decimal; count: bigint }>>`
        SELECT (s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date AS day, SUM(s."totalAmount") AS ttc, COUNT(*) AS count
          FROM "sales" s WHERE ${saleScope} AND s."status" <> 'CANCELLED'
         GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<[{ total: Prisma.Decimal | null }]>`
        SELECT
          COALESCE((SELECT SUM(p."amount") FROM "payments" p JOIN "sales" s ON s."id" = p."saleId" WHERE s."companyId" = ${companyId} AND p."method" = 'CREDIT'), 0)
        - COALESCE((SELECT SUM(r."amount") FROM "refunds" r JOIN "sales" s ON s."id" = r."saleId" WHERE s."companyId" = ${companyId} AND r."method" = 'CREDIT'), 0)
        - COALESCE((SELECT SUM(cp."amount") FROM "customer_payments" cp WHERE cp."companyId" = ${companyId}), 0) AS total`,
      prisma.$queryRaw<[{ total: Prisma.Decimal | null; overdue: Prisma.Decimal | null }]>`
        SELECT SUM("totalAmount" - "paidAmount") AS total,
               SUM(CASE WHEN "dueDate" < NOW() THEN "totalAmount" - "paidAmount" ELSE 0 END) AS overdue
          FROM "purchases" pu WHERE pu."companyId" = ${companyId} ${centerIn(Prisma.sql`pu."centerId"`)}`,
    ]);

  // Marge par centre (requête dédiée : coût et TVA par centre)
  const centerMargins = await prisma.$queryRaw<Array<{ centerId: string; ttc: Prisma.Decimal; tax: Prisma.Decimal; cost: Prisma.Decimal }>>`
    SELECT s."centerId", SUM(sl."lineTotal") AS ttc, SUM(sl."taxAmount") AS tax, SUM(sl."costAmount") AS cost
      FROM "sale_lines" sl JOIN "sales" s ON s."id" = sl."saleId"
     WHERE ${saleScope} AND s."status" <> 'CANCELLED'
     GROUP BY s."centerId"`;
  const marginByCenter = new Map(centerMargins.map((m) => [m.centerId, m]));

  const revenueTTC = num(sales[0].ttc);
  const tax = num(sales[0].tax);
  const revenueHT = round(revenueTTC - tax);
  const costOfSales = round(num(cogs[0].cost));
  const grossMargin = round(revenueHT - costOfSales);
  const expensesTotal = round(expenses.reduce((s, e) => s + num(e.amount), 0));

  // Encaissements nets par moyen de paiement (le crédit n'est pas un encaissement)
  const methods = new Map<string, number>();
  const add = (method: string, amount: number) => methods.set(method, round((methods.get(method) ?? 0) + amount));
  for (const p of payments) if (p.method !== "CREDIT") add(p.method, num(p.amount));
  for (const c of customerPayments) add(c.method, num(c.amount));
  for (const r of refunds) if (r.method !== "CREDIT") add(r.method, -num(r.amount));
  const creditGranted = num(payments.find((p) => p.method === "CREDIT")?.amount);

  return {
    period: { start, end },
    sales: { count: Number(sales[0].count), discounts: round(num(sales[0].discount)) },
    revenueTTC: round(revenueTTC),
    tax: round(tax),
    revenueHT,
    costOfSales,
    grossMargin,
    marginRate: revenueHT > 0 ? round((grossMargin / revenueHT) * 100) : 0,
    expenses: { total: expensesTotal, byCategory: expenses.map((e) => ({ category: e.category, amount: round(num(e.amount)), count: Number(e.count) })) },
    netResult: round(grossMargin - expensesTotal),
    collections: {
      total: round([...methods.values()].reduce((s, v) => s + v, 0)),
      byMethod: [...methods.entries()].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
      creditGranted: round(creditGranted),
      customerPayments: round(customerPayments.reduce((s, c) => s + num(c.amount), 0)),
      refunds: round(refunds.reduce((s, r) => s + num(r.amount), 0)),
    },
    cancelled: { count: Number(cancelled[0].count), amount: round(num(cancelled[0].amount)) },
    cashDiscrepancy: { total: round(num(discrepancies[0].total)), sessions: Number(discrepancies[0].count) },
    receivables: round(num(receivables[0].total)),
    payables: { total: round(num(payables[0].total)), overdue: round(num(payables[0].overdue)) },
    byCenter: byCenter
      .map((c) => {
        const m = marginByCenter.get(c.centerId);
        const ht = num(m?.ttc) - num(m?.tax);
        return { centerId: c.centerId, name: c.name, count: Number(c.count), revenueTTC: round(num(m?.ttc)), grossMargin: round(ht - num(m?.cost)) };
      })
      .sort((a, b) => b.revenueTTC - a.revenueTTC),
    byCashier: byCashier.map((c) => ({ cashierId: c.cashierId, name: `${c.firstName} ${c.lastName}`, count: Number(c.count), revenueTTC: round(num(c.ttc)) })),
    topProducts: topProducts.map((p) => {
      const ht = num(p.ttc) - num(p.tax);
      return {
        productId: p.productId,
        name: p.name,
        unit: p.unit,
        quantity: num(p.qty),
        revenueTTC: round(num(p.ttc)),
        grossMargin: round(ht - num(p.cost)),
        marginRate: ht > 0 ? round(((ht - num(p.cost)) / ht) * 100) : 0,
      };
    }),
    daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), revenueTTC: round(num(d.ttc)), count: Number(d.count) })),
  };
}

export type FinanceReport = Awaited<ReturnType<typeof computeFinance>>;

const METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  MOBILE_MONEY: "Mobile money",
  CARD: "Carte",
  TRANSFER: "Virement",
  CREDIT: "Crédit",
  MIXED: "Mixte",
};

/** Export tableur (CSV « ; » + BOM : s'ouvre directement dans Excel en français). */
export function financeToCsv(r: FinanceReport, label: string): string {
  const rows: Array<Array<string | number>> = [
    [`Rapport financier — ${label}`],
    [],
    ["Indicateur", "Montant"],
    ["Ventes (nombre)", r.sales.count],
    ["Chiffre d'affaires TTC", r.revenueTTC],
    ["TVA collectée", r.tax],
    ["Chiffre d'affaires HT", r.revenueHT],
    ["Coût des ventes", r.costOfSales],
    ["Marge brute", r.grossMargin],
    ["Taux de marge (%)", r.marginRate],
    ["Dépenses", r.expenses.total],
    ["Résultat estimé", r.netResult],
    ["Encaissements nets", r.collections.total],
    ["Crédit accordé", r.collections.creditGranted],
    ["Ventes annulées (montant)", r.cancelled.amount],
    ["Écarts de caisse", r.cashDiscrepancy.total],
    ["Créances clients (à ce jour)", r.receivables],
    ["Dettes fournisseurs (à ce jour)", r.payables.total],
    [],
    ["Encaissements par moyen", "Montant"],
    ...r.collections.byMethod.map((m) => [METHOD_LABELS[m.method] ?? m.method, m.amount]),
    [],
    ["Dépenses par catégorie", "Montant"],
    ...r.expenses.byCategory.map((e) => [e.category, e.amount]),
    [],
    ["Centre", "Ventes", "CA TTC", "Marge brute"],
    ...r.byCenter.map((c) => [c.name, c.count, c.revenueTTC, c.grossMargin]),
    [],
    ["Article", "Quantité", "Unité", "CA TTC", "Marge brute", "Taux de marge (%)"],
    ...r.topProducts.map((p) => [p.name, p.quantity, p.unit, p.revenueTTC, p.grossMargin, p.marginRate]),
  ];
  const cell = (v: string | number) => {
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}

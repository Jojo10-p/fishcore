import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeFinance } from "@/lib/reports";

// ─────────────────────────────────────────────
// Comptabilité (direction) — plan SYSCOHADA simplifié
// ─────────────────────────────────────────────
// Le logiciel tient déjà tout : ventes, remboursements, arrivages, règlements
// fournisseurs, dépenses, écarts de caisse. On en tire les écritures comptables
// (journal), la balance des comptes, le compte de résultat, la trésorerie et une
// situation à ce jour. Les ventes sont regroupées par jour et par moyen de
// paiement (journal des ventes récapitulatif), comme le fait un comptable.
// Le plan de comptes est volontairement court : à faire valider par le comptable.

const num = (v: Prisma.Decimal | number | bigint | null | undefined) => Number(v ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export const ACCOUNTS: Record<string, string> = {
  "401": "Fournisseurs",
  "411": "Clients",
  "4431": "TVA facturée sur ventes",
  "521": "Banque",
  "5215": "Mobile money",
  "571": "Caisse",
  "601": "Achats de marchandises",
  "6015": "Frais sur achats (transport, manutention)",
  "6051": "Eau",
  "6052": "Électricité",
  "6053": "Carburant",
  "6055": "Fournitures de bureau",
  "6056": "Petit matériel et froid",
  "618": "Transports",
  "622": "Loyers",
  "624": "Entretien et réparations",
  "628": "Télécommunications",
  "638": "Autres charges externes",
  "64": "Impôts et taxes",
  "658": "Charges diverses",
  "6581": "Manquants de caisse",
  "661": "Salaires du personnel",
  "701": "Ventes de marchandises",
  "7581": "Excédents de caisse",
};

const TREASURY: Record<string, string> = { CASH: "571", MIXED: "571", MOBILE_MONEY: "5215", TRANSFER: "521", CARD: "521", CREDIT: "411" };
export const treasuryAccount = (method: string | null | undefined) => TREASURY[method ?? "CASH"] ?? "571";

const EXPENSE_ACCOUNTS: Array<[RegExp, string]> = [
  [/loyer/i, "622"],
  [/électricit|electricit/i, "6052"],
  [/^eau/i, "6051"],
  [/salaire/i, "661"],
  [/carburant|essence|gasoil/i, "6053"],
  [/transport/i, "618"],
  [/manutention/i, "6015"],
  [/glace|froid|petit matériel/i, "6056"],
  [/entretien|réparation/i, "624"],
  [/communication|téléphone|internet|crédit/i, "628"],
  [/impôt|taxe/i, "64"],
  [/fourniture/i, "6055"],
  [/repas/i, "638"],
];
export const expenseAccount = (category: string) => EXPENSE_ACCOUNTS.find(([re]) => re.test(category))?.[1] ?? "658";

export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
}
export interface JournalEntry {
  date: string; // AAAA-MM-JJ (fuseau de l'entreprise)
  journal: "VE" | "AC" | "TR" | "OD"; // Ventes, Achats, Trésorerie, Opérations diverses
  piece: string;
  label: string;
  lines: JournalLine[];
}

export interface AccountingScope {
  companyId: string;
  centerIds: string[] | null;
  start: Date;
  end: Date;
  timeZone: string;
}

export async function computeAccounting(scope: AccountingScope) {
  const { companyId, centerIds, start, end, timeZone } = scope;
  const centerIn = (col: Prisma.Sql) =>
    centerIds === null ? Prisma.empty : centerIds.length ? Prisma.sql`AND ${col} IN (${Prisma.join(centerIds)})` : Prisma.sql`AND FALSE`;
  const day = (col: Prisma.Sql) => Prisma.sql`to_char((${col} AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD')`;

  const [salesByDay, payByDay, refunds, receipts, supplierPayments, expenses, sessions] = await Promise.all([
    // Ventes du jour (toutes : une vente annulée ensuite est contre-passée par son remboursement)
    prisma.$queryRaw<Array<{ d: string; count: bigint; ttc: Prisma.Decimal; tax: Prisma.Decimal }>>`
      SELECT ${day(Prisma.sql`s."createdAt"`)} AS d, COUNT(*) AS count, SUM(s."totalAmount") AS ttc, SUM(s."taxAmount") AS tax
        FROM "sales" s WHERE s."companyId" = ${companyId} AND s."createdAt" BETWEEN ${start} AND ${end} ${centerIn(Prisma.sql`s."centerId"`)}
       GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ d: string; method: string; amount: Prisma.Decimal }>>`
      SELECT ${day(Prisma.sql`s."createdAt"`)} AS d, p."method", SUM(p."amount") AS amount
        FROM "payments" p JOIN "sales" s ON s."id" = p."saleId"
       WHERE s."companyId" = ${companyId} AND s."createdAt" BETWEEN ${start} AND ${end} ${centerIn(Prisma.sql`s."centerId"`)}
       GROUP BY 1, 2 ORDER BY 1`,
    prisma.$queryRaw<Array<{ d: string; method: string; amount: Prisma.Decimal; tax: Prisma.Decimal; numbers: string }>>`
      SELECT ${day(Prisma.sql`r."createdAt"`)} AS d, r."method", SUM(r."amount") AS amount,
             SUM(CASE WHEN s."totalAmount" > 0 THEN r."amount" * s."taxAmount" / s."totalAmount" ELSE 0 END) AS tax,
             string_agg(DISTINCT s."saleNumber", ', ') AS numbers
        FROM "refunds" r JOIN "sales" s ON s."id" = r."saleId"
       WHERE s."companyId" = ${companyId} AND r."createdAt" BETWEEN ${start} AND ${end} ${centerIn(Prisma.sql`s."centerId"`)}
       GROUP BY 1, 2 ORDER BY 1`,
    prisma.goodsReceipt.findMany({
      where: { center: { companyId }, isValidated: true, validatedAt: { gte: start, lte: end }, ...(centerIds ? { centerId: { in: centerIds } } : {}) },
      select: {
        id: true,
        reference: true,
        validatedAt: true,
        paymentMode: true,
        paymentMethod: true,
        transportCost: true,
        iceCost: true,
        handlingCost: true,
        otherCosts: true,
        supplier: { select: { name: true } },
        purchaseId: true,
        lines: { select: { totalPrice: true } },
      },
      orderBy: { validatedAt: "asc" },
    }),
    prisma.supplierPayment.findMany({
      where: { companyId, createdAt: { gte: start, lte: end }, ...(centerIds ? { purchase: { centerId: { in: centerIds } } } : {}) },
      select: { id: true, createdAt: true, amount: true, method: true, reference: true, atReceipt: true, supplier: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expense.findMany({
      where: { companyId, isCancelled: false, date: { gte: start, lte: end }, ...(centerIds ? { centerId: { in: centerIds } } : {}) },
      select: { id: true, date: true, category: true, amount: true, method: true, description: true, payee: true },
      orderBy: { date: "asc" },
    }),
    prisma.$queryRaw<Array<{ d: string; discrepancy: Prisma.Decimal; register: string }>>`
      SELECT ${day(Prisma.sql`cs."closedAt"`)} AS d, cs."discrepancy", cr."name" AS register
        FROM "cash_sessions" cs JOIN "cash_registers" cr ON cr."id" = cs."cashRegisterId" JOIN "centers" c ON c."id" = cr."centerId"
       WHERE c."companyId" = ${companyId} AND cs."closedAt" BETWEEN ${start} AND ${end} AND cs."discrepancy" <> 0 ${centerIn(Prisma.sql`cr."centerId"`)}
       ORDER BY cs."closedAt"`,
  ]);

  const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const frDay = (iso: string) => iso.split("-").reverse().join("/");
  const entries: JournalEntry[] = [];

  // Journal des ventes : un récapitulatif par jour
  for (const s of salesByDay) {
    const pays = payByDay.filter((p) => p.d === s.d);
    const cashed = r2(pays.reduce((t, p) => t + num(p.amount), 0));
    const tax = r2(num(s.tax));
    const lines: JournalLine[] = pays.map((p) => ({ account: treasuryAccount(p.method), debit: r2(num(p.amount)), credit: 0 }));
    lines.push({ account: "701", debit: 0, credit: r2(cashed - tax) });
    if (tax) lines.push({ account: "4431", debit: 0, credit: tax });
    entries.push({ date: s.d, journal: "VE", piece: `VE-${s.d}`, label: `Ventes du ${frDay(s.d)} (${Number(s.count)} ticket${Number(s.count) > 1 ? "s" : ""})`, lines: merge(lines) });
  }
  // Remboursements (ventes annulées)
  for (const r of refunds) {
    const amount = r2(num(r.amount));
    const tax = r2(num(r.tax));
    entries.push({
      date: r.d,
      journal: "VE",
      piece: `RB-${r.d}`,
      label: `Remboursement — ventes annulées ${r.numbers}`,
      lines: merge([{ account: "701", debit: r2(amount - tax), credit: 0 }, ...(tax ? [{ account: "4431", debit: tax, credit: 0 }] : []), { account: treasuryAccount(r.method), debit: 0, credit: amount }]),
    });
  }
  // Journal des achats : chaque arrivage de marchandise
  for (const g of receipts) {
    const goods = r2(g.lines.reduce((t, l) => t + num(l.totalPrice), 0));
    const fees = r2(num(g.transportCost) + num(g.iceCost) + num(g.handlingCost) + num(g.otherCosts));
    const total = r2(goods + fees);
    if (!total) continue;
    // Avec fournisseur : la dette (401) est soldée par le règlement ; sans fournisseur : payé directement
    const counter = g.purchaseId ? "401" : treasuryAccount(g.paymentMethod);
    entries.push({
      date: localDay(g.validatedAt!),
      journal: "AC",
      piece: g.reference || `AR-${g.id.slice(-6).toUpperCase()}`,
      label: `Achat de marchandises${g.supplier ? ` — ${g.supplier.name}` : ""}${g.paymentMode === "CREDIT" ? " (à crédit)" : ""}`,
      lines: merge([{ account: "601", debit: goods, credit: 0 }, ...(fees ? [{ account: "6015", debit: fees, credit: 0 }] : []), { account: counter, debit: 0, credit: total }]),
    });
  }
  // Règlements des fournisseurs
  for (const p of supplierPayments) {
    const amount = r2(num(p.amount));
    entries.push({
      date: localDay(p.createdAt),
      journal: "TR",
      piece: p.reference || `RF-${p.id.slice(-6).toUpperCase()}`,
      label: `Règlement ${p.supplier.name}${p.atReceipt ? " (payé à l'arrivage)" : ""}`,
      lines: [
        { account: "401", debit: amount, credit: 0 },
        { account: treasuryAccount(p.method), debit: 0, credit: amount },
      ],
    });
  }
  // Dépenses
  for (const e of expenses) {
    const amount = r2(num(e.amount));
    entries.push({
      date: localDay(e.date),
      journal: "TR",
      piece: `DE-${e.id.slice(-6).toUpperCase()}`,
      label: `${e.category}${e.description ? ` — ${e.description}` : ""}${e.payee ? ` (${e.payee})` : ""}`,
      lines: [
        { account: expenseAccount(e.category), debit: amount, credit: 0 },
        { account: treasuryAccount(e.method), debit: 0, credit: amount },
      ],
    });
  }
  // Écarts de caisse à la clôture
  for (const s of sessions) {
    const gap = r2(num(s.discrepancy));
    entries.push({
      date: s.d,
      journal: "OD",
      piece: `EC-${s.d}`,
      label: `${gap < 0 ? "Manquant" : "Excédent"} de caisse — ${s.register}`,
      lines:
        gap < 0
          ? [
              { account: "6581", debit: -gap, credit: 0 },
              { account: "571", debit: 0, credit: -gap },
            ]
          : [
              { account: "571", debit: gap, credit: 0 },
              { account: "7581", debit: 0, credit: gap },
            ],
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.journal.localeCompare(b.journal));

  // Balance des comptes
  const balanceMap = new Map<string, { debit: number; credit: number }>();
  for (const e of entries)
    for (const l of e.lines) {
      const b = balanceMap.get(l.account) ?? { debit: 0, credit: 0 };
      b.debit = r2(b.debit + l.debit);
      b.credit = r2(b.credit + l.credit);
      balanceMap.set(l.account, b);
    }
  const balance = [...balanceMap.entries()]
    .map(([account, b]) => ({ account, name: ACCOUNTS[account] ?? account, debit: b.debit, credit: b.credit, solde: r2(b.debit - b.credit) }))
    .sort((a, b) => a.account.localeCompare(b.account));

  // Trésorerie de la période (entrées / sorties par compte)
  const treasury = balance
    .filter((b) => b.account.startsWith("5"))
    .map((b) => ({ account: b.account, name: b.name, entrees: b.debit, sorties: b.credit, variation: b.solde }));

  // Compte de résultat : ventes HT − coût d'achat des marchandises vendues − charges
  const fin = await computeFinance({ companyId, centerIds, start, end, timeZone });
  const chargeLines = new Map<string, number>();
  for (const e of expenses) {
    const acc = expenseAccount(e.category);
    chargeLines.set(acc, r2((chargeLines.get(acc) ?? 0) + num(e.amount)));
  }
  const manquants = r2(sessions.filter((s) => num(s.discrepancy) < 0).reduce((t, s) => t - num(s.discrepancy), 0));
  const excedents = r2(sessions.filter((s) => num(s.discrepancy) > 0).reduce((t, s) => t + num(s.discrepancy), 0));
  const charges = [...chargeLines.entries()].map(([account, amount]) => ({ account, name: ACCOUNTS[account] ?? account, amount })).sort((a, b) => b.amount - a.amount);
  const totalCharges = r2(charges.reduce((t, c) => t + c.amount, 0) + manquants);
  const purchases = r2(receipts.reduce((t, g) => t + g.lines.reduce((s, l) => s + num(l.totalPrice), 0), 0));
  const purchaseFees = r2(receipts.reduce((t, g) => t + num(g.transportCost) + num(g.iceCost) + num(g.handlingCost) + num(g.otherCosts), 0));
  const result = {
    ventesHT: fin.revenueHT,
    tvaCollectee: fin.tax,
    coutMarchandisesVendues: fin.costOfSales,
    margeCommerciale: fin.grossMargin,
    tauxMarge: fin.marginRate,
    charges,
    manquantsCaisse: manquants,
    excedentsCaisse: excedents,
    totalCharges,
    resultatNet: r2(fin.grossMargin - totalCharges + excedents),
    achatsPeriode: purchases,
    fraisSurAchats: purchaseFees,
  };

  // Situation à ce jour : stock, dettes fournisseurs
  const [stockValue, debts] = await Promise.all([
    prisma.$queryRaw<[{ value: Prisma.Decimal | null; items: bigint }]>`
      SELECT SUM(st."quantity" * st."avgCost") AS value, COUNT(*) FILTER (WHERE st."quantity" > 0) AS items
        FROM "stocks" st JOIN "centers" c ON c."id" = st."centerId"
       WHERE c."companyId" = ${companyId} AND st."quantity" > 0 ${centerIn(Prisma.sql`st."centerId"`)}`,
    prisma.purchase.findMany({
      where: { companyId, ...(centerIds ? { centerId: { in: centerIds } } : {}) },
      select: { totalAmount: true, paidAmount: true, dueDate: true, supplier: { select: { name: true } } },
    }),
  ]);
  const open = debts.map((d) => ({ ...d, left: r2(num(d.totalAmount) - num(d.paidAmount)) })).filter((d) => d.left > 0);
  const bySupplier = new Map<string, { left: number; overdue: number }>();
  const now = Date.now();
  for (const d of open) {
    const v = bySupplier.get(d.supplier.name) ?? { left: 0, overdue: 0 };
    v.left = r2(v.left + d.left);
    if (d.dueDate && d.dueDate.getTime() < now) v.overdue = r2(v.overdue + d.left);
    bySupplier.set(d.supplier.name, v);
  }
  const situation = {
    stockValue: r2(num(stockValue[0].value)),
    stockItems: Number(stockValue[0].items),
    supplierDebt: r2(open.reduce((t, d) => t + d.left, 0)),
    supplierDebtOverdue: r2([...bySupplier.values()].reduce((t, v) => t + v.overdue, 0)),
    suppliers: [...bySupplier.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.left - a.left),
  };

  const totals = { debit: r2(balance.reduce((t, b) => t + b.debit, 0)), credit: r2(balance.reduce((t, b) => t + b.credit, 0)) };
  return { entries, balance, totals, treasury, result, situation };
}

/** Lignes du même compte regroupées (débit et crédit séparés). */
function merge(lines: JournalLine[]): JournalLine[] {
  const m = new Map<string, JournalLine>();
  for (const l of lines) {
    if (!l.debit && !l.credit) continue;
    const key = `${l.account}:${l.debit ? "D" : "C"}`;
    const cur = m.get(key) ?? { account: l.account, debit: 0, credit: 0 };
    cur.debit = r2(cur.debit + l.debit);
    cur.credit = r2(cur.credit + l.credit);
    m.set(key, cur);
  }
  return [...m.values()];
}

export type Accounting = Awaited<ReturnType<typeof computeAccounting>>;

const csvCell = (v: string | number) => {
  const s = typeof v === "number" ? v.toFixed(2).replace(".", ",") : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Export pour Excel ou le logiciel du comptable : journal puis balance (séparateur « ; »). */
export function accountingToCsv(a: Accounting, label: string): string {
  const rows: Array<Array<string | number>> = [[`Comptabilité — ${label}`], [], ["JOURNAL"], ["Date", "Journal", "Pièce", "Compte", "Intitulé du compte", "Libellé", "Débit", "Crédit"]];
  for (const e of a.entries)
    for (const l of e.lines) rows.push([e.date.split("-").reverse().join("/"), e.journal, e.piece, l.account, ACCOUNTS[l.account] ?? l.account, e.label, l.debit, l.credit]);
  rows.push([], ["BALANCE"], ["Compte", "Intitulé", "Débit", "Crédit", "Solde"]);
  for (const b of a.balance) rows.push([b.account, b.name, b.debit, b.credit, b.solde]);
  rows.push(["", "TOTAL", a.totals.debit, a.totals.credit, a.totals.debit - a.totals.credit]);
  rows.push([], ["COMPTE DE RÉSULTAT"]);
  rows.push(["Ventes de marchandises (HT)", a.result.ventesHT]);
  rows.push(["Coût d'achat des marchandises vendues", -a.result.coutMarchandisesVendues]);
  rows.push(["Marge commerciale", a.result.margeCommerciale]);
  for (const c of a.result.charges) rows.push([`${c.account} ${c.name}`, -c.amount]);
  if (a.result.manquantsCaisse) rows.push(["Manquants de caisse", -a.result.manquantsCaisse]);
  if (a.result.excedentsCaisse) rows.push(["Excédents de caisse", a.result.excedentsCaisse]);
  rows.push(["RÉSULTAT NET (avant impôt)", a.result.resultatNet]);
  return "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}

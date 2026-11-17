/**
 * Comptabilité : écritures équilibrées, comptes justes, résultat et situation.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const usersRoute = await import("@/app/api/users/route");
const suppliersRoute = await import("@/app/api/suppliers/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const expensesRoute = await import("@/app/api/expenses/route");
const accountingRoute = await import("@/app/api/reports/accounting/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");

const ctx: Json = {};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo" }).format(new Date());
const acc = (data: Json, account: string) => data.balance.find((b: Json) => b.account === account) ?? { debit: 0, credit: 0, solde: 0 };

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Boutique Test", ownerName: "Direction Test", phone: "97000000", email: "direction@test.bj", password: "Motdepasse1", businessType: "LUBRICANTS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.owner = await login("direction@test.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Calavi", code: "CAL" } })).json.data.id;
  const company = (await prisma.company.findFirstOrThrow({ select: { id: true } })).id;
  const unit = await prisma.unit.findFirstOrThrow({ where: { companyId: company } });
  ctx.p = (await prisma.product.create({ data: { companyId: company, centerId: ctx.center, name: "VIGO — 1 L", baseUnitId: unit.id, sellingPrice: 1500, purchasePrice: 1000 } })).id;
  ctx.s = (await call(suppliersRoute.POST, { path: "/api/suppliers", cookie: ctx.owner, body: { name: "DISTRILUB" } })).json.data.id;
  const u = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email: "gerant@test.bj", password: "Motdepasse1", firstName: "Paul", lastName: "Test", role: "CENTER_MANAGER", centerIds: [ctx.center] } });
  assert.equal(u.status, 201);
  ctx.manager = await login("gerant@test.bj");

  // Achat : 20 bidons à 1 000 F, payés en espèces ; 10 autres à crédit avec 2 000 F de transport
  for (const [qty, payment, fees] of [
    [20, { mode: "PAID", method: "CASH" }, 0],
    [10, { mode: "CREDIT" }, 2000],
  ] as const) {
    const r = await call(receiptsRoute.POST, {
      path: "/api/goods-receipts",
      cookie: ctx.owner,
      body: { centerId: ctx.center, supplierId: ctx.s, transportCost: fees, lines: [{ productId: ctx.p, quantity: qty, unitPrice: 1000, totalPrice: qty * 1000 }] },
    });
    const v = await call(validateRoute.POST, { path: `/api/goods-receipts/${r.json.data.id}/validate`, cookie: ctx.owner, params: { id: r.json.data.id }, body: { payment } });
    assert.equal(v.status, 200, JSON.stringify(v.json));
  }
  // Ventes : 3 bidons en espèces, 2 en mobile money ; une vente annulée
  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: register.id, openingBalance: 0 } })).json.data.id;
  const sell = async (qty: number, method: string) => {
    const r = await call(salesRoute.POST, {
      path: "/api/sales",
      cookie: ctx.owner,
      body: { sessionId: ctx.session, idempotencyKey: randomUUID(), lines: [{ productId: ctx.p, quantity: qty, unitPrice: 1500 }], payments: [{ method, amount: qty * 1500 }] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.data.id as string;
  };
  await sell(3, "CASH");
  await sell(2, "MOBILE_MONEY");
  const cancelled = await sell(1, "CASH");
  const req = await call(cancelRoute.POST, { path: `/api/sales/${cancelled}/cancel`, cookie: ctx.owner, params: { id: cancelled }, body: { action: "request", reason: "Erreur de saisie" } });
  const ok = await call(cancelRoute.POST, {
    path: `/api/sales/${cancelled}/cancel`,
    cookie: ctx.manager,
    params: { id: cancelled },
    body: { action: "decide", cancellationId: req.json.data.id, decision: "APPROVED", refundSessionId: ctx.session },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // Dépense : électricité 5 000 F
  const e = await call(expensesRoute.POST, { path: "/api/expenses", cookie: ctx.owner, body: { centerId: ctx.center, category: "Électricité", amount: 5000, method: "CASH" } });
  assert.equal(e.status, 201, JSON.stringify(e.json));
  // Clôture avec 500 F de manquant (espèces attendues : 4 500 + 1 500 − 1 500 = 4 500)
  const c = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "close", sessionId: ctx.session, declaredBalance: 4000 } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  await waitForStockAlerts();
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("réservé à la direction", async () => {
  const r = await call(accountingRoute.GET, { path: `/api/reports/accounting?from=${today}&to=${today}`, cookie: ctx.manager });
  assert.equal(r.status, 403);
});

test("journal équilibré, comptes justes", async () => {
  const r = await call(accountingRoute.GET, { path: `/api/reports/accounting?from=${today}&to=${today}`, cookie: ctx.owner });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.totals.debit, d.totals.credit, "total débit = total crédit");
  for (const e of d.entries) {
    const dr = e.lines.reduce((t: number, l: Json) => t + l.debit, 0);
    const cr = e.lines.reduce((t: number, l: Json) => t + l.credit, 0);
    assert.ok(Math.abs(dr - cr) < 0.01, `écriture déséquilibrée : ${e.label}`);
  }
  // Achats : 20 000 + 10 000 de marchandises, 2 000 de frais ; 30 000 + 2 000 dus au fournisseur, 20 000 payés
  assert.equal(acc(d, "601").debit, 30000);
  assert.equal(acc(d, "6015").debit, 2000);
  assert.equal(acc(d, "401").solde, -12000, "reste dû au fournisseur");
  // Ventes : 9 000 F encaissés, 1 500 F remboursés → 7 500 F de ventes nettes
  assert.equal(acc(d, "701").credit - acc(d, "701").debit, 7500);
  assert.equal(acc(d, "5215").debit, 3000);
  // Caisse : +4 500 +1 500 (ventes) −1 500 (remboursement) −20 000 (achat payé) −5 000 (électricité) −500 (manquant)
  assert.equal(acc(d, "571").solde, -21000);
  assert.equal(acc(d, "6052").debit, 5000);
  assert.equal(acc(d, "6581").debit, 500);
});

test("compte de résultat et situation", async () => {
  const r = await call(accountingRoute.GET, { path: `/api/reports/accounting?from=${today}&to=${today}`, cookie: ctx.owner });
  const res = r.json.data.result;
  assert.equal(res.ventesHT, 7500);
  assert.ok(res.coutMarchandisesVendues > 0);
  assert.equal(res.margeCommerciale, res.ventesHT - res.coutMarchandisesVendues);
  assert.equal(res.totalCharges, 5500);
  assert.equal(res.resultatNet, res.margeCommerciale - 5500);
  const sit = r.json.data.situation;
  assert.equal(sit.supplierDebt, 12000);
  assert.equal(sit.suppliers[0].name, "DISTRILUB");
  assert.ok(sit.stockValue > 0);
});

test("export pour Excel", async () => {
  const { NextRequest } = await import("next/server");
  const res = await accountingRoute.GET(new NextRequest(`http://localhost/api/reports/accounting?from=${today}&to=${today}&format=csv`, { headers: { cookie: `fishcore-session=${ctx.owner}` } }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text.replace(/^\uFEFF/, ""), /^Comptabilité/);
  assert.match(text, /601;Achats de marchandises/);
  assert.match(text, /RÉSULTAT NET/);
});

/**
 * Rapport journalier : chaque article vendu dans la journée (quantité, prix unitaire, total),
 * encaissements par moyen, réductions, annulations ; réservé au gérant et à la direction.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const usersRoute = await import("@/app/api/users/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const dailyRoute = await import("@/app/api/reports/daily/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");

const ctx: Json = {};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo" }).format(new Date());

async function sell(lines: Array<[string, number, number]>, method = "CASH", cartDiscount = 0) {
  const total = lines.reduce((s, [, q, p]) => s + q * p, 0) - cartDiscount;
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.owner,
    body: {
      sessionId: ctx.session,
      idempotencyKey: randomUUID(),
      lines: lines.map(([productId, quantity, unitPrice]) => ({ productId, quantity, unitPrice })),
      payments: [{ method, amount: total }],
      ...(cartDiscount ? { cartDiscount } : {}),
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await waitForStockAlerts();
  return r.json.data.id as string;
}

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
  for (const [key, name, price] of [
    ["oil", "Huile 1 L", 1000],
    ["moto", "Huile moto 4T", 5000],
  ] as const) {
    ctx[key] = (await prisma.product.create({ data: { companyId: company, centerId: ctx.center, name, baseUnitId: unit.id, sellingPrice: price, purchasePrice: price * 0.8 } })).id;
    await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx[key], quantity: 100, avgCost: price * 0.8 } });
  }
  const u = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email: "caisse@test.bj", password: "Motdepasse1", firstName: "Samson", lastName: "Test", role: "CASHIER", centerIds: [ctx.center] } });
  assert.equal(u.status, 201);
  ctx.cashier = await login("caisse@test.bj");
  const m = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email: "gerant@test.bj", password: "Motdepasse1", firstName: "Paul", lastName: "Test", role: "CENTER_MANAGER", centerIds: [ctx.center] } });
  assert.equal(m.status, 201);
  ctx.manager = await login("gerant@test.bj");
  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: register.id, openingBalance: 0 } })).json.data.id;

  // Huile 1 L vendue 22 fois (10 + 12) ; huile moto 2 + 1 ; une vente annulée
  await sell([[ctx.oil, 10, 1000]]);
  await sell([[ctx.oil, 12, 1000], [ctx.moto, 2, 5000]], "MOBILE_MONEY", 2000);
  await sell([[ctx.moto, 1, 5000]]);
  const gone = await sell([[ctx.oil, 3, 1000]]);
  const req = await call(cancelRoute.POST, { path: `/api/sales/${gone}/cancel`, cookie: ctx.owner, params: { id: gone }, body: { action: "request", reason: "Erreur" } });
  const ok = await call(cancelRoute.POST, {
    path: `/api/sales/${gone}/cancel`,
    cookie: ctx.manager,
    params: { id: gone },
    body: { action: "decide", cancellationId: req.json.data.id, decision: "APPROVED", refundSessionId: ctx.session },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("réservé au gérant et à la direction", async () => {
  const r = await call(dailyRoute.GET, { path: `/api/reports/daily?date=${today}`, cookie: ctx.cashier });
  assert.equal(r.status, 403);
});

test("le gérant y a accès", async () => {
  const r = await call(dailyRoute.GET, { path: `/api/reports/daily?date=${today}&centerId=${ctx.center}`, cookie: ctx.manager });
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test("chaque article : quantité, prix unitaire, total ; annulation à part", async () => {
  const r = await call(dailyRoute.GET, { path: `/api/reports/daily?date=${today}&centerId=${ctx.center}`, cookie: ctx.owner });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.date, today);
  const oil = d.items.find((i: Json) => i.name === "Huile 1 L");
  assert.deepEqual([oil.quantity, oil.unitPrice, oil.total, oil.sales], [22, 1000, 22000, 2]);
  const moto = d.items.find((i: Json) => i.name === "Huile moto 4T");
  assert.deepEqual([moto.quantity, moto.unitPrice, moto.total], [3, 5000, 15000]);
  assert.equal(d.summary.salesCount, 3);
  assert.equal(d.summary.articlesTotal, 37000);
  assert.equal(d.summary.cartDiscounts, 2000);
  assert.equal(d.summary.netTotal, 35000);
  assert.equal(d.summary.cancelledCount, 1);
  assert.equal(d.summary.cancelledTotal, 3000);
  const pay = Object.fromEntries(d.payments.map((p: Json) => [p.method, p.amount]));
  assert.deepEqual(pay, { CASH: 15000, MOBILE_MONEY: 20000 });
});

test("autre jour : rapport vide ; date invalide refusée", async () => {
  const r = await call(dailyRoute.GET, { path: `/api/reports/daily?date=2020-01-01`, cookie: ctx.owner });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.items.length, 0);
  assert.equal(r.json.data.summary.netTotal, 0);
  const bad = await call(dailyRoute.GET, { path: `/api/reports/daily?date=hier`, cookie: ctx.owner });
  assert.equal(bad.status, 400);
});

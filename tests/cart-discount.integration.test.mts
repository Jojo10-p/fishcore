/**
 * « Réduction accordée » sur le total du panier : directe pour le gérant et la
 * direction, à valider quand elle vient d'un caissier ; bénéfice ou perte signalés.
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
const checkRoute = await import("@/app/api/sales/discount-check/route");
const discountRoute = await import("@/app/api/sales/[id]/discount/route");
const financeRoute = await import("@/app/api/reports/finance/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");

const ctx: Json = {};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo" }).format(new Date());

// Panier de 5 000 F : 4 bidons à 1 250 F (achetés 1 000 F : 1 000 F de bénéfice sans réduction)
async function sell(cookie: string, session: string, cartDiscount: number, discountReason?: string) {
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie,
    body: {
      sessionId: session,
      idempotencyKey: randomUUID(),
      lines: [{ productId: ctx.p, quantity: 4, unitPrice: 1250 }],
      payments: [{ method: "CASH", amount: Math.max(100, 5000 - cartDiscount) }],
      cartDiscount,
      ...(discountReason ? { discountReason } : {}),
    },
  });
  await waitForStockAlerts();
  await waitForNotifications();
  return r;
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
  ctx.p = (await prisma.product.create({ data: { companyId: company, centerId: ctx.center, name: "VIGO — 1 L", baseUnitId: unit.id, sellingPrice: 1250, purchasePrice: 1000 } })).id;
  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.p, quantity: 100, avgCost: 1000 } });
  for (const [email, role, first] of [
    ["gerant@test.bj", "CENTER_MANAGER", "Paul"],
    ["caisse@test.bj", "CASHIER", "Samson"],
  ] as const) {
    const u = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email, password: "Motdepasse1", firstName: first, lastName: "Test", role, centerIds: [ctx.center] } });
    assert.equal(u.status, 201, JSON.stringify(u.json));
  }
  ctx.manager = await login("gerant@test.bj");
  ctx.cashier = await login("caisse@test.bj");
  const reg1 = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  const reg2 = await prisma.cashRegister.create({ data: { centerId: ctx.center, name: "Caisse 2" } });
  ctx.ownerSession = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: reg1.id, openingBalance: 0 } })).json.data.id;
  ctx.cashierSession = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: reg2.id, openingBalance: 0 } })).json.data.id;
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("vérification du bénéfice : le caissier voit seulement bénéfice / perte, le patron voit les montants", async () => {
  const body = { centerId: ctx.center, cartDiscount: 700, lines: [{ productId: ctx.p, quantity: 4 }] };
  const c = await call(checkRoute.POST, { path: "/api/sales/discount-check", cookie: ctx.cashier, body });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.deepEqual({ status: c.json.data.status, needs: c.json.data.needsValidation, margin: c.json.data.margin }, { status: "PROFIT", needs: true, margin: undefined });
  const o = await call(checkRoute.POST, { path: "/api/sales/discount-check", cookie: ctx.owner, body: { ...body, cartDiscount: 1500 } });
  assert.equal(o.json.data.status, "LOSS");
  assert.equal(o.json.data.margin, -500);
  assert.equal(o.json.data.needsValidation, false);
});

test("réduction de la direction : 5 000 − 700 = 4 300 F, validée d'office", async () => {
  const r = await sell(ctx.owner, ctx.ownerSession, 700, "Client fidèle");
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const s = r.json.data;
  assert.equal(Number(s.totalAmount), 4300);
  assert.equal(Number(s.cartDiscount), 700);
  assert.equal(Number(s.discountAmount), 700);
  assert.equal(s.discountStatus, "VALIDATED");
  assert.equal(s.discountReason, "Client fidèle");
});

test("réduction du caissier : la vente passe, réduction à valider, le patron est prévenu (vente à perte)", async () => {
  const r = await sell(ctx.cashier, ctx.cashierSession, 1500);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  ctx.cashierSale = r.json.data.id;
  assert.equal(r.json.data.discountStatus, "PENDING");
  assert.equal(Number(r.json.data.totalAmount), 3500);
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "direction@test.bj" } });
  const n = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: "SALE_MADE", data: { path: ["saleId"], equals: ctx.cashierSale } } });
  assert.match(n.title, /réduction −1\s500 F · vente à perte \(à valider\)/);
  assert.match(n.message, /Réduction de 1\s500 F \(total 5\s000 → 3\s500 F\)/);
  assert.match(n.message, /Vente à perte : -500 F/);
  assert.equal((n.data as Json).link, "/ventes?reductions=a-valider");
});

test("réduction avec bénéfice : « bénéfice réduit » dans la notification", async () => {
  const r = await sell(ctx.cashier, ctx.cashierSession, 300, "Ordre du patron");
  assert.equal(r.status, 201);
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "direction@test.bj" } });
  const n = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: "SALE_MADE", data: { path: ["saleId"], equals: r.json.data.id } } });
  assert.match(n.message, /Bénéfice réduit : \+700 F/);
  assert.match(n.message, /motif : « Ordre du patron »/);
});

test("liste des réductions à valider, validation par le gérant (pas par le caissier)", async () => {
  const list = await call(salesRoute.GET, { path: `/api/sales?centerId=${ctx.center}&reductions=a-valider`, cookie: ctx.manager });
  assert.equal(list.status, 200);
  assert.equal(list.json.data.length, 2);
  const no = await call(discountRoute.POST, { path: `/api/sales/${ctx.cashierSale}/discount`, cookie: ctx.cashier, params: { id: ctx.cashierSale }, body: {} });
  assert.equal(no.status, 403);
  const ok = await call(discountRoute.POST, { path: `/api/sales/${ctx.cashierSale}/discount`, cookie: ctx.manager, params: { id: ctx.cashierSale }, body: {} });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const again = await call(discountRoute.POST, { path: `/api/sales/${ctx.cashierSale}/discount`, cookie: ctx.manager, params: { id: ctx.cashierSale }, body: {} });
  assert.equal(again.status, 409);
  const s = await prisma.sale.findUniqueOrThrow({ where: { id: ctx.cashierSale } });
  assert.equal(s.discountStatus, "VALIDATED");
  assert.ok(s.discountValidatedAt);
  assert.equal(await prisma.auditLog.count({ where: { eventType: "SALE_DISCOUNT_VALIDATED", referenceId: ctx.cashierSale } }), 1);
});

test("réduction égale ou supérieure au total : refusée", async () => {
  const r = await sell(ctx.owner, ctx.ownerSession, 5000);
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "INVALID_DISCOUNT");
});

test("le chiffre d'affaires compte les réductions", async () => {
  const r = await call(financeRoute.GET, { path: `/api/reports/finance?from=${today}&to=${today}`, cookie: ctx.owner });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // 4 300 + 3 500 + 4 700
  const cur = r.json.data.current;
  assert.equal(cur.revenueTTC, 12500);
  assert.equal(cur.sales.discounts, 2500);
  // Coût : 12 bidons à 1 000 F → 500 F de marge malgré les réductions
  assert.equal(cur.grossMargin, 500);
  assert.equal(cur.byCenter[0].grossMargin, 500, "marge par boutique nette des réductions");
});

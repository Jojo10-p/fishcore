/**
 * Le gérant vend ; une caisse clôturée apparaît « à valider » ; le gérant ou la direction
 * dit « oui, c'est bon » ; le caissier en est informé.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const unitsRoute = await import("@/app/api/units/route");
const productsRoute = await import("@/app/api/products/route");
const usersRoute = await import("@/app/api/users/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const journalRoute = await import("@/app/api/cash/sessions/[id]/journal/route");
const salesRoute = await import("@/app/api/sales/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");

const ctx: Json = {};

async function openAndSell(cookie: string, register: string) {
  const s = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie, body: { action: "open", cashRegisterId: register, openingBalance: 0 } });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie,
    body: { sessionId: s.json.data.id, idempotencyKey: randomUUID(), lines: [{ productId: ctx.product, quantity: 1, unitPrice: 750 }], payments: [{ method: "CASH", amount: 750 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const c = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie, body: { action: "close", sessionId: s.json.data.id, declaredBalance: 750 } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  return s.json.data.id as string;
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
  const units = (await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner })).json.data;
  const litre = units.find((u: Json) => u.symbol === "L").id;
  const p = await call(productsRoute.POST, { path: "/api/products", cookie: ctx.owner, body: { name: "VIGO — 1 L", centerId: ctx.center, baseUnitId: litre, sellingPrice: 750, purchasePrice: 600, stockAlertQty: 1 } });
  ctx.product = p.json.data.id;
  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.product, quantity: 50 } });
  for (const [email, role] of [["gerant@test.bj", "CENTER_MANAGER"], ["caisse@test.bj", "CASHIER"]] as const) {
    const r = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email, password: "Motdepasse1", firstName: role === "CASHIER" ? "Samson" : "Paul", lastName: "Test", role, centerIds: [ctx.center] } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  ctx.manager = await login("gerant@test.bj");
  ctx.cashier = await login("caisse@test.bj");
  ctx.reg1 = (await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } })).id;
  ctx.reg2 = (await prisma.cashRegister.create({ data: { centerId: ctx.center, name: "Caisse 2" } })).id;
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("le gérant peut vendre (ouvrir sa caisse, vendre, clôturer)", async () => {
  ctx.managerSession = await openAndSell(ctx.manager, ctx.reg2);
});

test("caisse clôturée : « à valider » pour le gérant et la direction", async () => {
  ctx.cashierSession = await openAndSell(ctx.cashier, ctx.reg1);
  await waitForNotifications();
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "direction@test.bj" } });
  const n = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: "CASH_CLOSED", data: { path: ["sessionId"], equals: ctx.cashierSession } } });
  assert.match(n.title, /Caisse clôturée — Samson · à valider/);
  const j = await call(journalRoute.GET, { path: `/api/cash/sessions/${ctx.cashierSession}/journal`, cookie: ctx.manager, params: { id: ctx.cashierSession } });
  assert.equal(j.status, 200);
  assert.equal(j.json.data.isValidated, false);
});

test("le caissier ne valide pas sa propre caisse ; le gérant dit « oui, c'est bon »", async () => {
  const self = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "validate", sessionId: ctx.cashierSession } });
  assert.equal(self.status, 403);
  const ok = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.manager, body: { action: "validate", sessionId: ctx.cashierSession } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const j = await call(journalRoute.GET, { path: `/api/cash/sessions/${ctx.cashierSession}/journal`, cookie: ctx.owner, params: { id: ctx.cashierSession } });
  assert.equal(j.json.data.isValidated, true);
  assert.equal(j.json.data.validatedBy, "Paul Test");
  const list = await call(cashRoute.GET, { path: `/api/cash/sessions?centerId=${ctx.center}`, cookie: ctx.owner });
  assert.equal(list.json.data.find((s: Json) => s.id === ctx.cashierSession).validatedBy, "Paul Test");
  await waitForNotifications();
  const cashier = await prisma.user.findFirstOrThrow({ where: { email: "caisse@test.bj" } });
  assert.equal(await prisma.notification.count({ where: { userId: cashier.id, type: "CASH_VALIDATED" } }), 1);
});

test("le gérant clôture : validée d'office, la direction reçoit une simple information", async () => {
  const s = await prisma.cashSession.findUniqueOrThrow({ where: { id: ctx.managerSession } });
  assert.equal(s.isValidated, true);
  await waitForNotifications();
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "direction@test.bj" } });
  const n = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: "CASH_CLOSED", data: { path: ["sessionId"], equals: ctx.managerSession } } });
  assert.equal(n.title, "Caisse clôturée — Paul");
  assert.match(n.message, /^Paul \(Gérant\) a clôturé la caisse : 750 F encaissés/);
  assert.doesNotMatch(n.message, /valid/);
});

test("la direction clôture : validée d'office aussi", async () => {
  const reg3 = (await prisma.cashRegister.create({ data: { centerId: ctx.center, name: "Caisse 3" } })).id;
  const id = await openAndSell(ctx.owner, reg3);
  assert.equal((await prisma.cashSession.findUniqueOrThrow({ where: { id } })).isValidated, true);
});

test("clôture : ventes, dépenses, reste en caisse et bénéfice net estimé bien séparés", async () => {
  const expensesRoute = await import("@/app/api/expenses/route");
  await prisma.stock.updateMany({ where: { productId: ctx.product }, data: { avgCost: 600 } });
  const s = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: ctx.reg1, openingBalance: 5000 } });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  const sid = s.json.data.id;
  // 4 × 750 = 3 000 F de ventes (2 000 espèces + 1 000 Mobile Money), achetés 600 F → 600 F de bénéfice
  const sale = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.cashier,
    body: { sessionId: sid, idempotencyKey: randomUUID(), lines: [{ productId: ctx.product, quantity: 4, unitPrice: 750 }], payments: [{ method: "CASH", amount: 2000 }, { method: "MOBILE_MONEY", amount: 1000 }] },
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  // Dépense de 400 F payée avec la caisse
  const e = await call(expensesRoute.POST, { path: "/api/expenses", cookie: ctx.cashier, body: { centerId: ctx.center, category: "Transport", amount: 400, sessionId: sid } });
  assert.equal(e.status, 201, JSON.stringify(e.json));
  // Reste attendu : 5 000 + 2 000 − 400 = 6 600
  const c = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "close", sessionId: sid, declaredBalance: 6600 } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const closed = c.json.data;
  assert.equal(Number(closed.theoreticalBalance), 6600);
  assert.equal(Number(closed.discrepancy), 0);
  assert.equal(Number(closed.journal.totalExpenses), 400);
  assert.equal(Number(closed.journal.otherCashOut), 0);
  // Le caissier ne voit pas le bénéfice
  assert.equal(closed.profit, undefined);
  // La direction voit le résultat estimé : 3 000 − 2 400 = 600 de bénéfice, − 400 de dépenses = 200 net
  const j = await call(journalRoute.GET, { path: `/api/cash/sessions/${sid}/journal`, cookie: ctx.owner, params: { id: sid } });
  assert.equal(j.status, 200, JSON.stringify(j.json));
  const p = j.json.data.profit;
  assert.equal(Number(p.revenue), 3000);
  assert.equal(Number(p.costOfSales), 2400);
  assert.equal(Number(p.grossProfit), 600);
  assert.equal(Number(p.expenses), 400);
  assert.equal(Number(p.netProfit), 200);
});

/**
 * Prix de vente et arrivages (l'exemple des bidons) :
 * hausse → appliquée à tout le stock ; baisse → l'ancien stock garde son prix,
 * le patron choisit, et le nouveau prix passe à la caisse quand l'ancien stock est vendu.
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
const decisionRoute = await import("@/app/api/price-decisions/[id]/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");

const ctx: Json = {};
const price = async () => Number((await prisma.product.findUniqueOrThrow({ where: { id: ctx.p } })).sellingPrice);

async function arrive(qty: number, unitCost: number, proposedPrices?: Json, cookie = ctx.manager) {
  const r = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie,
    body: { centerId: ctx.center, supplierId: ctx.s, receivedAt: "2026-11-17", lines: [{ productId: ctx.p, quantity: qty, unitPrice: unitCost, totalPrice: qty * unitCost }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const v = await call(validateRoute.POST, {
    path: `/api/goods-receipts/${r.json.data.id}/validate`,
    cookie,
    params: { id: r.json.data.id },
    body: { payment: { mode: "PAID", method: "CASH" }, ...(proposedPrices ? { proposedPrices } : {}) },
  });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  await waitForStockAlerts();
  await waitForNotifications();
  return v.json;
}
async function sell(qty: number) {
  const unitPrice = await price();
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.owner,
    body: { sessionId: ctx.session, idempotencyKey: randomUUID(), lines: [{ productId: ctx.p, quantity: qty, unitPrice }], payments: [{ method: "CASH", amount: unitPrice * qty }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await waitForStockAlerts();
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
  ctx.p = (await prisma.product.create({ data: { companyId: company, centerId: ctx.center, name: "VIGO — 1 L", baseUnitId: unit.id, sellingPrice: 1200, purchasePrice: 1000 } })).id;
  ctx.s = (await call(suppliersRoute.POST, { path: "/api/suppliers", cookie: ctx.owner, body: { name: "DISTRILUB" } })).json.data.id;
  const u = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email: "gerant@test.bj", password: "Motdepasse1", firstName: "Paul", lastName: "Test", role: "CENTER_MANAGER", centerIds: [ctx.center] } });
  assert.equal(u.status, 201);
  ctx.manager = await login("gerant@test.bj");
  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: register.id, openingBalance: 0 } })).json.data.id;
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("20 bidons achetés 20 000 F (1 000 F le bidon), 13 vendus : il en reste 7", async () => {
  await arrive(20, 1000);
  await sell(13);
  assert.equal(Number((await prisma.stock.findFirstOrThrow({ where: { productId: ctx.p } })).quantity), 7);
});

test("nouvel arrivage plus cher (1 100 F) au prix de 1 400 F : tout le stock passe à 1 400 F", async () => {
  const r = await arrive(20, 1100, { [ctx.p]: { price: 1400 } });
  assert.deepEqual(r.data.priceDecisions, []);
  assert.equal(await price(), 1400);
  await sell(27); // on vide le stock pour la suite
});

test("arrivage moins cher : le prix ne bouge pas, le patron est prévenu avec un choix", async () => {
  await arrive(20, 1100); // stock de 20 à 1 100 F
  await sell(13); // il en reste 7 de cet arrivage
  const r = await arrive(20, 900, { [ctx.p]: { price: 1300 } });
  assert.equal(r.data.priceDecisions.length, 1);
  ctx.decision = r.data.priceDecisions[0];
  assert.equal(await price(), 1400, "l'ancien stock garde son prix");
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "direction@test.bj" } });
  const n = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: "PRICE_DECISION" } });
  assert.match(n.message, /1\s100 F → 900 F/);
  assert.match(n.message, /Il reste 7/);
  assert.match(n.message, /proposé pour le nouveau stock : 1\s300 F/);
  const manager = await prisma.user.findFirstOrThrow({ where: { email: "gerant@test.bj" } });
  assert.equal(await prisma.notification.count({ where: { userId: manager.id, type: "PRICE_DECISION" } }), 0, "seul le patron choisit");
});

test("le gérant voit le choix mais ne peut pas décider", async () => {
  const g = await call(decisionRoute.GET, { path: `/api/price-decisions/${ctx.decision}`, cookie: ctx.manager, params: { id: ctx.decision } });
  assert.equal(g.status, 200);
  assert.equal(g.json.data.canDecide, false);
  assert.equal(g.json.data.oldLeft, 7);
  const p = await call(decisionRoute.POST, { path: `/api/price-decisions/${ctx.decision}`, cookie: ctx.manager, params: { id: ctx.decision }, body: { price: 1300 } });
  assert.equal(p.status, 403);
});

test("le patron choisit 1 300 F : l'ancien stock reste à 1 400 F, puis la caisse passe seule à 1 300 F", async () => {
  const p = await call(decisionRoute.POST, { path: `/api/price-decisions/${ctx.decision}`, cookie: ctx.owner, params: { id: ctx.decision }, body: { price: 1300 } });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.data.applied, false);
  assert.equal(p.json.data.pendingUntilSold, 7);
  assert.equal(await price(), 1400);
  await sell(5);
  assert.equal(await price(), 1400, "encore 2 bidons de l'ancien stock");
  await sell(2);
  assert.equal(await price(), 1300, "ancien stock épuisé : nouveau prix");
  const d = await prisma.priceDecision.findUniqueOrThrow({ where: { id: ctx.decision } });
  assert.ok(d.appliedAt);
  const again = await call(decisionRoute.POST, { path: `/api/price-decisions/${ctx.decision}`, cookie: ctx.owner, params: { id: ctx.decision }, body: { price: 1200 } });
  assert.equal(again.status, 409);
});

test("baisse sans prix proposé, le patron garde l'ancien prix : rien ne change", async () => {
  const r = await arrive(10, 800);
  assert.equal(r.data.priceDecisions.length, 1);
  const p = await call(decisionRoute.POST, { path: `/api/price-decisions/${r.data.priceDecisions[0]}`, cookie: ctx.owner, params: { id: r.data.priceDecisions[0] }, body: { price: 1300 } });
  assert.equal(p.status, 200);
  assert.equal(p.json.data.applied, true);
  assert.equal(await price(), 1300);
});

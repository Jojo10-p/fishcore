/**
 * Ouvrir sa caisse sans Internet : réserve de numéros par appareil, caisse ouverte
 * sur l'appareil, envoyée au retour du réseau avec ses ventes (numéros gardés).
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
const numbersRoute = await import("@/app/api/cash/sessions/[id]/numbers/route");
const standbyRoute = await import("@/app/api/cash/standby/route");
const salesRoute = await import("@/app/api/sales/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");

const ctx: Json = {};
const DEVICE = "appareil-boutique-1";

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Boutique Test", ownerName: "Direction Test", phone: "97000000", email: "direction@test.bj", password: "Motdepasse1", businessType: "GENERAL" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.owner = await login("direction@test.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Calavi", code: "CAL" } })).json.data.id;
  const units = (await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner })).json.data;
  const p = await call(productsRoute.POST, {
    path: "/api/products",
    cookie: ctx.owner,
    body: { name: "Savon", centerId: ctx.center, baseUnitId: units[0].id, sellingPrice: 500, purchasePrice: 300, stockAlertQty: 1 },
  });
  ctx.product = p.json.data.id;
  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.product, quantity: 50 } });
  await call(usersRoute.POST, {
    path: "/api/users",
    cookie: ctx.owner,
    body: { email: "caisse@test.bj", password: "Motdepasse1", firstName: "Samson", lastName: "Test", role: "CASHIER", centerIds: [ctx.center] },
  });
  ctx.cashier = await login("caisse@test.bj");
  ctx.register = (await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } })).id;
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("avec du réseau : l'appareil garde une réserve de numéros, les caisses et l'en-tête des tickets", async () => {
  const r = await call(standbyRoute.POST, { path: "/api/cash/standby", cookie: ctx.cashier, body: { deviceId: DEVICE } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.blocks.length, 1);
  assert.equal(d.blocks[0].last - d.blocks[0].first + 1, 50);
  assert.deepEqual(d.registers.map((x: Json) => x.id), [ctx.register]);
  assert.equal(d.company.tradeName, "Boutique Test");
  assert.equal(d.cashier.firstName, "Samson");
  ctx.standby = d.blocks[0];
  // Idempotent : la même réserve, pas une nouvelle
  const again = await call(standbyRoute.POST, { path: "/api/cash/standby", cookie: ctx.cashier, body: { deviceId: DEVICE } });
  assert.equal(again.json.data.blocks[0].first, ctx.standby.first);
});

test("la réserve d'un appareil n'est jamais donnée à une autre caisse", async () => {
  const s = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: (await prisma.cashRegister.create({ data: { centerId: ctx.center, name: "Caisse 2" } })).id, openingBalance: 0 } });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  const n = await call(numbersRoute.POST, { path: `/api/cash/sessions/${s.json.data.id}/numbers`, cookie: ctx.owner, params: { id: s.json.data.id } });
  assert.equal(n.status, 201, JSON.stringify(n.json));
  const b = n.json.data.block;
  assert.ok(b.last < ctx.standby.first || b.first > ctx.standby.last, `plage ${b.first}-${b.last} / réserve ${ctx.standby.first}-${ctx.standby.last}`);
  const c = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "close", sessionId: s.json.data.id, declaredBalance: 0 } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  // Numéros rendus à la clôture : toujours pas la réserve
  const blk = await prisma.invoiceNumberBlock.findFirstOrThrow({ where: { standbyUserId: { not: null } } });
  assert.equal(blk.first, ctx.standby.first);
});

test("sans Internet : caisse ouverte sur l'appareil, vente numérotée ; au retour du réseau tout passe", async () => {
  const clientId = `off_${randomUUID().replace(/-/g, "")}`;
  const openedAt = new Date(Date.now() - 2 * 3600_000);
  // File d'envoi : d'abord l'ouverture, puis la vente (dans cet ordre)
  const o = await call(cashRoute.POST, {
    path: "/api/cash/sessions",
    cookie: ctx.cashier,
    body: { action: "open", clientId, openedAt: openedAt.toISOString(), cashRegisterId: ctx.register, openingBalance: 2000, deviceId: DEVICE, standbyDeviceId: DEVICE, isOnline: false },
  });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  assert.equal(o.json.data.id, clientId);
  const session = await prisma.cashSession.findUniqueOrThrow({ where: { id: clientId } });
  assert.equal(session.openedAt.toISOString(), openedAt.toISOString());
  assert.equal(session.connectionState, "OFFLINE");
  // La réserve est devenue la plage de la session
  const blocks = await prisma.invoiceNumberBlock.findMany({ where: { sessionId: clientId } });
  assert.deepEqual(blocks.map((b) => [b.first, b.last]), [[ctx.standby.first, ctx.standby.last]]);
  assert.equal(await prisma.invoiceNumberBlock.count({ where: { standbyUserId: { not: null } } }), 0);
  // Renvoi (coupure pendant l'envoi) : même caisse, pas de doublon
  const again = await call(cashRoute.POST, {
    path: "/api/cash/sessions",
    cookie: ctx.cashier,
    body: { action: "open", clientId, openedAt: openedAt.toISOString(), cashRegisterId: ctx.register, openingBalance: 2000, deviceId: DEVICE, standbyDeviceId: DEVICE },
  });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(await prisma.cashSession.count({ where: { cashierId: session.cashierId } }), 1);
  // Vente faite hors ligne avec le 1er numéro de la réserve
  const sale = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.cashier,
    body: {
      sessionId: clientId,
      idempotencyKey: randomUUID(),
      invoiceSeq: ctx.standby.first,
      createdOffline: true,
      soldAt: new Date(Date.now() - 3600_000).toISOString(),
      lines: [{ productId: ctx.product, quantity: 2, unitPrice: 500 }],
      payments: [{ method: "CASH", amount: 1000 }],
    },
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.match(sale.json.data.saleNumber, new RegExp(`${ctx.standby.first}$`));
  const c = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "close", sessionId: clientId, declaredBalance: 3000 } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(Number(c.json.data.discrepancy), 0);
});

test("un autre caissier ne peut pas reprendre l'identifiant d'une caisse", async () => {
  const s = await prisma.cashSession.findFirstOrThrow({ where: { connectionState: "OFFLINE" } });
  const r = await call(cashRoute.POST, {
    path: "/api/cash/sessions",
    cookie: ctx.owner,
    body: { action: "open", clientId: s.id, cashRegisterId: ctx.register, openingBalance: 0 },
  });
  assert.equal(r.status, 409);
});

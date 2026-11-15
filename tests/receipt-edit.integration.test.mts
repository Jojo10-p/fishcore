/**
 * Modifier un arrivage déjà enregistré : le stock suit la différence.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const usersRoute = await import("@/app/api/users/route");
const suppliersRoute = await import("@/app/api/suppliers/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const editRoute = await import("@/app/api/goods-receipts/[id]/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");

const ctx: Json = {};
const stock = async (productId: string) => Number((await prisma.stock.findFirst({ where: { productId, centerId: ctx.center } }))?.quantity ?? 0);
const put = async (cookie: string, body: Json) => {
  const r = await call(editRoute.PUT, { path: `/api/goods-receipts/${ctx.receipt}`, method: "PUT", cookie, body, params: { id: ctx.receipt } });
  await waitForStockAlerts();
  return r;
};

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
  ctx.p1 = (await prisma.product.create({ data: { companyId: company, centerId: ctx.center, name: "ORYX — 1 L", baseUnitId: unit.id, sellingPrice: 3500, purchasePrice: 2800 } })).id;
  ctx.p5 = (await prisma.product.create({ data: { companyId: company, centerId: ctx.center, name: "ORYX — 5 L", baseUnitId: unit.id, sellingPrice: 15000, purchasePrice: 12000 } })).id;
  ctx.s1 = (await call(suppliersRoute.POST, { path: "/api/suppliers", cookie: ctx.owner, body: { name: "MAISON ORYX", phone: "01000000" } })).json.data.id;
  ctx.s2 = (await call(suppliersRoute.POST, { path: "/api/suppliers", cookie: ctx.owner, body: { name: "MAISON SHELL" } })).json.data.id;
  const r = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie: ctx.owner,
    body: { centerId: ctx.center, supplierId: ctx.s1, receivedAt: "2026-11-15", lines: [{ productId: ctx.p1, quantity: 10, unitPrice: 2800, totalPrice: 28000 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  ctx.receipt = r.json.data.id;
  const v = await call(validateRoute.POST, { path: `/api/goods-receipts/${ctx.receipt}/validate`, cookie: ctx.owner, body: {}, params: { id: ctx.receipt } });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  await waitForStockAlerts();
  const c = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email: "caisse@test.bj", password: "Motdepasse1", firstName: "Caisse", lastName: "Test", role: "CASHIER", centerIds: [ctx.center] } });
  assert.equal(c.status, 201);
  ctx.cashier = await login("caisse@test.bj");
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("le caissier ne peut pas modifier un arrivage", async () => {
  const r = await put(ctx.cashier, { centerId: ctx.center, receivedAt: "2026-11-15", lines: [{ productId: ctx.p1, quantity: 12, unitPrice: 2800, totalPrice: 33600 }] });
  assert.equal(r.status, 403);
});

test("plus de bidons reçus : le stock monte de la différence", async () => {
  assert.equal(await stock(ctx.p1), 10);
  const r = await put(ctx.owner, { centerId: ctx.center, supplierId: ctx.s1, receivedAt: "2026-11-15", lines: [{ productId: ctx.p1, quantity: 12, unitPrice: 2800, totalPrice: 33600 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(await stock(ctx.p1), 12);
  const p = await prisma.purchase.findFirstOrThrow({ where: { receipts: { some: { id: ctx.receipt } } } });
  assert.equal(Number(p.totalAmount), 33600);
});

test("format changé (1 L → 5 L) et autre fournisseur : chaque stock suit", async () => {
  const r = await put(ctx.owner, { centerId: ctx.center, supplierId: ctx.s2, receivedAt: "2026-11-14", lines: [{ productId: ctx.p5, quantity: 12, unitPrice: 12000, totalPrice: 144000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(await stock(ctx.p1), 0);
  assert.equal(await stock(ctx.p5), 12);
  const rec = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: ctx.receipt }, include: { lines: true, purchase: true } });
  assert.equal(rec.supplierId, ctx.s2);
  assert.equal(rec.purchase?.supplierId, ctx.s2);
  assert.equal(rec.lines.length, 1);
  assert.equal(rec.lines[0].productId, ctx.p5);
});

test("ce qui est déjà vendu ne peut pas être retiré", async () => {
  // 10 bidons de 5 L vendus
  await prisma.stock.updateMany({ where: { productId: ctx.p5, centerId: ctx.center }, data: { quantity: 2 } });
  await prisma.batch.updateMany({ where: { productId: ctx.p5, receiptId: ctx.receipt }, data: { remainingQty: 2 } });
  const r = await put(ctx.owner, { centerId: ctx.center, supplierId: ctx.s2, receivedAt: "2026-11-14", lines: [{ productId: ctx.p5, quantity: 5, unitPrice: 12000, totalPrice: 60000 }] });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(await stock(ctx.p5), 2, "rien n'a bougé");
  const ok = await put(ctx.owner, { centerId: ctx.center, supplierId: ctx.s2, receivedAt: "2026-11-14", lines: [{ productId: ctx.p5, quantity: 11, unitPrice: 12000, totalPrice: 132000 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(await stock(ctx.p5), 1);
});

/**
 * Modifier / supprimer un article du stock : direction et gérant seulement.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const usersRoute = await import("@/app/api/users/route");
const editRoute = await import("@/app/api/stock/edit/route");
const overviewRoute = await import("@/app/api/stock/overview/route");
const suggRoute = await import("@/app/api/product-suggestions/route");
const { waitForNotifications } = await import("@/lib/notify");

const ctx: Json = {};

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Boutique Test", ownerName: "Direction Test", phone: "97000000", email: "direction@test.bj", password: "Motdepasse1", businessType: "LUBRICANTS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.owner = await login("direction@test.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Calavi", code: "CAL" } })).json.data.id;
  const company = (await prisma.company.findFirst({ select: { id: true } }))!.id;
  const unit = await prisma.unit.findFirst({ where: { companyId: company, symbol: "L" } }) ?? (await prisma.unit.findFirstOrThrow({ where: { companyId: company } }));
  const p = await prisma.product.create({ data: { companyId: company, centerId: ctx.center, name: "VIGO — 25 L", baseUnitId: unit.id, sellingPrice: 375, purchasePrice: 300 } });
  ctx.product = p.id;
  await prisma.stock.create({ data: { centerId: ctx.center, productId: p.id, quantity: 50 } });
  await prisma.productSuggestion.createMany({ data: [{ name: "VIGO" }, { name: "ORYX" }], skipDuplicates: true });
  for (const [email, role] of [["gerant@test.bj", "CENTER_MANAGER"], ["caisse@test.bj", "CASHIER"]] as const) {
    const r = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email, password: "Motdepasse1", firstName: role, lastName: "Test", role, centerIds: [ctx.center] } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  ctx.manager = await login("gerant@test.bj");
  ctx.cashier = await login("caisse@test.bj");
});
after(async () => {
  await waitForNotifications();
  await prisma.$disconnect();
});

test("le caissier ne peut ni modifier ni supprimer", async () => {
  const r = await call(editRoute.POST, { path: "/api/stock/edit", cookie: ctx.cashier, body: { centerId: ctx.center, productId: ctx.product, quantity: 10, reason: "test" } });
  assert.equal(r.status, 403);
  const d = await call(editRoute.DELETE, { path: "/api/stock/edit", method: "DELETE", cookie: ctx.cashier, body: { centerId: ctx.center, productId: ctx.product, reason: "test" } });
  assert.equal(d.status, 403);
});

test("le gérant fixe la quantité réelle : écart noté et direction prévenue", async () => {
  const r = await call(editRoute.POST, { path: "/api/stock/edit", cookie: ctx.manager, body: { centerId: ctx.center, productId: ctx.product, quantity: 42, reason: "comptage du soir" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, { before: 50, after: 42 });
  const mv = await prisma.stockMovement.findFirst({ where: { type: "CORRECTION" }, orderBy: { createdAt: "desc" } });
  assert.equal(Number(mv?.quantity), -8);
  await waitForNotifications();
  const n = await prisma.notification.findFirst({ where: { type: "STOCK_EDITED" } });
  assert.ok(n && /42/.test(n.message));
  const noReason = await call(editRoute.POST, { path: "/api/stock/edit", cookie: ctx.manager, body: { centerId: ctx.center, productId: ctx.product, quantity: 40, reason: "" } });
  assert.equal(noReason.status, 400);
});

test("la direction supprime l'article : stock à 0, il disparaît de la boutique", async () => {
  const d = await call(editRoute.DELETE, { path: "/api/stock/edit", method: "DELETE", cookie: ctx.owner, body: { centerId: ctx.center, productId: ctx.product, reason: "créé par erreur" } });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  const s = await prisma.stock.findFirst({ where: { productId: ctx.product } });
  assert.equal(Number(s?.quantity), 0);
  const ov = await call(overviewRoute.GET, { path: `/api/stock/overview?centerId=${ctx.center}`, cookie: ctx.owner });
  assert.equal(ov.json.data.length, 0);
});

test("l'article supprimé disparaît aussi des suggestions de l'ajout de stock de cette boutique", async () => {
  const r = await call(suggRoute.GET, { path: `/api/product-suggestions?centerId=${ctx.center}`, cookie: ctx.owner });
  const names = r.json.data.map((x: Json) => x.name);
  assert.ok(!names.includes("VIGO"), JSON.stringify(names));
  assert.ok(names.includes("ORYX"));
  const other = await call(suggRoute.GET, { path: "/api/product-suggestions?centerId=autre", cookie: ctx.owner });
  assert.ok(other.json.data.some((x: Json) => x.name === "VIGO"), "toujours proposé ailleurs");
});

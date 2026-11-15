/**
 * Vente au détail : ½ litre et ¼ litre à leur propre prix.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const unitsRoute = await import("@/app/api/units/route");
const productsRoute = await import("@/app/api/products/route");
const productRoute = await import("@/app/api/products/[id]/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");

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
  const units = (await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner })).json.data;
  const litre = units.find((u: Json) => u.symbol === "L").id;
  const bidon = units.find((u: Json) => u.symbol === "bidon").id;
  ctx.half = (await call(unitsRoute.POST, { path: "/api/units", cookie: ctx.owner, body: { name: "½ litre", symbol: "½ L", kind: "PACKAGING" } })).json.data.id;
  ctx.quarter = (await call(unitsRoute.POST, { path: "/api/units", cookie: ctx.owner, body: { name: "¼ litre", symbol: "¼ L", kind: "PACKAGING" } })).json.data.id;
  const p = await call(productsRoute.POST, {
    path: "/api/products",
    cookie: ctx.owner,
    body: { name: "VIGO — 25 L", centerId: ctx.center, baseUnitId: litre, sellingPrice: 750, purchasePrice: 600, stockAlertQty: 7, packagings: [{ unitId: bidon, factor: 25, sellingPrice: 18000 }] },
  });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  ctx.product = p.json.data.id;
  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.product, quantity: 50 } });
  const reg2 = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  const s = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: reg2.id, openingBalance: 0 } });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  ctx.session = s.json.data.id;
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("le prix du ½ L et du ¼ L se fixe sur l'article", async () => {
  const bidon = await prisma.unitConversion.findFirstOrThrow({ where: { productId: ctx.product, factor: 25 } });
  const r = await call(productRoute.PATCH, {
    path: `/api/products/${ctx.product}`,
    method: "PATCH",
    cookie: ctx.owner,
    params: { id: ctx.product },
    body: {
      sellingPrice: 750,
      packagings: [
        { unitId: bidon.fromUnitId, factor: 25, sellingPrice: 18000 },
        { unitId: ctx.half, factor: 0.5, sellingPrice: 400 },
        { unitId: ctx.quarter, factor: 0.25, sellingPrice: 200 },
      ],
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test("vendre un ½ L et un ¼ L : leur prix, et le stock baisse de 0,75 L", async () => {
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.owner,
    body: {
      sessionId: ctx.session,
      idempotencyKey: randomUUID(),
      lines: [
        { productId: ctx.product, unitId: ctx.half, quantity: 1, unitPrice: 400 },
        { productId: ctx.product, unitId: ctx.quarter, quantity: 1, unitPrice: 200 },
      ],
      payments: [{ method: "CASH", amount: 600 }],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: r.json.data.id } });
  assert.equal(Number(sale.totalAmount), 600);
  const st = await prisma.stock.findFirstOrThrow({ where: { productId: ctx.product } });
  assert.equal(Number(st.quantity), 49.25);
});

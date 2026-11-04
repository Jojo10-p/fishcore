/**
 * Alertes de stock bas : ouverture au passage du seuil, pas de doublon,
 * e-mail au propriétaire, lecture, fermeture au réassort.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const unitsRoute = await import("@/app/api/units/route");
const productsRoute = await import("@/app/api/products/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const alertsRoute = await import("@/app/api/stock-alerts/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const { syncStockAlerts, waitForStockAlerts, lowStockEmail } = await import("@/lib/stock-alerts");

const ctx: Json = {};
const sell = async (qty: number) => {
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.owner,
    body: { sessionId: ctx.session, idempotencyKey: idem(), lines: [{ productId: ctx.product, quantity: qty, unitPrice: 3500 }], payments: [{ method: "CASH", amount: qty * 3500 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await waitForStockAlerts();
};
const alerts = async () => (await call(alertsRoute.GET, { path: "/api/stock-alerts", cookie: ctx.owner })).json.data;

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "GRACES JUMELLES HOUSE", ownerName: "Direction GJH", phone: "97000000", email: "direction@gjh.bj", password: "Motdepasse1", businessType: "LUBRICANTS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.companyId = reg.json.data.companyId;
  ctx.owner = await login("direction@gjh.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Boutique Adjagbo", code: "ADJ" } })).json.data.id;
  const units = (await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner })).json.data;
  ctx.unit = units.find((u: Json) => u.symbol === "btl").id;
  const p = await call(productsRoute.POST, {
    path: "/api/products",
    cookie: ctx.owner,
    body: { name: "Total Hi-Perf 4T 20W-50 — 1 L", internalCode: "M01", baseUnitId: ctx.unit, sellingPrice: 3500, purchasePrice: 2750, stockAlertQty: 10 },
  });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  ctx.product = p.json.data.id;
  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.product, quantity: 12, avgCost: 2750 } });
  const reg2 = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: reg2.id, openingBalance: 0 } })).json.data.id;
});

after(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  await prisma.$disconnect();
});

test("au-dessus du seuil : aucune alerte", async () => {
  await sell(1); // 11 > 10
  const d = await alerts();
  assert.equal(d.open.length, 0);
  assert.equal(d.unread, 0);
});

test("passage sous le seuil : une alerte, envoyée par e-mail au propriétaire", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "alertes@gjh.bj";
  const sent: Json[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
  }) as typeof fetch;
  try {
    await sell(2); // 9 ≤ 10
  } finally {
    globalThis.fetch = realFetch;
  }
  const d = await alerts();
  assert.equal(d.open.length, 1);
  assert.equal(d.unread, 1);
  assert.equal(Number(d.open[0].quantity), 9);
  assert.equal(Number(d.open[0].threshold), 10);
  assert.ok(d.open[0].emailedAt, "e-mail envoyé");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].auth, "Bearer re_test");
  assert.deepEqual(sent[0].body.to, ["direction@gjh.bj"]);
  assert.match(sent[0].body.from, /<alertes@gjh\.bj>$/);
  assert.match(sent[0].body.subject, /Stock bas : Total Hi-Perf/);
  assert.match(sent[0].body.html, /Boutique Adjagbo/);
  assert.match(sent[0].body.text, /reste 9 btl, seuil 10 btl/);
});

test("ventes suivantes : la même alerte suit le stock, pas de nouvel e-mail", async () => {
  await sell(3); // 6
  const d = await alerts();
  assert.equal(d.open.length, 1);
  assert.equal(Number(d.open[0].quantity), 6);
  // vérifications simultanées : toujours une seule alerte ouverte
  await Promise.all([syncStockAlerts(ctx.companyId), syncStockAlerts(ctx.companyId), syncStockAlerts(ctx.companyId)]);
  assert.equal(await prisma.stockAlert.count({ where: { companyId: ctx.companyId, resolvedAt: null } }), 1);
});

test("sans service d'e-mail : l'alerte reste visible, la raison est notée", async () => {
  delete process.env.RESEND_API_KEY;
  await prisma.stockAlert.deleteMany({ where: { companyId: ctx.companyId } });
  await sell(1); // 5
  const d = await alerts();
  assert.equal(d.open.length, 1);
  assert.equal(d.open[0].emailedAt, null);
  assert.match(d.open[0].emailError, /non configuré/);
  assert.equal(d.email.configured, false);
});

test("lecture : tout marquer comme lu", async () => {
  const r = await call(alertsRoute.PATCH, { path: "/api/stock-alerts", method: "PATCH", cookie: ctx.owner, body: { all: true } });
  assert.equal(r.status, 200);
  const d = await alerts();
  assert.equal(d.unread, 0);
  assert.equal(d.open.length, 1, "lue mais toujours en cours");
});

test("réception fournisseur : le stock remonte, l'alerte se ferme d'elle-même", async () => {
  const gr = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie: ctx.owner,
    body: { centerId: ctx.center, lines: [{ productId: ctx.product, quantity: 48, unitPrice: 2750, totalPrice: 132000 }] },
  });
  assert.equal(gr.status, 201, JSON.stringify(gr.json));
  const v = await call(validateRoute.POST, { path: `/api/goods-receipts/${gr.json.data.id}/validate`, cookie: ctx.owner, params: { id: gr.json.data.id }, body: {} });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  await waitForStockAlerts();
  const d = await alerts();
  assert.equal(d.open.length, 0);
  assert.equal(d.resolved.length, 1);
  assert.ok(d.resolved[0].resolvedAt);
});

test("modèle d'e-mail : plusieurs articles, rupture signalée", () => {
  const D = (n: number) => ({ toString: () => String(n), valueOf: () => n }) as never;
  const m = lowStockEmail({
    appName: "GJH Gestion",
    tradeName: "GRACES JUMELLES HOUSE",
    link: "https://gjh.example/alertes",
    alerts: [
      { id: "a", productName: "Rubia TIR 7400 — fût 208 L", reference: "L03", unit: "fût", centerName: "Dépôt Calavi", quantity: D(0), threshold: D(1) },
      { id: "b", productName: "Quartz 7000 — bidon 4 L", reference: "V01", unit: "bidon", centerName: "Boutique Adjagbo", quantity: D(5), threshold: D(8) },
    ],
  });
  assert.equal(m.subject, "Stock bas : 2 articles à recommander");
  assert.match(m.html, /2 articles arrivent en rupture/);
  assert.match(m.html, /https:\/\/gjh\.example\/alertes/);
  assert.doesNotMatch(m.html, /<script/i);
});

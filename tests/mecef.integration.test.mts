/**
 * Facture normalisée e-MECeF : un faux serveur DGI répond comme l'API e-MCF.
 * Réglages (jeton chiffré, test de connexion), vente normalisée, panne de la DGI
 * puis relance, refus de la DGI, avoir à l'annulation.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

// ── Faux serveur DGI ──
type Mode = "ok" | "down" | "reject" | "full";
const dgi = { mode: "ok" as Mode, seq: 0, requests: [] as Array<{ method: string; url: string; auth: string; body: Json | null }> };
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    dgi.requests.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization ?? ""), body });
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (req.headers.authorization !== "Bearer JETON-TEST-123") return send(401, { message: "Unauthorized" });
    if (dgi.mode === "down") return send(503, { message: "indisponible" });
    if (req.method === "GET" && req.url === "/invoice") {
      const list = dgi.mode === "full" ? [{ date: "16/11/2026 09:00:00", uid: "uid-oublie" }] : [];
      return send(200, { status: true, version: "1.0", ifu: "0202212345678", nim: "TS01000123", tokenValid: "2027-12-31T23:59:59", pendingRequestsCount: list.length, pendingRequestsList: list });
    }
    if (req.method === "PUT" && req.url === "/invoice/uid-oublie/cancel") {
      dgi.mode = "ok";
      return send(200, { dateTime: "16/11/2026 10:00:00" });
    }
    if (req.method === "POST" && req.url === "/invoice") {
      if (dgi.mode === "full") return send(200, { errorCode: "1", errorDesc: "Nombre maximum de factures en attente dépassé" });
      if (dgi.mode === "reject") return send(200, { errorCode: "3", errorDesc: "Le groupe de taxe est invalide" });
      dgi.seq++;
      return send(200, { uid: `uid-${dgi.seq}`, total: body.items.reduce((s: number, i: Json) => s + i.price * i.quantity, 0) });
    }
    const m = req.url!.match(/^\/invoice\/(uid-\d+)\/confirm$/);
    if (req.method === "PUT" && m) {
      const n = m[1].split("-")[1].padStart(4, "0");
      return send(200, { dateTime: "16/11/2026 10:00:00", qrCode: `F;TS01000123;CODE${n};0202212345678;20261116100000`, codeMECeFDGI: `ABCD-EFGH-IJKL-MNOP-QRST-${n}`, counters: `${n}/${n} FV`, nim: "TS01000123" });
    }
    send(404, { message: "not found" });
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.MECEF_TEST_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const unitsRoute = await import("@/app/api/units/route");
const productsRoute = await import("@/app/api/products/route");
const usersRoute = await import("@/app/api/users/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const saleRoute = await import("@/app/api/sales/[id]/route");
const saleMecefRoute = await import("@/app/api/sales/[id]/mecef/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const companyRoute = await import("@/app/api/company/route");
const mecefRoute = await import("@/app/api/company/mecef/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");
const { waitForMecef } = await import("@/lib/mecef");

const ctx: Json = {};

async function sell(qty = 2, extra: Json = {}) {
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.owner,
    body: {
      sessionId: ctx.session,
      idempotencyKey: randomUUID(),
      lines: [{ productId: ctx.product, quantity: qty, unitPrice: 750 }],
      payments: [{ method: "MOBILE_MONEY", amount: 750 * qty }],
      ...extra,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await waitForMecef();
  return r.json.data;
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
  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.product, quantity: 100 } });
  const regster = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: regster.id, openingBalance: 0 } })).json.data.id;
  const u = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email: "gerant@test.bj", password: "Motdepasse1", firstName: "Paul", lastName: "Test", role: "CENTER_MANAGER", centerIds: [ctx.center] } });
  assert.equal(u.status, 201, JSON.stringify(u.json));
  ctx.manager = await login("gerant@test.bj");
});
after(async () => {
  await waitForMecef();
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
  server.close();
});

test("sans réglage : la vente se fait normalement, rien n'est envoyé à la DGI", async () => {
  const sale = await sell(1);
  assert.equal(sale.mecef, null);
  assert.equal(dgi.requests.length, 0);
});

test("réglages : IFU obligatoire, mauvais jeton refusé, bon jeton testé puis activé", async () => {
  const noIfu = await call(mecefRoute.PUT, { path: "/api/company/mecef", method: "PUT", cookie: ctx.owner, body: { enabled: true, mode: "TEST", token: "JETON-TEST-123" } });
  assert.equal(noIfu.status, 400);
  assert.equal(noIfu.json.code, "MECEF_NO_IFU");
  await call(companyRoute.PATCH, { path: "/api/company", method: "PATCH", cookie: ctx.owner, body: { taxId: "0202212345678" } });

  const bad = await call(mecefRoute.PUT, { path: "/api/company/mecef", method: "PUT", cookie: ctx.owner, body: { enabled: true, mode: "TEST", token: "MAUVAIS" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "MECEF_TEST_FAILED");
  assert.equal((await prisma.company.findFirstOrThrow()).mecefEnabled, false);

  const manager = await call(mecefRoute.PUT, { path: "/api/company/mecef", method: "PUT", cookie: ctx.manager, body: { enabled: true, token: "JETON-TEST-123" } });
  assert.equal(manager.status, 403);

  const ok = await call(mecefRoute.PUT, { path: "/api/company/mecef", method: "PUT", cookie: ctx.owner, body: { enabled: true, mode: "TEST", token: "Bearer JETON-TEST-123", taxGroup: "E" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.enabled, true);
  assert.equal(ok.json.data.hasToken, true);
  assert.equal(ok.json.data.nim, "TS01000123");
  assert.equal(ok.json.data.taxGroup, "E");
  assert.equal(JSON.stringify(ok.json).includes("JETON-TEST-123"), false, "le jeton n'est jamais renvoyé");
  const c = await prisma.company.findFirstOrThrow();
  assert.ok(c.mecefTokenEnc && !c.mecefTokenEnc.includes("JETON"), "jeton chiffré en base");
});

test("vente normalisée : le code MECeF et le QR code reviennent avec la vente", async () => {
  dgi.requests.length = 0;
  const sale = await sell(2);
  assert.equal(sale.mecef.status, "DONE");
  assert.match(sale.mecef.codeMecef, /^ABCD-EFGH-IJKL-MNOP-QRST-\d{4}$/);
  assert.ok(sale.mecef.qrCode);
  assert.equal(sale.mecef.nim, "TS01000123");
  const post = dgi.requests.find((r) => r.method === "POST")!;
  assert.equal(post.body!.ifu, "0202212345678");
  assert.equal(post.body!.type, "FV");
  assert.deepEqual(post.body!.items[0], { name: "VIGO — 1 L", price: 750, quantity: 2, taxGroup: "E" });
  assert.deepEqual(post.body!.payment, [{ name: "MOBILEMONEY", amount: 1500 }]);
  assert.equal(post.body!.operator.name, "Direction Test");
  // Réimpression : le ticket retrouve les mêmes éléments
  const g = await call(saleRoute.GET, { path: `/api/sales/${sale.id}`, cookie: ctx.owner, params: { id: sale.id } });
  assert.equal(g.json.data.mecef.invoice.codeMecef, sale.mecef.codeMecef);
  ctx.normalizedSale = sale;
});

test("DGI en panne : la vente passe quand même, la facture repart à la réimpression", async () => {
  dgi.mode = "down";
  const sale = await sell(1);
  assert.equal(sale.mecef.status, "PENDING");
  assert.match(sale.mecef.error, /503/);
  dgi.mode = "ok";
  const g = await call(saleRoute.GET, { path: `/api/sales/${sale.id}`, cookie: ctx.owner, params: { id: sale.id } });
  assert.equal(g.json.data.mecef.invoice.status, "DONE");
  assert.ok(g.json.data.mecef.invoice.codeMecef);
});

test("DGI en panne : relance automatique après la vente suivante", async () => {
  dgi.mode = "down";
  const s1 = await sell(1);
  assert.equal(s1.mecef.status, "PENDING");
  dgi.mode = "ok";
  await sell(1);
  const row = await prisma.mecefInvoice.findUniqueOrThrow({ where: { saleId_kind: { saleId: s1.id, kind: "FV" } } });
  assert.equal(row.status, "DONE");
});

test("refus de la DGI : marqué à corriger, renvoyé à la main après correction", async () => {
  dgi.mode = "reject";
  const sale = await sell(1);
  assert.equal(sale.mecef.status, "ERROR");
  assert.match(sale.mecef.error, /groupe de taxe est invalide/);
  dgi.mode = "ok";
  const r = await call(saleMecefRoute.POST, { path: `/api/sales/${sale.id}/mecef`, cookie: ctx.owner, params: { id: sale.id } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.invoice.status, "DONE");
});

test("trop de factures en attente chez la DGI : on annule les oubliées et on renvoie", async () => {
  dgi.mode = "full";
  const sale = await sell(1);
  assert.equal(sale.mecef.status, "DONE", JSON.stringify(sale.mecef));
  assert.ok(dgi.requests.some((r) => r.url === "/invoice/uid-oublie/cancel"));
});

test("vente hors connexion arrivée plus tard : normalisée juste après", async () => {
  const sale = await sell(1, { createdOffline: true });
  assert.equal(sale.mecef, null);
  const row = await prisma.mecefInvoice.findUniqueOrThrow({ where: { saleId_kind: { saleId: sale.id, kind: "FV" } } });
  assert.equal(row.status, "DONE");
});

test("annulation d'une vente normalisée : avoir FA avec la référence d'origine", async () => {
  const sale = ctx.normalizedSale;
  const req = await call(cancelRoute.POST, {
    path: `/api/sales/${sale.id}/cancel`,
    cookie: ctx.owner,
    params: { id: sale.id },
    body: { action: "request", reason: "Erreur de saisie" },
  });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  dgi.requests.length = 0;
  const ok = await call(cancelRoute.POST, {
    path: `/api/sales/${sale.id}/cancel`,
    cookie: ctx.manager,
    params: { id: sale.id },
    body: { action: "decide", cancellationId: req.json.data.id, decision: "APPROVED" },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(ok.json.message, /Avoir e-MECeF émis/);
  const post = dgi.requests.find((r) => r.method === "POST")!;
  assert.equal(post.body!.type, "FA");
  assert.equal(post.body!.reference, sale.mecef.codeMecef.replace(/-/g, ""));
  const g = await call(saleRoute.GET, { path: `/api/sales/${sale.id}`, cookie: ctx.owner, params: { id: sale.id } });
  assert.equal(g.json.data.mecef.creditNote.status, "DONE");
});

test("désactivé : plus aucun envoi", async () => {
  const r = await call(mecefRoute.PUT, { path: "/api/company/mecef", method: "PUT", cookie: ctx.owner, body: { enabled: false } });
  assert.equal(r.status, 200);
  dgi.requests.length = 0;
  const sale = await sell(1);
  assert.equal(sale.mecef, null);
  assert.equal(dgi.requests.length, 0);
});

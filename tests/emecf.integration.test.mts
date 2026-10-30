/**
 * Facture normalisée e-MECeF (DGI Bénin), contre un faux serveur e-MCF :
 * activation, normalisation à la vente, coupures, reprise sans doublon,
 * contrôle du total, refus, avoir à l'annulation.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startEmecfMock, type EmecfMock } from "./emecf-mock.mts";

process.env.EMECF_TIMEOUT_MS = "1500";
const mock: EmecfMock = await startEmecfMock();
process.env.EMECF_BASE_URL_TEST = mock.url;

const { call, idem, login, passwordHash, prisma, resetDb } = await import("./helpers.mts");
type Json = Record<string, any>;
const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const companyRoute = await import("@/app/api/company/route");
const emecfRoute = await import("@/app/api/company/emecf/route");
const retryRoute = await import("@/app/api/company/emecf/retry/route");
const cronRoute = await import("@/app/api/cron/emecf/route");
const productsRoute = await import("@/app/api/products/route");
const unitsRoute = await import("@/app/api/units/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateReceipt = await import("@/app/api/goods-receipts/[id]/validate/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const saleRoute = await import("@/app/api/sales/[id]/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const { sweepIfDue } = await import("@/lib/emecf/normalize");

const ctx: Json = {};
const sell = (body: Json, key = idem()) =>
  call(salesRoute.POST, { path: "/api/sales", cookie: ctx.cashier, body: { sessionId: ctx.session, idempotencyKey: key, ...body } });
const doc = (saleId: string, type: "FV" | "FA" = "FV") => prisma.emecfDocument.findUnique({ where: { saleId_type: { saleId, type } } });

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Ets Ray-Espoir", ownerName: "Patron", phone: "97000000", email: "owner@ray.bj", password: "Motdepasse1", businessType: "FISHMONGER" },
  });
  ctx.companyId = reg.json.data.companyId;
  ctx.owner = await login("owner@ray.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Magasin", code: "MAG" } })).json.data.id;
  const hash = await passwordHash();
  await prisma.user.create({
    data: { email: "caisse@ray.bj", passwordHash: hash, firstName: "Awa", lastName: "Dossou", role: "CASHIER", companyId: ctx.companyId, centers: { create: [{ centerId: ctx.center }] } },
  });
  ctx.cashier = await login("caisse@ray.bj");
  const units = await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner });
  const carton = units.json.data.find((u: Json) => u.symbol === "carton").id;
  const mk = async (body: Json) => (await call(productsRoute.POST, { path: "/api/products", cookie: ctx.owner, body: { purchasePrice: 0, stockAlertQty: 0, baseUnitId: carton, ...body } })).json.data;
  ctx.saucisse = await mk({ name: "SAUCISSE", internalCode: "S08", sellingPrice: 800 });
  ctx.glace = await mk({ name: "GLACE", internalCode: "G01", sellingPrice: 300, emecfTaxGroup: "A" });
  const r = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie: ctx.owner,
    body: { centerId: ctx.center, lines: [{ productId: ctx.saucisse.id, quantity: 500, unitPrice: 650, totalPrice: 325000 }, { productId: ctx.glace.id, quantity: 500, unitPrice: 100, totalPrice: 50000 }] },
  });
  await call(validateReceipt.POST, { path: `/api/goods-receipts/${r.json.data.id}/validate`, cookie: ctx.owner, params: { id: r.json.data.id }, body: {} });
  const register = await prisma.cashRegister.findFirst({ where: { centerId: ctx.center } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: register!.id, openingBalance: 0 } })).json.data.id;
  // Le patron tient une seconde caisse (il peut accorder des remises)
  const register2 = await prisma.cashRegister.create({ data: { centerId: ctx.center, name: "Caisse 2" } });
  ctx.ownerSession = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: register2.id, openingBalance: 0 } })).json.data.id;
});

after(async () => {
  await mock.close();
  await prisma.$disconnect();
});

test("sans abonnement e-MECeF : rien n'est envoyé à la DGI", async () => {
  const s = await sell({ lines: [{ productId: ctx.saucisse.id, quantity: 1, unitPrice: 800 }], payments: [{ method: "CASH", amount: 800 }] });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal(s.json.data.emecf, null);
  assert.equal(await doc(s.json.data.id), null);
  assert.equal(mock.posts, 0);
});

test("activation : IFU requis, jeton vérifié auprès de la DGI, jamais renvoyé ni stocké en clair", async () => {
  const noIfu = await call(emecfRoute.PUT, { path: "/api/company/emecf", cookie: ctx.owner, body: { enabled: true, token: mock.token } });
  assert.equal(noIfu.status, 400);
  assert.equal(noIfu.json.code, "TAX_ID_REQUIRED");

  await call(companyRoute.PATCH, { path: "/api/company", cookie: ctx.owner, body: { taxId: mock.ifu } });
  const bad = await call(emecfRoute.PUT, { path: "/api/company/emecf", cookie: ctx.owner, body: { enabled: true, token: "x".repeat(40) } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "EMECF_TOKEN_INVALID");

  const cashier = await call(emecfRoute.PUT, { path: "/api/company/emecf", cookie: ctx.cashier, body: { enabled: true, token: mock.token } });
  assert.equal(cashier.status, 403);

  const ok = await call(emecfRoute.PUT, { path: "/api/company/emecf", cookie: ctx.owner, body: { enabled: true, token: mock.token, defaultTaxGroup: "B" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.enabled, true);
  assert.equal(ok.json.data.nim, mock.nim);
  assert.equal(ok.json.data.hasToken, true);
  assert.equal(JSON.stringify(ok.json).includes(mock.token), false, "le jeton n'est jamais renvoyé");
  const stored = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: { emecfTokenEnc: true } });
  assert.ok(stored?.emecfTokenEnc?.startsWith("v1."));
  assert.equal(stored!.emecfTokenEnc!.includes(mock.token), false);
});

test("vente : facture normalisée aussitôt (code MECeF/DGI, QR, compteurs, NIM)", async () => {
  // 2 × 800 (groupe B par défaut) + 3 × 300 (glace, groupe A) = 2 500 ; client paie 3 000
  const s = await sell({
    lines: [
      { productId: ctx.saucisse.id, quantity: 2, unitPrice: 800 },
      { productId: ctx.glace.id, quantity: 3, unitPrice: 300 },
    ],
    payments: [{ method: "CASH", amount: 3000 }],
  });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  const e = s.json.data.emecf;
  assert.equal(e.status, "NORMALIZED", JSON.stringify(e));
  assert.match(e.codeMecefDgi, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){5}$/);
  assert.ok(e.qrCode.startsWith(`F;${mock.nim};`));
  assert.equal(e.nim, mock.nim);
  assert.match(e.counters, /FV$/);
  assert.equal(e.total, 2500);
  assert.equal(e.totals.tab, 1600);
  assert.equal(e.totals.taa, 900);

  const sent = mock.invoices.at(-1)!.body;
  assert.equal(sent.type, "FV");
  assert.equal(sent.ifu, mock.ifu);
  assert.deepEqual(sent.items.map((i: Json) => [i.code, i.price, i.quantity, i.taxGroup]), [["S08", 800, 2, "B"], ["G01", 300, 3, "A"]]);
  assert.deepEqual(sent.payment, [{ name: "ESPECES", amount: 2500 }], "la monnaie rendue est déduite");
  assert.equal(sent.operator.name, "Awa Dossou");

  // La fiche de la vente porte les éléments de sécurité (réimpression, A4)
  const detail = await call(saleRoute.GET, { path: `/api/sales/${s.json.data.id}`, cookie: ctx.owner, params: { id: s.json.data.id } });
  assert.equal(detail.json.data.emecf.codeMecefDgi, e.codeMecefDgi);
  ctx.normalizedSale = s.json.data.id;
  ctx.normalizedCode = e.codeMecefDgi;

  // Rejeu (même clé, synchronisation en double) : même facture, aucun nouvel envoi
  const posts = mock.posts;
  const replay = await sell({ lines: [{ productId: ctx.saucisse.id, quantity: 2, unitPrice: 800 }, { productId: ctx.glace.id, quantity: 3, unitPrice: 300 }], payments: [{ method: "CASH", amount: 3000 }] }, s.json.data.idempotencyKey);
  assert.equal(replay.json.replayed, true);
  assert.equal(replay.json.data.emecf.codeMecefDgi, e.codeMecefDgi);
  assert.equal(mock.posts, posts);
});

test("remise et paiement mobile : prix d'origine et modification transmis", async () => {
  const s = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.owner,
    body: { sessionId: ctx.ownerSession, idempotencyKey: idem(), lines: [{ productId: ctx.saucisse.id, quantity: 4, unitPrice: 800, discount: 50 }], payments: [{ method: "MOBILE_MONEY", amount: 3000, reference: "MTN123" }] },
  });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal(s.json.data.emecf.status, "NORMALIZED");
  const it = mock.invoices.at(-1)!.body.items[0];
  assert.deepEqual([it.price, it.originalPrice, it.quantity], [750, 800, 4]);
  assert.match(it.priceModification, /Remise/);
  assert.deepEqual(mock.invoices.at(-1)!.body.payment, [{ name: "MOBILEMONEY", amount: 3000 }]);
});

test("DGI injoignable : la vente passe, la facture est reprise ensuite", async () => {
  mock.fail.down = true;
  const t0 = Date.now();
  const s = await sell({ lines: [{ productId: ctx.saucisse.id, quantity: 1, unitPrice: 800 }], payments: [{ method: "CASH", amount: 800 }] });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.ok(Date.now() - t0 < 10_000, "la caisse n'attend pas indéfiniment");
  assert.equal(s.json.data.emecf.status, "PENDING");
  assert.match(s.json.data.emecf.lastError, /DGI/);
  mock.fail.down = false;

  const r = await call(retryRoute.POST, { path: "/api/company/emecf/retry", cookie: ctx.owner, body: { saleId: s.json.data.id } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.documents[0].status, "NORMALIZED");
});

test("coupure entre l'envoi et la confirmation : même transaction confirmée, pas de doublon", async () => {
  mock.fail.confirm = "network";
  const s = await sell({ lines: [{ productId: ctx.saucisse.id, quantity: 2, unitPrice: 800 }], payments: [{ method: "CASH", amount: 1600 }] });
  assert.equal(s.json.data.emecf.status, "SUBMITTED");
  const d = await doc(s.json.data.id);
  assert.ok(d?.uid);
  const posts = mock.posts;
  await prisma.emecfDocument.update({ where: { id: d!.id }, data: { nextAttemptAt: null } });
  await sweepIfDue(ctx.companyId);
  const after1 = await doc(s.json.data.id);
  assert.equal(after1?.status, "NORMALIZED");
  assert.equal(after1?.uid, d!.uid, "la transaction déjà envoyée est confirmée");
  assert.equal(mock.posts, posts, "aucun second envoi");
});

test("envoi interrompu sans uid : la demande orpheline est annulée avant de renvoyer", async () => {
  const stray = mock.addStrayPending();
  mock.fail.post = "network";
  const s = await sell({ lines: [{ productId: ctx.glace.id, quantity: 1, unitPrice: 300 }], payments: [{ method: "CASH", amount: 300 }] });
  assert.equal(s.json.data.emecf.status, "PENDING");
  await call(retryRoute.POST, { path: "/api/company/emecf/retry", cookie: ctx.owner, body: { saleId: s.json.data.id } });
  assert.equal(mock.invoices.find((i) => i.uid === stray)!.state, "cancelled");
  assert.equal((await doc(s.json.data.id))?.status, "NORMALIZED");
  assert.equal(mock.invoices.filter((i) => i.state === "pending").length, 0);
});

test("total de la DGI différent : la transaction est annulée, rien n'est émis", async () => {
  mock.fail.totalOffset = 100;
  const s = await sell({ lines: [{ productId: ctx.saucisse.id, quantity: 1, unitPrice: 800 }], payments: [{ method: "CASH", amount: 800 }] });
  assert.equal(s.json.data.emecf.status, "FAILED");
  assert.match(s.json.data.emecf.lastError, /Total DGI/);
  assert.equal(mock.invoices.at(-1)!.state, "cancelled");
  ctx.failedSale = s.json.data.id;
});

test("refus de la DGI : motif enregistré, repris après correction des réglages", async () => {
  mock.fail.post = "reject";
  const s = await sell({ lines: [{ productId: ctx.glace.id, quantity: 2, unitPrice: 300 }], payments: [{ method: "CASH", amount: 600 }] });
  assert.equal(s.json.data.emecf.status, "FAILED");
  assert.match(s.json.data.emecf.lastError, /groupe de taxe/i);
  const st = await call(emecfRoute.GET, { path: "/api/company/emecf", cookie: ctx.owner });
  assert.ok(st.json.data.waiting.some((w: Json) => w.sale.id === s.json.data.id));
  // Réglage modifié → les factures refusées sont reprises
  const upd = await call(emecfRoute.PUT, { path: "/api/company/emecf", cookie: ctx.owner, body: { defaultTaxGroup: "B" } });
  assert.equal(upd.status, 200);
  await sweepIfDue(ctx.companyId).catch(() => undefined);
  const r = await call(retryRoute.POST, { path: "/api/company/emecf/retry", cookie: ctx.owner, body: {} });
  assert.equal(r.status, 200);
  assert.equal((await doc(s.json.data.id))?.status, "NORMALIZED");
  assert.equal((await doc(ctx.failedSale))?.status, "NORMALIZED");
});

test("annulation d'une vente normalisée : facture d'avoir (FA) qui la référence", async () => {
  const req = await call(cancelRoute.POST, { path: `/api/sales/${ctx.normalizedSale}/cancel`, cookie: ctx.cashier, params: { id: ctx.normalizedSale }, body: { action: "request", reason: "Client a rendu la marchandise" } });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  const ok = await call(cancelRoute.POST, {
    path: `/api/sales/${ctx.normalizedSale}/cancel`,
    cookie: ctx.owner,
    params: { id: ctx.normalizedSale },
    body: { action: "decide", cancellationId: req.json.data.id, decision: "APPROVED" },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.emecfCredit.status, "NORMALIZED");
  assert.equal(ok.json.emecfCredit.type, "FA");
  const fa = mock.invoices.at(-1)!.body;
  assert.equal(fa.type, "FA");
  assert.equal(fa.reference, ctx.normalizedCode.replaceAll("-", ""));
  assert.equal(fa.reference.length, 24);
  const detail = await call(saleRoute.GET, { path: `/api/sales/${ctx.normalizedSale}`, cookie: ctx.owner, params: { id: ctx.normalizedSale } });
  assert.match(detail.json.data.emecfCredit.counters, /FA$/);
});

test("annulation d'une vente jamais normalisée : rien à déclarer, pas d'avoir", async () => {
  mock.fail.down = true;
  const s = await sell({ lines: [{ productId: ctx.saucisse.id, quantity: 1, unitPrice: 800 }], payments: [{ method: "CASH", amount: 800 }] });
  mock.fail.down = false;
  assert.equal(s.json.data.emecf.status, "PENDING");
  const req = await call(cancelRoute.POST, { path: `/api/sales/${s.json.data.id}/cancel`, cookie: ctx.cashier, params: { id: s.json.data.id }, body: { action: "request", reason: "Erreur de saisie" } });
  const ok = await call(cancelRoute.POST, { path: `/api/sales/${s.json.data.id}/cancel`, cookie: ctx.owner, params: { id: s.json.data.id }, body: { action: "decide", cancellationId: req.json.data.id, decision: "APPROVED" } });
  assert.equal(ok.status, 200);
  assert.equal(await doc(s.json.data.id), null);
  assert.equal(await doc(s.json.data.id, "FA"), null);
});

test("tâche planifiée protégée", async () => {
  const r = await call(cronRoute.GET, { path: "/api/cron/emecf" });
  assert.equal(r.status, 401);
  process.env.CRON_SECRET = "secret-de-cron-pour-les-tests-0123456789";
  const ok = await call(cronRoute.GET, { path: "/api/cron/emecf", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

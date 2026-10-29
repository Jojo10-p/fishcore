/**
 * Numérotation des factures par la caisse (impression du numéro définitif
 * même sans connexion) : pas de doublon, pas de trou, heure réelle de vente.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const productsRoute = await import("@/app/api/products/route");
const unitsRoute = await import("@/app/api/units/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const numbersRoute = await import("@/app/api/cash/sessions/[id]/numbers/route");
const salesRoute = await import("@/app/api/sales/route");
const companyRoute = await import("@/app/api/company/route");
const syncStateRoute = await import("@/app/api/sync/state/route");
const { verifyAuditChain } = await import("@/lib/audit");
const { unusedRanges } = await import("@/lib/invoice-numbers");

const ctx: Json = {};

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Poissonnerie Test", ownerName: "Patron", phone: "97000000", email: "owner@num.bj", password: "Motdepasse1", businessType: "FISHMONGER" },
  });
  ctx.companyId = reg.json.data.companyId;
  ctx.owner = await login("owner@num.bj");
  ctx.centerId = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Magasin", code: "MAG" } })).json.data.id;
  const hash = await passwordHash();
  for (const key of ["c1", "c2"]) {
    await prisma.user.create({
      data: { email: `${key}@num.bj`, passwordHash: hash, firstName: key, lastName: "T", role: "CASHIER", companyId: ctx.companyId, centers: { create: [{ centerId: ctx.centerId }] } },
    });
    ctx[key] = await login(`${key}@num.bj`);
  }
  const regs = await prisma.cashRegister.findMany({ where: { centerId: ctx.centerId } });
  ctx.reg1 = regs[0].id;
  ctx.reg2 = (regs[1] ?? (await prisma.cashRegister.create({ data: { centerId: ctx.centerId, name: "Caisse 2" } }))).id;

  const units = await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner });
  const kg = units.json.data.find((u: Json) => u.symbol === "kg").id;
  ctx.p = (await call(productsRoute.POST, { path: "/api/products", cookie: ctx.owner, body: { name: "Chinchard", baseUnitId: kg, purchasePrice: 900, sellingPrice: 1200, stockAlertQty: 0 } })).json.data;
  const r = await call(receiptsRoute.POST, { path: "/api/goods-receipts", cookie: ctx.owner, body: { centerId: ctx.centerId, lines: [{ productId: ctx.p.id, quantity: 1000, unitPrice: 900, totalPrice: 900000 }] } });
  await call(validateRoute.POST, { path: `/api/goods-receipts/${r.json.data.id}/validate`, cookie: ctx.owner, params: { id: r.json.data.id }, body: {} });
});
after(async () => prisma.$disconnect());

const open = async (cookie: string, register: string) =>
  (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie, body: { action: "open", cashRegisterId: register, openingBalance: 0 } })).json.data.id as string;
const close = (cookie: string, sessionId: string) => call(cashRoute.POST, { path: "/api/cash/sessions", cookie, body: { action: "close", sessionId, declaredBalance: 0 } });
const block = (cookie: string, sessionId: string) =>
  call(numbersRoute.POST, { path: `/api/cash/sessions/${sessionId}/numbers`, cookie, params: { id: sessionId }, body: {} });
const numbers = (cookie: string, sessionId: string) =>
  call(numbersRoute.GET, { path: `/api/cash/sessions/${sessionId}/numbers`, cookie, params: { id: sessionId } });
const sell = (cookie: string, sessionId: string, extra: Json = {}) =>
  call(salesRoute.POST, {
    path: "/api/sales", cookie,
    body: { sessionId, idempotencyKey: idem(), lines: [{ productId: ctx.p.id, quantity: 1, unitPrice: 1200 }], payments: [{ method: "CASH", amount: 1200 }], ...extra },
  });
const counter = async () => (await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } })).invoiceCounter;

test("plages non utilisées : calcul", () => {
  assert.deepEqual(unusedRanges(1, 10, [1, 2, 5, 10]), [[3, 4], [6, 9]]);
  assert.deepEqual(unusedRanges(1, 3, []), [[1, 3]]);
  assert.deepEqual(unusedRanges(1, 3, [1, 2, 3]), []);
});

test("la caisse reçoit une plage et l'en-tête de ses tickets", async () => {
  ctx.s1 = await open(ctx.c1, ctx.reg1);
  const b = await block(ctx.c1, ctx.s1);
  assert.equal(b.status, 201, JSON.stringify(b.json));
  assert.deepEqual([b.json.data.block.first, b.json.data.block.last], [1, 100]);
  assert.equal(await counter(), 101);

  const other = await block(ctx.c2, ctx.s1);
  assert.equal(other.status, 403, "la plage d'une session n'est confiée qu'à son caissier");

  const g = await numbers(ctx.c1, ctx.s1);
  assert.equal(g.json.data.header.company.tradeName, "Poissonnerie Test");
  assert.equal(g.json.data.header.center.name, "Magasin");
  assert.equal(g.json.data.header.company.invoiceFormat, "TICKET_80", "ticket 80 mm par défaut");
});

test("clôture : les numéros non utilisés en fin de suite sont rendus (pas de trou)", async () => {
  const a = await sell(ctx.c1, ctx.s1, { invoiceSeq: 1 });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.data.saleNumber, "FACT-000001");
  const b = await sell(ctx.c1, ctx.s1, { invoiceSeq: 2 });
  assert.equal(b.json.data.saleNumber, "FACT-000002");
  const c = await close(ctx.c1, ctx.s1);
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(await counter(), 3, "3 à 100 rendus : la prochaine facture sera la 3");
  assert.equal(await prisma.invoiceNumberBlock.count({ where: { companyId: ctx.companyId, sessionId: null } }), 0);
});

test("deux caisses, vente hors connexion, doublon et numéro étranger refusés", async () => {
  ctx.s2 = await open(ctx.c1, ctx.reg1);
  ctx.s3 = await open(ctx.c2, ctx.reg2);
  const b2 = (await block(ctx.c1, ctx.s2)).json.data.block;
  const b3 = (await block(ctx.c2, ctx.s3)).json.data.block;
  assert.deepEqual([b2.first, b2.last, b3.first, b3.last], [3, 102, 103, 202]);

  await sell(ctx.c1, ctx.s2, { invoiceSeq: 3 });
  // Vente faite hors connexion il y a 30 secondes, synchronisée maintenant
  const soldAt = new Date(Date.now() - 30_000).toISOString();
  const off = await sell(ctx.c1, ctx.s2, { invoiceSeq: 4, createdOffline: true, soldAt });
  assert.equal(off.status, 201, JSON.stringify(off.json));
  assert.equal(new Date(off.json.data.createdAt).toISOString(), soldAt, "date de la vente, pas de l'envoi");

  const dup = await sell(ctx.c1, ctx.s2, { invoiceSeq: 4 });
  assert.equal(dup.status, 409, "un numéro ne sert qu'une fois");
  const foreign = await sell(ctx.c1, ctx.s2, { invoiceSeq: 150 });
  assert.equal(foreign.json.code, "INVOICE_NUMBER_INVALID", "150 appartient à l'autre caisse");

  const direct = await sell(ctx.c2, ctx.s3); // appel direct sans numéro : suite du compteur
  assert.equal(direct.json.data.saleNumber, "FACT-000203");
  await sell(ctx.c2, ctx.s3, { invoiceSeq: 103 });
});

test("numéros rendus au milieu de la suite : réattribués en priorité", async () => {
  await close(ctx.c1, ctx.s2); // 5..102 rendus
  await close(ctx.c2, ctx.s3); // 104..202 rendus
  const free = await prisma.invoiceNumberBlock.findMany({ where: { companyId: ctx.companyId, sessionId: null }, orderBy: { first: "asc" } });
  assert.deepEqual(free.map((f) => [f.first, f.last]), [[5, 102], [104, 202]]);
  assert.equal(await counter(), 204);

  ctx.s4 = await open(ctx.c1, ctx.reg1);
  const b = (await block(ctx.c1, ctx.s4)).json.data.block;
  assert.deepEqual([b.first, b.last], [5, 102], "la plus ancienne plage libre d'abord");
  const s = await sell(ctx.c1, ctx.s4, { invoiceSeq: 5 });
  assert.equal(s.json.data.saleNumber, "FACT-000005");

  // Tous les numéros de 1 à 5 existent : aucun trou
  const seqs = (await prisma.sale.findMany({ where: { companyId: ctx.companyId }, select: { invoiceSeq: true } })).map((x) => x.invoiceSeq).sort((x, y) => x! - y!);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 103, 203]);
});

test("avance limitée par caisse ; nouveau préfixe : numéros rendus abandonnés", async () => {
  await block(ctx.c1, ctx.s4); // 104..202
  const third = await block(ctx.c1, ctx.s4);
  assert.equal(third.status, 201);
  const fourth = await block(ctx.c1, ctx.s4);
  assert.equal(fourth.status, 200, "assez de numéros d'avance : pas de nouvelle plage");
  assert.equal(fourth.json.data.block, null);

  await close(ctx.c1, ctx.s4);
  assert.ok((await prisma.invoiceNumberBlock.count({ where: { companyId: ctx.companyId, sessionId: null } })) > 0);
  const r = await call(companyRoute.PATCH, { path: "/api/company", method: "PATCH", cookie: ctx.owner, body: { invoicePrefix: "CPF27" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(await prisma.invoiceNumberBlock.count({ where: { companyId: ctx.companyId, sessionId: null } }), 0);
  const s5 = await open(ctx.c1, ctx.reg1);
  const b = (await block(ctx.c1, s5)).json.data.block;
  assert.equal(b.prefix, "CPF27");
});

test("vente hors connexion au-delà du stock enregistré : acceptée, écart tracé ; en ligne : refusée", async () => {
  const kg = (await prisma.unit.findFirstOrThrow({ where: { symbol: "kg", OR: [{ companyId: ctx.companyId }, { companyId: null }] } })).id;
  const p = (await call(productsRoute.POST, { path: "/api/products", cookie: ctx.owner, body: { name: "Thon", baseUnitId: kg, purchasePrice: 2000, sellingPrice: 3000, stockAlertQty: 0 } })).json.data;
  const session = await prisma.cashSession.findFirstOrThrow({ where: { cashierId: (await prisma.user.findFirstOrThrow({ where: { email: "c1@num.bj" } })).id, closedAt: null } });
  const line = { productId: p.id, quantity: 2, unitPrice: 3000 };

  const online = await call(salesRoute.POST, {
    path: "/api/sales", cookie: ctx.c1, body: { sessionId: session.id, idempotencyKey: idem(), lines: [line], payments: [{ method: "CASH", amount: 6000 }] },
  });
  assert.equal(online.status, 409, "en ligne, pas de vente sans stock");

  const offline = await call(salesRoute.POST, {
    path: "/api/sales", cookie: ctx.c1,
    body: { sessionId: session.id, idempotencyKey: idem(), lines: [line], payments: [{ method: "CASH", amount: 6000 }], createdOffline: true, soldAt: new Date().toISOString() },
  });
  assert.equal(offline.status, 201, JSON.stringify(offline.json));
  const stock = await prisma.stock.findFirstOrThrow({ where: { productId: p.id }, include: { movements: { orderBy: { createdAt: "asc" } } } });
  assert.equal(Number(stock.quantity), 0, "stock jamais négatif");
  assert.deepEqual(stock.movements.map((m) => [m.type, Number(m.quantity)]).sort(), [["INVENTORY_ADJUST", 2], ["SALE", -2]]);
  const audit = await prisma.auditLog.findFirst({ where: { companyId: ctx.companyId, eventType: "STOCK_ADJUSTED", referenceId: offline.json.data.id } });
  assert.ok(audit, "écart tracé au journal");
  assert.equal(Number(offline.json.data.lines[0].costAmount), 4000, "coût de revient : prix d'achat à défaut de CMP");
});

test("empreinte de synchro : change dès que le stock ou un prix change", async () => {
  const stamp = async () => {
    const r = await call(syncStateRoute.GET, { path: `/api/sync/state?centerId=${ctx.centerId}`, cookie: ctx.c1 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.stamp as string;
  };
  const a = await stamp();
  assert.equal(await stamp(), a, "rien n'a changé : même empreinte");
  await sell(ctx.c1, (await prisma.cashSession.findFirstOrThrow({ where: { closedAt: null, cashRegisterId: ctx.reg1 } })).id);
  const b = await stamp();
  assert.notEqual(b, a, "une vente change le stock");
  await prisma.product.update({ where: { id: ctx.p.id }, data: { sellingPrice: 1300 } });
  assert.notEqual(await stamp(), b, "un prix modifié change le catalogue");
});

test("journal d'audit intègre ; la clôture trace les numéros rendus", async () => {
  const closes = await prisma.auditLog.findMany({ where: { companyId: ctx.companyId, eventType: "CASH_SESSION_CLOSED" }, orderBy: { serverTimestamp: "asc" } });
  assert.equal((closes[1].newValues as Json).invoiceNumbersReturned, "5-102");
  assert.equal((await verifyAuditChain(ctx.companyId)).isValid, true);
});

/**
 * Factures, devis et retrait au magasin (cahier §13).
 * Scénario : dépôt de matériaux (le client paie à la caisse puis se fait
 * servir au magasin sur présentation de sa facture).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const productsRoute = await import("@/app/api/products/route");
const productRoute = await import("@/app/api/products/[id]/route");
const unitsRoute = await import("@/app/api/units/route");
const customersRoute = await import("@/app/api/customers/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const saleRoute = await import("@/app/api/sales/[id]/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const quotesRoute = await import("@/app/api/quotes/route");
const quoteRoute = await import("@/app/api/quotes/[id]/route");
const quoteCancelRoute = await import("@/app/api/quotes/[id]/cancel/route");
const deliverRoute = await import("@/app/api/sales/[id]/deliveries/route");
const deliveriesRoute = await import("@/app/api/deliveries/route");
const companyRoute = await import("@/app/api/company/route");
const { verifyAuditChain } = await import("@/lib/audit");

const ctx: Json = {};

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Dépôt Akpakpa", ownerName: "Patron", phone: "97000000", email: "owner@depot.bj", password: "Motdepasse1", businessType: "BUILDING_MATERIALS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.companyId = reg.json.data.companyId;
  ctx.owner = await login("owner@depot.bj");
  const center = await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Dépôt", code: "DEP" } });
  ctx.centerId = center.json.data.id;

  const hash = await passwordHash();
  for (const [key, role] of [["cashier", "CASHIER"], ["cashier2", "CASHIER"], ["keeper", "STOCK_MANAGER"], ["seller", "SALES_EMPLOYEE"]] as const) {
    const u = await prisma.user.create({
      data: { email: `${key}@depot.bj`, passwordHash: hash, firstName: key, lastName: "T", role, companyId: ctx.companyId, centers: { create: [{ centerId: ctx.centerId }] } },
    });
    ctx[key] = await login(u.email);
  }

  const units = await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner });
  const U = Object.fromEntries(units.json.data.map((u: Json) => [u.symbol, u.id]));
  ctx.U = U;
  const mk = async (body: Json) => {
    const r = await call(productsRoute.POST, { path: "/api/products", cookie: ctx.owner, body: { purchasePrice: 0, stockAlertQty: 0, ...body } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.data;
  };
  ctx.ciment = await mk({ name: "Ciment CPJ 42.5", baseUnitId: U["sac"], sellingPrice: 5800 });
  ctx.fer = await mk({ name: "Fer Ø10", baseUnitId: U["barre"], sellingPrice: 3600 });

  const r = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie: ctx.owner,
    body: {
      centerId: ctx.centerId,
      lines: [
        { productId: ctx.ciment.id, quantity: 500, unitPrice: 5000, totalPrice: 2500000 },
        { productId: ctx.fer.id, quantity: 300, unitPrice: 3000, totalPrice: 900000 },
      ],
    },
  });
  await call(validateRoute.POST, { path: `/api/goods-receipts/${r.json.data.id}/validate`, cookie: ctx.owner, params: { id: r.json.data.id }, body: {} });

  const registers = await prisma.cashRegister.findMany({ where: { centerId: ctx.centerId } });
  let reg2 = registers[1];
  if (!reg2) reg2 = await prisma.cashRegister.create({ data: { centerId: ctx.centerId, name: "Caisse 2" } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: registers[0].id, openingBalance: 0 } })).json.data.id;
  ctx.session2 = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier2, body: { action: "open", cashRegisterId: reg2.id, openingBalance: 0 } })).json.data.id;

  const c = await call(customersRoute.POST, { path: "/api/customers", cookie: ctx.seller, body: { name: "Entreprise BTP Akpro", phone: "96000000", taxId: "3201900012345" } });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  ctx.customerId = c.json.data.id;
});
after(async () => prisma.$disconnect());

const sell = (cookie: string, session: string, body: Json) =>
  call(salesRoute.POST, { path: "/api/sales", cookie, body: { sessionId: session, idempotencyKey: idem(), lines: [], ...body } });

test("le métier « matériaux » sert la marchandise au magasin par défaut", async () => {
  const company = await call(companyRoute.GET, { path: "/api/company", cookie: ctx.owner });
  assert.equal(company.json.data.requiresPickup, true);
  assert.equal(company.json.data.quotePrefix, "DEV");
});

test("devis : prix de la base, numéro séquentiel, remise réservée aux responsables", async () => {
  const lines = [
    { productId: ctx.ciment.id, quantity: 50, unitPrice: 1 }, // prix envoyé ignoré
    { productId: ctx.fer.id, quantity: 30, unitPrice: 1 },
  ];
  const noDiscount = await call(quotesRoute.POST, {
    path: "/api/quotes",
    cookie: ctx.seller,
    body: { centerId: ctx.centerId, customerId: ctx.customerId, lines: [{ ...lines[0], discount: 300 }] },
  });
  assert.equal(noDiscount.status, 403, "le vendeur n'accorde pas de remise");

  // 50 × (5 800 − 300) + 30 × 3 600 = 275 000 + 108 000 = 383 000
  const q = await call(quotesRoute.POST, {
    path: "/api/quotes",
    cookie: ctx.owner,
    body: { centerId: ctx.centerId, customerId: ctx.customerId, validityDays: 10, notes: "Livraison sous 48 h", lines: [{ ...lines[0], discount: 300 }, lines[1]] },
  });
  assert.equal(q.status, 201, JSON.stringify(q.json));
  assert.equal(q.json.data.number, "DEV-000001");
  assert.equal(Number(q.json.data.totalAmount), 383000);
  const days = (new Date(q.json.data.validUntil).getTime() - Date.now()) / 86400000;
  assert.ok(days > 9.5 && days < 11, `valable 10 jours (${days.toFixed(2)})`);
  ctx.quote = q.json.data;

  const q2 = await call(quotesRoute.POST, { path: "/api/quotes", cookie: ctx.seller, body: { centerId: ctx.centerId, customerId: ctx.customerId, lines: [lines[1]] } });
  assert.equal(q2.json.data.number, "DEV-000002");
  ctx.quote2 = q2.json.data;

  const detail = await call(quoteRoute.GET, { path: `/api/quotes/${ctx.quote.id}`, cookie: ctx.cashier, params: { id: ctx.quote.id } });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.customer.taxId, "3201900012345");
  assert.deepEqual(detail.json.data.lines.map((l: Json) => l.unitSymbol), ["sac", "barre"]);

  const byNumber = await call(quotesRoute.GET, { path: "/api/quotes?number=dev-000001", cookie: ctx.cashier });
  assert.equal(byNumber.json.data.length, 1, "recherche par numéro (douchette), sans tenir compte de la casse");
});

test("devis encaissé à la caisse : prix du devis conservés même si le tarif a changé", async () => {
  // Le ciment passe à 6 000 après le devis
  const up = await call(productRoute.PATCH, {
    path: `/api/products/${ctx.ciment.id}`, method: "PATCH", cookie: ctx.owner, params: { id: ctx.ciment.id }, body: { sellingPrice: 6000 },
  });
  assert.equal(up.status, 200, JSON.stringify(up.json));

  const underpaid = await sell(ctx.cashier, ctx.session, { quoteId: ctx.quote.id, payments: [{ method: "CASH", amount: 380000 }] });
  assert.equal(underpaid.status, 400, "le montant du devis doit être payé en entier");

  const s = await sell(ctx.cashier, ctx.session, {
    quoteId: ctx.quote.id,
    // lignes falsifiées par le navigateur : ignorées
    lines: [{ productId: ctx.ciment.id, quantity: 1, unitPrice: 1 }],
    payments: [{ method: "CASH", amount: 383000 }],
  });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal(Number(s.json.data.totalAmount), 383000);
  assert.equal(s.json.data.customerId, ctx.customerId, "facture au nom du client du devis");
  assert.deepEqual(s.json.data.lines.map((l: Json) => l.productId), [ctx.ciment.id, ctx.fer.id], "lignes dans l'ordre du devis");
  assert.equal(s.json.data.deliveryStatus, "PENDING", "marchandise à retirer au magasin");
  ctx.sale = s.json.data;

  const quote = await prisma.quote.findUniqueOrThrow({ where: { id: ctx.quote.id } });
  assert.equal(quote.status, "CONVERTED");
  assert.equal(quote.saleId, ctx.sale.id);

  const again = await sell(ctx.cashier2, ctx.session2, { quoteId: ctx.quote.id, payments: [{ method: "CASH", amount: 383000 }] });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "QUOTE_CONVERTED", "un devis ne s'encaisse qu'une fois");
});

test("deux caisses encaissent le même devis en même temps : une seule vente", async () => {
  const [a, b] = await Promise.all([
    sell(ctx.cashier, ctx.session, { quoteId: ctx.quote2.id, payments: [{ method: "CASH", amount: 108000 }] }),
    sell(ctx.cashier2, ctx.session2, { quoteId: ctx.quote2.id, payments: [{ method: "CASH", amount: 108000 }] }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(await prisma.sale.count({ where: { quote: { id: ctx.quote2.id } } }), 1);
});

test("devis annulé ou expiré : refusé à la caisse", async () => {
  const q = await call(quotesRoute.POST, { path: "/api/quotes", cookie: ctx.owner, body: { centerId: ctx.centerId, customerId: ctx.customerId, lines: [{ productId: ctx.fer.id, quantity: 1, unitPrice: 0 }] } });
  const cancelSeller = await call(quoteCancelRoute.POST, { path: `/api/quotes/${q.json.data.id}/cancel`, cookie: ctx.seller, params: { id: q.json.data.id }, body: { reason: "Client parti" } });
  assert.equal(cancelSeller.status, 403);
  const cancel = await call(quoteCancelRoute.POST, { path: `/api/quotes/${q.json.data.id}/cancel`, cookie: ctx.owner, params: { id: q.json.data.id }, body: { reason: "Client parti" } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  const s = await sell(ctx.cashier, ctx.session, { quoteId: q.json.data.id, payments: [{ method: "CASH", amount: 3600 }] });
  assert.equal(s.json.code, "QUOTE_CANCELLED");

  const old = await call(quotesRoute.POST, { path: "/api/quotes", cookie: ctx.owner, body: { centerId: ctx.centerId, customerId: ctx.customerId, lines: [{ productId: ctx.fer.id, quantity: 1, unitPrice: 0 }] } });
  await prisma.quote.update({ where: { id: old.json.data.id }, data: { validUntil: new Date(Date.now() - 1000) } });
  const expired = await sell(ctx.cashier, ctx.session, { quoteId: old.json.data.id, payments: [{ method: "CASH", amount: 3600 }] });
  assert.equal(expired.json.code, "QUOTE_EXPIRED");
  const list = await call(quotesRoute.GET, { path: "/api/quotes?status=EXPIRED", cookie: ctx.owner });
  assert.deepEqual(list.json.data.map((x: Json) => x.id), [old.json.data.id]);
});

test("la facture porte le client, le devis d'origine et l'état du retrait", async () => {
  const keeperView = await call(saleRoute.GET, { path: `/api/sales/${ctx.sale.id}`, cookie: ctx.keeper, params: { id: ctx.sale.id } });
  assert.equal(keeperView.status, 200, "le magasinier consulte la facture présentée");
  const d = keeperView.json.data;
  assert.equal(d.customer.name, "Entreprise BTP Akpro");
  assert.equal(d.quote.number, "DEV-000001");
  assert.equal(d.company.requiresPickup, true);
  assert.deepEqual(d.lines.map((l: Json) => Number(l.deliveredQuantity)), [0, 0]);
});

test("retrait en plusieurs fois, jamais plus que payé", async () => {
  const lines = ctx.sale.lines as Json[];
  const ciment = lines.find((l) => l.productId === ctx.ciment.id);
  const fer = lines.find((l) => l.productId === ctx.fer.id);

  const cashierTry = await call(deliverRoute.POST, {
    path: `/api/sales/${ctx.sale.id}/deliveries`, cookie: ctx.cashier, params: { id: ctx.sale.id }, body: { lines: [{ saleLineId: ciment.id, quantity: 1 }] },
  });
  assert.equal(cashierTry.status, 403, "la caisse encaisse, le magasin sert");

  const first = await call(deliverRoute.POST, {
    path: `/api/sales/${ctx.sale.id}/deliveries`, cookie: ctx.keeper, params: { id: ctx.sale.id },
    body: { lines: [{ saleLineId: ciment.id, quantity: 20 }], notes: "Camion 1" },
  });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.data.number, 1);
  assert.equal(first.json.data.deliveryStatus, "PARTIAL");

  const half = await call(deliverRoute.POST, {
    path: `/api/sales/${ctx.sale.id}/deliveries`, cookie: ctx.keeper, params: { id: ctx.sale.id }, body: { lines: [{ saleLineId: ciment.id, quantity: 1.5 }] },
  });
  assert.equal(half.json.code, "INTEGER_QUANTITY", "on ne remet pas un demi-sac");

  const over = await call(deliverRoute.POST, {
    path: `/api/sales/${ctx.sale.id}/deliveries`, cookie: ctx.keeper, params: { id: ctx.sale.id }, body: { lines: [{ saleLineId: ciment.id, quantity: 31 }] },
  });
  assert.equal(over.status, 409, "il ne reste que 30 sacs");
  assert.equal(over.json.code, "OVER_DELIVERY");

  // Deux magasiniers servent le reste en même temps : un seul passe
  const [a, b] = await Promise.all(
    [ctx.keeper, ctx.owner].map((cookie) =>
      call(deliverRoute.POST, {
        path: `/api/sales/${ctx.sale.id}/deliveries`, cookie, params: { id: ctx.sale.id },
        body: { lines: [{ saleLineId: ciment.id, quantity: 30 }, { saleLineId: fer.id, quantity: 30 }] },
      })
    )
  );
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);

  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: ctx.sale.id }, include: { lines: true, deliveries: true } });
  assert.equal(sale.deliveryStatus, "DELIVERED");
  assert.deepEqual(sale.lines.map((l) => Number(l.deliveredQuantity)).sort((x, y) => x - y), [30, 50]);
  assert.equal(sale.deliveries.length, 2);

  const done = await call(deliverRoute.POST, {
    path: `/api/sales/${ctx.sale.id}/deliveries`, cookie: ctx.keeper, params: { id: ctx.sale.id }, body: { lines: [{ saleLineId: fer.id, quantity: 1 }] },
  });
  assert.equal(done.status, 409, "facture déjà entièrement servie");
});

test("annulation en attente ou vente annulée : rien n'est remis", async () => {
  const s = await sell(ctx.cashier, ctx.session, { lines: [{ productId: ctx.fer.id, quantity: 5, unitPrice: 3600 }], payments: [{ method: "CASH", amount: 18000 }] });
  assert.equal(s.status, 201);
  const lineId = s.json.data.lines[0].id;

  const pending = await call(deliveriesRoute.GET, { path: `/api/deliveries?centerId=${ctx.centerId}`, cookie: ctx.keeper });
  assert.ok(pending.json.data.pending.some((p: Json) => p.id === s.json.data.id), "visible dans « À servir »");

  const req = await call(cancelRoute.POST, {
    path: `/api/sales/${s.json.data.id}/cancel`, cookie: ctx.cashier, params: { id: s.json.data.id }, body: { action: "request", reason: "Erreur de saisie" },
  });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  const blocked = await call(deliverRoute.POST, {
    path: `/api/sales/${s.json.data.id}/deliveries`, cookie: ctx.keeper, params: { id: s.json.data.id }, body: { lines: [{ saleLineId: lineId, quantity: 5 }] },
  });
  assert.equal(blocked.json.code, "CANCELLATION_PENDING");

  const scan = await call(deliveriesRoute.GET, { path: `/api/deliveries?centerId=${ctx.centerId}&search=${ctx.sale.saleNumber}`, cookie: ctx.keeper });
  assert.equal(scan.json.data.pending.length, 0);
  assert.equal(scan.json.data.exact.deliveryStatus, "DELIVERED", "facture déjà servie : le magasinier est prévenu");
});

test("sans retrait au magasin, la marchandise est remise sur-le-champ", async () => {
  const off = await call(companyRoute.PATCH, { path: "/api/company", method: "PATCH", cookie: ctx.owner, body: { requiresPickup: false } });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  const s = await sell(ctx.cashier, ctx.session, { lines: [{ productId: ctx.fer.id, quantity: 2, unitPrice: 3600 }], payments: [{ method: "CASH", amount: 7200 }] });
  assert.equal(s.status, 201);
  assert.equal(s.json.data.deliveryStatus, "DELIVERED");
  assert.equal(Number(s.json.data.lines[0].deliveredQuantity), 2);
});

test("journal d'audit intègre (devis, retraits)", async () => {
  const events = await prisma.auditLog.groupBy({ by: ["eventType"], where: { companyId: ctx.companyId }, _count: true });
  const count = Object.fromEntries(events.map((e) => [e.eventType, e._count]));
  assert.equal(count.QUOTE_CREATED, 4);
  assert.equal(count.QUOTE_CANCELLED, 1);
  assert.equal(count.GOODS_DELIVERED, 2);
  assert.equal((await verifyAuditChain(ctx.companyId)).isValid, true);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Scénarios hors connexion (cahier §9.4, §11, §26.3) :
 * réserves par caisse, synchronisation des ventes hors ligne, libération à la
 * clôture, remboursement imputé à la bonne caisse.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";

const salesRoute = await import("@/app/api/sales/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const reservationsRoute = await import("@/app/api/stock/reservations/route");
const { verifyAuditChain } = await import("@/lib/audit");

const ctx: Json = {};

before(async () => {
  await resetDb();
  const hash = await passwordHash();
  const company = await prisma.company.create({
    data: { tradeName: "Poissonnerie Offline", ownerName: "O", phone: "0000000000", email: "off@co.test" },
  });
  const center = await prisma.center.create({ data: { companyId: company.id, name: "Centre", code: "C1" } });
  const kg = await prisma.unit.create({ data: { companyId: company.id, name: "Kilogramme", symbol: "kg", isBaseUnit: true } });
  const mk = (email: string, role: any) =>
    prisma.user.create({
      data: { email, passwordHash: hash, firstName: email, lastName: "T", role, companyId: company.id, centers: { create: [{ centerId: center.id }] } },
    });
  const users = {
    c1: await mk("c1@off.test", "CASHIER"),
    c2: await mk("c2@off.test", "CASHIER"),
    c3: await mk("c3@off.test", "CASHIER"),
    manager: await mk("m@off.test", "CENTER_MANAGER"),
  };
  const product = await prisma.product.create({
    data: { companyId: company.id, name: "Capitaine", baseUnitId: kg.id, sellingPrice: 4000 },
  });
  await prisma.stock.create({ data: { centerId: center.id, productId: product.id, quantity: 10 } });
  const registers = await Promise.all(
    ["R1", "R2", "R3"].map((name) => prisma.cashRegister.create({ data: { centerId: center.id, name } }))
  );

  const cookies: Record<string, string> = {};
  for (const [k, u] of Object.entries(users)) cookies[k] = await login(u.email);

  const sessions: string[] = [];
  for (const [i, who] of ["c1", "c2", "c3"].entries()) {
    const r = await call(cashRoute.POST, {
      path: "/api/cash/sessions", cookie: cookies[who],
      body: { action: "open", cashRegisterId: registers[i].id, openingBalance: 0 },
    });
    assert.equal(r.status, 201);
    sessions.push(r.json.data.id);
  }
  Object.assign(ctx, { company, center, product, users, cookies, sessions });
});

after(async () => prisma.$disconnect());

const stockRow = () =>
  prisma.stock.findFirstOrThrow({ where: { centerId: ctx.center.id, productId: ctx.product.id } });

const reserve = (who: string, sessionId: string, quantity: number) =>
  call(reservationsRoute.POST, {
    path: "/api/stock/reservations", cookie: ctx.cookies[who],
    body: { sessionId, items: [{ productId: ctx.product.id, quantity }] },
  });

const sell = (who: string, sessionId: string, quantity: number, extra: Json = {}) =>
  call(salesRoute.POST, {
    path: "/api/sales", cookie: ctx.cookies[who],
    body: {
      sessionId, idempotencyKey: idem(), createdOffline: true,
      lines: [{ productId: ctx.product.id, quantity, unitPrice: 4000 }],
      payments: [{ method: "CASH", amount: quantity * 4000 }],
      ...extra,
    },
  });

test("§9.4 — la somme des réserves ne dépasse jamais le stock réel", async () => {
  const [s1, s2] = ctx.sessions;
  assert.equal((await reserve("c1", s1, 6)).status, 200);
  const tooMuch = await reserve("c2", s2, 6);
  assert.equal(tooMuch.status, 409, "seuls 4 kg restent libres");
  assert.equal((await reserve("c2", s2, 4)).status, 200);

  const stock = await stockRow();
  assert.equal(Number(stock.reservedQty), 10);
});

test("réserves concurrentes : jamais de sur-réservation", async () => {
  // c2 rend 2 kg, puis c1 et c3 tentent chacun d'en prendre 2 en même temps
  assert.equal((await reserve("c2", ctx.sessions[1], 2)).status, 200);
  const [a, b] = await Promise.all([reserve("c1", ctx.sessions[0], 8), reserve("c3", ctx.sessions[2], 2)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const stock = await stockRow();
  assert.equal(Number(stock.reservedQty), 10);
  // remettre l'état attendu : c1 = 6, c2 = 4, c3 = 0
  if (a.status === 200) await reserve("c1", ctx.sessions[0], 6);
  else await reserve("c3", ctx.sessions[2], 0);
  assert.equal((await reserve("c2", ctx.sessions[1], 4)).status, 200);
  assert.equal(Number((await stockRow()).reservedQty), 10);
});

test("une caisse sans réserve ne peut pas vendre un stock réservé par les autres", async () => {
  const r = await sell("c3", ctx.sessions[2], 1, { createdOffline: false });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "INSUFFICIENT_STOCK");
});

test("on ne peut pas réserver sur la session d'un autre caissier", async () => {
  const r = await reserve("c3", ctx.sessions[0], 1);
  assert.equal(r.status, 403);
});

test("§26.3 — ventes hors ligne synchronisées une seule fois, prises sur la réserve", async () => {
  const body = {
    sessionId: ctx.sessions[0], idempotencyKey: idem(), createdOffline: true,
    lines: [{ productId: ctx.product.id, quantity: 5, unitPrice: 4000 }],
    payments: [{ method: "CASH", amount: 20000 }],
  };
  const first = await call(salesRoute.POST, { path: "/api/sales", cookie: ctx.cookies.c1, body });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const again = await call(salesRoute.POST, { path: "/api/sales", cookie: ctx.cookies.c1, body });
  assert.equal(again.status, 200);
  assert.equal(again.json.data.id, first.json.data.id);
  ctx.offlineSale = first.json.data.id;

  const stock = await stockRow();
  assert.equal(Number(stock.quantity), 5);
  assert.equal(Number(stock.reservedQty), 5, "6 − 5 pour c1 + 4 pour c2");
  const res = await prisma.stockReservation.findFirstOrThrow({ where: { sessionId: ctx.sessions[0] } });
  assert.equal(Number(res.quantity), 1);
});

test("vente hors ligne au-delà du stock disponible : acceptée (marchandise partie), écart régularisé et tracé", async () => {
  // Stock 5, réservé 5 (c1 : 1, c2 : 4). c1 vend 2 hors ligne : 1 pris sur sa réserve,
  // 1 au-delà → écart de 1 régularisé, puis sortie de 2 : stock 5 + 1 − 2 = 4.
  const r = await sell("c1", ctx.sessions[0], 2);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const stock = await stockRow();
  assert.equal(Number(stock.quantity), 4);
  assert.equal(Number(stock.reservedQty), 4, "la réserve de c2 n'est pas touchée");
  const adj = await prisma.stockMovement.findFirstOrThrow({ where: { stockId: stock.id, type: "INVENTORY_ADJUST", referenceId: r.json.data.id } });
  assert.equal(Number(adj.quantity), 1);
  assert.match(adj.notes ?? "", /hors connexion/);
});

test("prix modifié pendant la coupure : conflit à arbitrer", async () => {
  const r = await sell("c2", ctx.sessions[1], 1, {
    lines: [{ productId: ctx.product.id, quantity: 1, unitPrice: 3500 }],
    payments: [{ method: "CASH", amount: 3500 }],
  });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "PRICE_MISMATCH");
});

test("la clôture rend au stock libre la réserve non consommée", async () => {
  const close = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: ctx.cookies.c1,
    // 20 000 (5 kg) + 8 000 (2 kg) encaissés en espèces
    body: { action: "close", sessionId: ctx.sessions[0], declaredBalance: 28000 },
  });
  assert.equal(close.status, 200, JSON.stringify(close.json));
  assert.equal(Number(close.json.data.discrepancy), 0);
  const stock = await stockRow();
  assert.equal(Number(stock.reservedQty), 4, "il ne reste que la réserve de c2");
});

test("remboursement imputé à la caisse qui rend l'argent", async () => {
  const req = await call(cancelRoute.POST, {
    path: `/api/sales/${ctx.offlineSale}/cancel`, cookie: ctx.cookies.c1,
    params: { id: ctx.offlineSale }, body: { action: "request", reason: "Client a rapporté le poisson" },
  });
  assert.equal(req.status, 201);
  const ok = await call(cancelRoute.POST, {
    path: `/api/sales/${ctx.offlineSale}/cancel`, cookie: ctx.cookies.manager,
    params: { id: ctx.offlineSale },
    body: { action: "decide", cancellationId: req.json.data.id, decision: "APPROVED", refundSessionId: ctx.sessions[1] },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));

  const refund = await prisma.refund.findFirstOrThrow({ where: { saleId: ctx.offlineSale } });
  assert.equal(refund.sessionId, ctx.sessions[1]);

  // La caisse 2 a rendu 20 000 en espèces : son solde théorique en tient compte
  const close = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: ctx.cookies.c2,
    body: { action: "close", sessionId: ctx.sessions[1], declaredBalance: 0 },
  });
  assert.equal(close.status, 200);
  assert.equal(Number(close.json.data.theoreticalBalance), -20000);
  assert.equal(Number(close.json.data.totalRefunds), 20000);

  // Stock : 4 restants + 5 rendus ; plus aucune réserve active
  const stock = await stockRow();
  assert.equal(Number(stock.quantity), 9);
  assert.equal(Number(stock.reservedQty), 0);
});

test("journal d'audit toujours intègre", async () => {
  const check = await verifyAuditChain(ctx.company.id);
  assert.equal(check.isValid, true);
});

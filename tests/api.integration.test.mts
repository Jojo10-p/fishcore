/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests d'intégration des scénarios critiques du cahier des charges (§26).
 *
 * Ils appellent les vraies routes API contre une VRAIE base PostgreSQL.
 * ⚠️ Utiliser une base de TEST dédiée : elle est vidée au début des tests.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/fishcore_test npm test
 *
 * La base doit contenir le schéma (prisma migrate deploy) ET les garde-fous
 * de prisma/sql/integrity-guards.sql.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

const DB_URL = process.env.TEST_DATABASE_URL;
if (!DB_URL) {
  console.error("TEST_DATABASE_URL non défini — tests d'intégration ignorés.");
  process.exit(0);
}
process.env.DATABASE_URL = DB_URL;
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-0123";
process.env.INSTALL_LINK_SECRET ??= "test-install-secret-test-install-secret-01";

// Imports dynamiques : l'environnement doit être prêt avant le chargement de Prisma
const { prisma } = await import("@/lib/prisma");
const { verifyAuditChain } = await import("@/lib/audit");
const loginRoute = await import("@/app/api/auth/login/route");
const salesRoute = await import("@/app/api/sales/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const productsRoute = await import("@/app/api/products/route");
const stockRoute = await import("@/app/api/stock/route");
const usersRoute = await import("@/app/api/users/route");
const productRoute = await import("@/app/api/products/[id]/route");

const BASE = "http://localhost:3000";
const PASSWORD = "Motdepasse1";

type Json = Record<string, any>;

async function call(
  handler: (req: NextRequest, ctx?: any) => Promise<Response>,
  opts: { path: string; method?: string; cookie?: string; body?: unknown; params?: Record<string, string> }
): Promise<{ status: number; json: Json }> {
  const req = new NextRequest(`${BASE}${opts.path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(opts.cookie ? { cookie: `fishcore-session=${opts.cookie}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, opts.params ? { params: Promise.resolve(opts.params) } : undefined);
  return { status: res.status, json: (await res.json()) as Json };
}

async function login(email: string): Promise<string> {
  const req = new NextRequest(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const res = await loginRoute.POST(req);
  assert.equal(res.status, 200, `connexion ${email}`);
  const cookie = (res as any).cookies.get("fishcore-session")?.value;
  assert.ok(cookie);
  return cookie;
}

let key = 0;
const idem = () => `test_${Date.now()}_${key++}`;

// Contexte de test
const ctx: Json = {};

async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // Le journal d'audit est protégé contre DELETE/TRUNCATE : on désactive
  // temporairement le déclencheur uniquement pour vider la base de TEST.
  await prisma.$executeRawUnsafe(`ALTER TABLE "audit_logs" DISABLE TRIGGER USER`);
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
  await prisma.$executeRawUnsafe(`ALTER TABLE "audit_logs" ENABLE TRIGGER USER`);
  const { ensureDefaultPlans } = await import("@/lib/subscription");
  await ensureDefaultPlans();
}

async function seed() {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const mkCompany = (n: string) =>
    prisma.company.create({ data: { tradeName: `Poissonnerie ${n}`, ownerName: `Owner ${n}`, phone: "0000000000", email: `${n}@co.test` } });
  const A = await mkCompany("a");
  const B = await mkCompany("b");

  const A1 = await prisma.center.create({ data: { companyId: A.id, name: "A1", code: "A1" } });
  const A2 = await prisma.center.create({ data: { companyId: A.id, name: "A2", code: "A2" } });
  const B1 = await prisma.center.create({ data: { companyId: B.id, name: "B1", code: "B1" } });

  const kgA = await prisma.unit.create({ data: { companyId: A.id, name: "Kilogramme", symbol: "kg", isBaseUnit: true } });
  const kgB = await prisma.unit.create({ data: { companyId: B.id, name: "Kilogramme", symbol: "kg", isBaseUnit: true } });

  const mkUser = (email: string, role: any, companyId: string, centers: string[]) =>
    prisma.user.create({
      data: {
        email, passwordHash: hash, firstName: email.split("@")[0], lastName: "Test", role, companyId,
        centers: { create: centers.map((centerId) => ({ centerId })) },
      },
    });

  const users = {
    ownerA: await mkUser("owner@a.test", "COMPANY_OWNER", A.id, []),
    managerA1: await mkUser("manager@a.test", "CENTER_MANAGER", A.id, [A1.id]),
    cashier1: await mkUser("cashier1@a.test", "CASHIER", A.id, [A1.id]),
    cashier2: await mkUser("cashier2@a.test", "CASHIER", A.id, [A1.id]),
    cashierA2: await mkUser("cashier-a2@a.test", "CASHIER", A.id, [A2.id]),
    accountant: await mkUser("accountant@a.test", "ACCOUNTANT", A.id, [A1.id]),
    cashierB: await mkUser("cashier@b.test", "CASHIER", B.id, [B1.id]),
  };

  const tilapia = await prisma.product.create({
    data: { companyId: A.id, name: "Tilapia", baseUnitId: kgA.id, sellingPrice: 2500, purchasePrice: 1500 },
  });
  const carpe = await prisma.product.create({
    data: { companyId: A.id, name: "Carpe", baseUnitId: kgA.id, sellingPrice: 3000, purchasePrice: 2000 },
  });
  await prisma.product.create({ data: { companyId: B.id, name: "Produit B", baseUnitId: kgB.id, sellingPrice: 100 } });

  await prisma.stock.create({ data: { centerId: A1.id, productId: tilapia.id, quantity: 1 } }); // dernière unité
  await prisma.stock.create({ data: { centerId: A1.id, productId: carpe.id, quantity: 1000 } });

  const R1 = await prisma.cashRegister.create({ data: { centerId: A1.id, name: "Caisse 1" } });
  const R2 = await prisma.cashRegister.create({ data: { centerId: A1.id, name: "Caisse 2" } });
  const RB = await prisma.cashRegister.create({ data: { centerId: B1.id, name: "Caisse B" } });

  Object.assign(ctx, { A, B, A1, A2, B1, users, tilapia, carpe, R1, R2, RB });
}

before(async () => {
  await resetDb();
  await seed();
  ctx.cookies = {} as Record<string, string>;
  for (const [k, u] of Object.entries(ctx.users as Record<string, { email: string }>)) {
    ctx.cookies[k] = await login(u.email);
  }
});

after(async () => {
  await prisma.$disconnect();
});

const sale = (sessionId: string, productId: string, quantity: number, extra: Json = {}) => ({
  sessionId,
  idempotencyKey: idem(),
  lines: [{ productId, quantity, unitPrice: 0, discount: 0 }],
  payments: [{ method: "CASH", amount: 1_000_000 }],
  ...extra,
});

test("ouverture de caisse : une seule session par caisse, identité issue de la session", async () => {
  const c = ctx.cookies;
  const s1 = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: c.cashier1,
    body: { action: "open", cashRegisterId: ctx.R1.id, openingBalance: 10000, cashierId: ctx.users.cashier2.id },
  });
  assert.equal(s1.status, 201, JSON.stringify(s1.json));
  assert.equal(s1.json.data.cashierId, ctx.users.cashier1.id, "le cashierId du corps est ignoré");
  ctx.session1 = s1.json.data.id;

  const busy = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: c.cashier2,
    body: { action: "open", cashRegisterId: ctx.R1.id, openingBalance: 0 },
  });
  assert.equal(busy.status, 409);

  const s2 = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: c.cashier2,
    body: { action: "open", cashRegisterId: ctx.R2.id, openingBalance: 5000 },
  });
  assert.equal(s2.status, 201);
  ctx.session2 = s2.json.data.id;
});

test("§26.2 — deux caissiers vendent la dernière unité en même temps : une seule vente passe", async () => {
  const c = ctx.cookies;
  const [r1, r2] = await Promise.all([
    call(salesRoute.POST, { path: "/api/sales", cookie: c.cashier1, body: sale(ctx.session1, ctx.tilapia.id, 1) }),
    call(salesRoute.POST, { path: "/api/sales", cookie: c.cashier2, body: sale(ctx.session2, ctx.tilapia.id, 1) }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [201, 409], JSON.stringify([r1.json, r2.json]));

  const stock = await prisma.stock.findFirstOrThrow({ where: { centerId: ctx.A1.id, productId: ctx.tilapia.id } });
  assert.equal(Number(stock.quantity), 0);
  const movements = await prisma.stockMovement.count({ where: { stockId: stock.id, type: "SALE" } });
  assert.equal(movements, 1);
});

test("le prix vient de la base, pas du navigateur ; la monnaie est rendue sur les espèces", async () => {
  const r = await call(salesRoute.POST, {
    path: "/api/sales", cookie: ctx.cookies.cashier1,
    body: {
      sessionId: ctx.session1, idempotencyKey: idem(),
      lines: [{ productId: ctx.carpe.id, quantity: 2, unitPrice: 1 }],
      payments: [{ method: "CASH", amount: 10000 }],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(Number(r.json.data.totalAmount), 6000);
  assert.equal(Number(r.json.data.payments[0].amount), 6000, "paiement net du rendu");
  assert.equal(Number(r.json.data.lines[0].unitPrice), 3000);
  ctx.saleToCancel = r.json.data.id;
});

test("paiement insuffisant refusé", async () => {
  const r = await call(salesRoute.POST, {
    path: "/api/sales", cookie: ctx.cookies.cashier1,
    body: sale(ctx.session1, ctx.carpe.id, 1, { payments: [{ method: "MOBILE_MONEY", amount: 100 }] }),
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "UNDERPAID");
});

test("remise interdite au caissier", async () => {
  const r = await call(salesRoute.POST, {
    path: "/api/sales", cookie: ctx.cookies.cashier1,
    body: sale(ctx.session1, ctx.carpe.id, 1, { lines: [{ productId: ctx.carpe.id, quantity: 1, unitPrice: 3000, discount: 500 }] }),
  });
  assert.equal(r.status, 403);
});

test("§9.3 — la même vente envoyée plusieurs fois n'est enregistrée qu'une fois", async () => {
  const body = sale(ctx.session1, ctx.carpe.id, 1);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => call(salesRoute.POST, { path: "/api/sales", cookie: ctx.cookies.cashier1, body }))
  );
  for (const r of results) assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
  const ids = new Set(results.map((r) => r.json.data.id));
  assert.equal(ids.size, 1);
  assert.equal(await prisma.sale.count({ where: { idempotencyKey: body.idempotencyKey } }), 1);
});

test("numéros de facture uniques sous forte concurrence", async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      call(salesRoute.POST, { path: "/api/sales", cookie: ctx.cookies.cashier2, body: sale(ctx.session2, ctx.carpe.id, 1) })
    )
  );
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.json));
  const numbers = new Set(results.map((r) => r.json.data.saleNumber));
  assert.equal(numbers.size, 10);
});

test("vendre sur la session d'un autre caissier est refusé", async () => {
  const r = await call(salesRoute.POST, {
    path: "/api/sales", cookie: ctx.cookies.cashier2, body: sale(ctx.session1, ctx.carpe.id, 1),
  });
  assert.equal(r.status, 403);
});

test("§26.4 — accès à une autre entreprise refusé et historisé", async () => {
  const before = await prisma.auditLog.count({ where: { eventType: "UNAUTHORIZED_ACCESS_ATTEMPT" } });
  const products = await call(productsRoute.GET, { path: `/api/products?centerId=${ctx.A1.id}`, cookie: ctx.cookies.cashierB });
  assert.equal(products.status, 404);

  const list = await call(productsRoute.GET, { path: `/api/products?companyId=${ctx.A.id}`, cookie: ctx.cookies.cashierB });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.data.map((p: Json) => p.name), ["Produit B"], "le companyId de l'URL est ignoré");

  const sales = await call(salesRoute.GET, { path: "/api/sales", cookie: ctx.cookies.cashierB });
  assert.equal(sales.json.data.length, 0);

  const after = await prisma.auditLog.count({ where: { eventType: "UNAUTHORIZED_ACCESS_ATTEMPT" } });
  assert.ok(after > before);
});

test("un caissier d'un autre centre ne voit pas le stock du centre A1", async () => {
  const r = await call(stockRoute.GET, { path: `/api/stock?centerId=${ctx.A1.id}`, cookie: ctx.cookies.cashierA2 });
  assert.equal(r.status, 403);
});

test("sans cookie : 401", async () => {
  const r = await call(salesRoute.GET, { path: "/api/sales" });
  assert.equal(r.status, 401);
});

test("§26.4 — un caissier ne peut pas approuver une annulation", async () => {
  const req = await call(cancelRoute.POST, {
    path: `/api/sales/${ctx.saleToCancel}/cancel`, cookie: ctx.cookies.cashier1,
    params: { id: ctx.saleToCancel }, body: { action: "request", reason: "Erreur de saisie client" },
  });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  ctx.cancellationId = req.json.data.id;
  assert.equal(req.json.data.requesterId, ctx.users.cashier1.id);

  const dup = await call(cancelRoute.POST, {
    path: `/api/sales/${ctx.saleToCancel}/cancel`, cookie: ctx.cookies.cashier1,
    params: { id: ctx.saleToCancel }, body: { action: "request", reason: "Deuxième demande" },
  });
  assert.equal(dup.status, 409);

  const denied = await call(cancelRoute.POST, {
    path: `/api/sales/${ctx.saleToCancel}/cancel`, cookie: ctx.cookies.cashier2,
    params: { id: ctx.saleToCancel }, body: { action: "decide", cancellationId: ctx.cancellationId, decision: "APPROVED" },
  });
  assert.equal(denied.status, 403);
});

test("§10 — approbation par le gérant : stock restauré, remboursement, vente conservée", async () => {
  const stockBefore = await prisma.stock.findFirstOrThrow({ where: { centerId: ctx.A1.id, productId: ctx.carpe.id } });
  const [a, b] = await Promise.all(
    [0, 1].map(() =>
      call(cancelRoute.POST, {
        path: `/api/sales/${ctx.saleToCancel}/cancel`, cookie: ctx.cookies.managerA1,
        params: { id: ctx.saleToCancel }, body: { action: "decide", cancellationId: ctx.cancellationId, decision: "APPROVED" },
      })
    )
  );
  assert.deepEqual([a.status, b.status].sort(), [200, 409], "une seule approbation possible");

  const saleRow = await prisma.sale.findUniqueOrThrow({ where: { id: ctx.saleToCancel } });
  assert.equal(saleRow.status, "CANCELLED");
  const stockAfter = await prisma.stock.findFirstOrThrow({ where: { id: stockBefore.id } });
  assert.equal(Number(stockAfter.quantity) - Number(stockBefore.quantity), 2);
  const refunds = await prisma.refund.findMany({ where: { saleId: ctx.saleToCancel } });
  assert.equal(refunds.length, 1);
  assert.equal(Number(refunds[0].amount), 6000);
});

test("auto-approbation interdite (le propriétaire demande puis tente d'approuver)", async () => {
  // Le propriétaire ouvre une session et vend
  const open = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: ctx.cookies.ownerA,
    body: { action: "open", cashRegisterId: (await prisma.cashRegister.create({ data: { centerId: ctx.A1.id, name: "Caisse 3" } })).id, openingBalance: 0 },
  });
  assert.equal(open.status, 201);
  const s = await call(salesRoute.POST, { path: "/api/sales", cookie: ctx.cookies.ownerA, body: sale(open.json.data.id, ctx.carpe.id, 1) });
  assert.equal(s.status, 201);
  const r = await call(cancelRoute.POST, {
    path: `/api/sales/${s.json.data.id}/cancel`, cookie: ctx.cookies.ownerA,
    params: { id: s.json.data.id }, body: { action: "request", reason: "Test auto-approbation" },
  });
  const d = await call(cancelRoute.POST, {
    path: `/api/sales/${s.json.data.id}/cancel`, cookie: ctx.cookies.ownerA,
    params: { id: s.json.data.id }, body: { action: "decide", cancellationId: r.json.data.id, decision: "APPROVED" },
  });
  assert.equal(d.status, 403);
  assert.equal(d.json.code, "SELF_APPROVAL");
});

test("§26.4 — un comptable ne peut pas clôturer une caisse", async () => {
  const r = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: ctx.cookies.accountant,
    body: { action: "close", sessionId: ctx.session1, declaredBalance: 0 },
  });
  assert.equal(r.status, 403);
});

test("§26.5 — clôture : solde théorique, écart, puis validation par une autre personne", async () => {
  // Session 1 : fond 10 000 + ventes espèces − remboursement 6 000
  const cashPaid = await prisma.payment.aggregate({
    where: { sale: { sessionId: ctx.session1 }, method: "CASH" }, _sum: { amount: true },
  });
  const expected = 10000 + Number(cashPaid._sum.amount ?? 0) - 6000;

  const close = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: ctx.cookies.cashier1,
    body: { action: "close", sessionId: ctx.session1, declaredBalance: expected - 500 },
  });
  assert.equal(close.status, 200, JSON.stringify(close.json));
  assert.equal(Number(close.json.data.theoreticalBalance), expected);
  assert.equal(Number(close.json.data.discrepancy), -500);

  // Plus aucune vente possible sur une session clôturée
  const late = await call(salesRoute.POST, { path: "/api/sales", cookie: ctx.cookies.cashier1, body: sale(ctx.session1, ctx.carpe.id, 1) });
  assert.equal(late.status, 409);
  assert.equal(late.json.code, "SESSION_CLOSED");

  const self = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: ctx.cookies.cashier1, body: { action: "validate", sessionId: ctx.session1 },
  });
  assert.equal(self.status, 403);

  const ok = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: ctx.cookies.managerA1, body: { action: "validate", sessionId: ctx.session1 },
  });
  assert.equal(ok.status, 200);
});

test("ajustement de stock : jamais négatif, motif obligatoire", async () => {
  const noReason = await call(stockRoute.POST, {
    path: "/api/stock", cookie: ctx.cookies.managerA1,
    body: { centerId: ctx.A1.id, productId: ctx.tilapia.id, type: "LOSS", quantity: 1, reason: "" },
  });
  assert.equal(noReason.status, 400);

  const negative = await call(stockRoute.POST, {
    path: "/api/stock", cookie: ctx.cookies.managerA1,
    body: { centerId: ctx.A1.id, productId: ctx.tilapia.id, type: "LOSS", quantity: 5, reason: "Poisson avarié" },
  });
  assert.equal(negative.status, 409);

  const cashier = await call(stockRoute.POST, {
    path: "/api/stock", cookie: ctx.cookies.cashier1,
    body: { centerId: ctx.A1.id, productId: ctx.carpe.id, type: "CORRECTION", quantity: 10, reason: "Test" },
  });
  assert.equal(cashier.status, 403);
});

test("un gérant ne peut pas créer de compte (pas de droit user:create)", async () => {
  const r = await call(usersRoute.POST, {
    path: "/api/users", cookie: ctx.cookies.managerA1,
    body: { firstName: "X", lastName: "Y", email: "x@a.test", role: "COMPANY_OWNER", centerIds: [ctx.A1.id], password: "Motdepasse1" },
  });
  assert.equal(r.status, 403);
});

test("§17 — journal d'audit : chaîne intègre et non modifiable", async () => {
  const check = await verifyAuditChain(ctx.A.id);
  assert.equal(check.isValid, true, `chaîne cassée à ${check.corruptedAt}`);
  assert.ok(check.totalChecked > 10);

  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "audit_logs" SET "reason" = 'falsifié'`));
  await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM "audit_logs"`));

  // Toute ligne de vente a sa trace d'audit dans la même transaction
  const sales = await prisma.sale.count({ where: { companyId: ctx.A.id } });
  const saleLogs = await prisma.auditLog.count({ where: { companyId: ctx.A.id, eventType: "SALE_CREATED" } });
  assert.equal(saleLogs, sales);
});

test("changement de prix : historisé, journalisé, refusé au caissier", async () => {
  const denied = await call(productRoute.PATCH, {
    path: `/api/products/${ctx.carpe.id}`, method: "PATCH", cookie: ctx.cookies.cashier1,
    params: { id: ctx.carpe.id }, body: { sellingPrice: 1 },
  });
  assert.equal(denied.status, 403);

  const ok = await call(productRoute.PATCH, {
    path: `/api/products/${ctx.carpe.id}`, method: "PATCH", cookie: ctx.cookies.managerA1,
    params: { id: ctx.carpe.id }, body: { sellingPrice: 3200 },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(await prisma.productPriceHistory.count({ where: { productId: ctx.carpe.id } }), 1);
  const log = await prisma.auditLog.findFirstOrThrow({ where: { eventType: "PRICE_CHANGED", referenceId: ctx.carpe.id } });
  assert.deepEqual(log.oldValues, { sellingPrice: "3000", purchasePrice: "2000" });

  const otherCompany = await call(productRoute.PATCH, {
    path: `/api/products/${ctx.carpe.id}`, method: "PATCH", cookie: ctx.cookies.cashierB,
    params: { id: ctx.carpe.id }, body: { sellingPrice: 1 },
  });
  assert.equal(otherCompany.status, 403, "un caissier n'a pas le droit product:edit");
});


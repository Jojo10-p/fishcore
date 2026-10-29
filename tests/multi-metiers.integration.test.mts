/**
 * Le même logiciel pour plusieurs métiers : pharmacie (lots, péremption, FEFO),
 * quincaillerie (conditionnements, quantités entières, code-barres),
 * supermarché (TVA incluse), réglages par métier.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const productsRoute = await import("@/app/api/products/route");
const unitsRoute = await import("@/app/api/units/route");
const categoriesRoute = await import("@/app/api/categories/route");
const companyRoute = await import("@/app/api/company/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const stockRoute = await import("@/app/api/stock/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const { verifyAuditChain } = await import("@/lib/audit");

const day = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);

interface Shop {
  cookie: string;
  companyId: string;
  centerId: string;
  sessionId: string;
  units: Record<string, string>; // symbole → id
}

async function openShop(email: string, businessType: string): Promise<Shop> {
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: `Boutique ${businessType}`, ownerName: "Patron Test", phone: "97000000", email, password: "Motdepasse1", businessType },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const cookie = await login(email);
  const center = await call(centersRoute.POST, { path: "/api/centers", cookie, body: { name: "Siège", code: "SIEGE" } });
  assert.equal(center.status, 201);
  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: center.json.data.id } });
  const session = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie, body: { action: "open", cashRegisterId: register.id, openingBalance: 0 },
  });
  assert.equal(session.status, 201);
  const units = await call(unitsRoute.GET, { path: "/api/units", cookie });
  return {
    cookie,
    companyId: reg.json.data.companyId,
    centerId: center.json.data.id,
    sessionId: session.json.data.id,
    units: Object.fromEntries(units.json.data.map((u: Json) => [u.symbol, u.id])),
  };
}

async function receive(shop: Shop, lines: Json[]) {
  const r = await call(receiptsRoute.POST, { path: "/api/goods-receipts", cookie: shop.cookie, body: { centerId: shop.centerId, lines } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return call(validateRoute.POST, { path: `/api/goods-receipts/${r.json.data.id}/validate`, cookie: shop.cookie, params: { id: r.json.data.id }, body: {} });
}

function sell(shop: Shop, lines: Json[], payments: Json[] = [{ method: "CASH", amount: 10_000_000 }], extra: Json = {}) {
  return call(salesRoute.POST, {
    path: "/api/sales", cookie: shop.cookie,
    body: { sessionId: shop.sessionId, idempotencyKey: idem(), lines, payments, ...extra },
  });
}

const ctx: Json = {};

before(async () => {
  await resetDb();
  ctx.pharma = await openShop("pharma@test.bj", "PHARMACY");
  ctx.quinca = await openShop("quinca@test.bj", "HARDWARE");
  ctx.super = await openShop("super@test.bj", "SUPERMARKET");
});
after(async () => prisma.$disconnect());

// ── Réglages par métier ─────────────────────
test("chaque métier reçoit ses unités et catégories", async () => {
  assert.ok(ctx.pharma.units["boîte"] && ctx.pharma.units["cp"], "unités de pharmacie");
  assert.ok(ctx.quinca.units["pce"] && ctx.quinca.units["m"], "unités de quincaillerie");
  const cats = await call(categoriesRoute.GET, { path: "/api/categories", cookie: ctx.pharma.cookie });
  assert.ok(cats.json.data.some((c: Json) => c.name === "Médicaments"));
  const quincaCats = await call(categoriesRoute.GET, { path: "/api/categories", cookie: ctx.quinca.cookie });
  assert.ok(!quincaCats.json.data.some((c: Json) => c.name === "Médicaments"), "catégories propres à chaque entreprise");

  const company = await call(companyRoute.GET, { path: "/api/company", cookie: ctx.super.cookie });
  assert.equal(company.json.data.vatEnabled, true);
  assert.equal(Number(company.json.data.defaultTaxRate), 18);
});

// ── Pharmacie ───────────────────────────────
test("pharmacie : suivi par lot et péremption obligatoires par défaut", async () => {
  const p = await call(productsRoute.POST, {
    path: "/api/products", cookie: ctx.pharma.cookie,
    body: {
      name: "Paracétamol 500 mg", baseUnitId: ctx.pharma.units["boîte"], purchasePrice: 400, sellingPrice: 600, stockAlertQty: 5,
      barcode: "3400930000001", attributes: { DCI: "Paracétamol", Dosage: "500 mg", Forme: "Comprimé" },
    },
  });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  assert.equal(p.json.data.trackBatches, true);
  assert.equal(p.json.data.requiresExpiry, true);
  assert.equal(p.json.data.attributes.Dosage, "500 mg");
  ctx.para = p.json.data;
});

test("pharmacie : réception refusée sans date de péremption", async () => {
  const v = await receive(ctx.pharma, [{ productId: ctx.para.id, quantity: 10, unitPrice: 400, totalPrice: 4000 }]);
  assert.equal(v.status, 400);
  assert.equal(v.json.code, "EXPIRY_REQUIRED");
});

test("pharmacie : vente FEFO, lots périmés jamais vendus", async () => {
  const ok = await receive(ctx.pharma, [
    { productId: ctx.para.id, quantity: 10, unitPrice: 400, totalPrice: 4000, lotNumber: "LOT-A", expiresAt: day(60) },
    { productId: ctx.para.id, quantity: 10, unitPrice: 400, totalPrice: 4000, lotNumber: "LOT-B", expiresAt: day(400) },
  ]);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));

  // Un lot plus ancien a dépassé sa date entre-temps (simulation du vieillissement)
  const stock = await prisma.stock.findFirstOrThrow({ where: { centerId: ctx.pharma.centerId, productId: ctx.para.id } });
  const expired = await prisma.batch.create({
    data: { productId: ctx.para.id, centerId: ctx.pharma.centerId, lotNumber: "LOT-OLD", expiresAt: new Date(day(-2)), initialQty: 5, remainingQty: 5 },
  });
  await prisma.stock.update({ where: { id: stock.id }, data: { quantity: { increment: 5 } } });
  ctx.expiredBatch = expired.id;

  const s = await sell(ctx.pharma, [{ productId: ctx.para.id, quantity: 12, unitPrice: 600 }]);
  assert.equal(s.status, 201, JSON.stringify(s.json));
  ctx.pharmaSale = s.json.data.id;

  const lots = await prisma.batch.findMany({ where: { productId: ctx.para.id }, orderBy: { lotNumber: "asc" } });
  const byLot = Object.fromEntries(lots.map((b) => [b.lotNumber, Number(b.remainingQty)]));
  assert.deepEqual(byLot, { "LOT-A": 0, "LOT-B": 8, "LOT-OLD": 5 }, "le lot qui périme le plus tôt part en premier ; le périmé reste");

  const movements = await prisma.stockMovement.findMany({ where: { referenceId: s.json.data.id, type: "SALE" } });
  assert.equal(movements.length, 2, "un mouvement par lot vendu (traçabilité)");

  // Il reste 13 boîtes en stock, mais seulement 8 non périmées
  const refused = await sell(ctx.pharma, [{ productId: ctx.para.id, quantity: 9, unitPrice: 600 }]);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, "EXPIRED_STOCK");
});

test("pharmacie : retrait du lot périmé (lot obligatoire)", async () => {
  const noLot = await call(stockRoute.POST, {
    path: "/api/stock", cookie: ctx.pharma.cookie,
    body: { centerId: ctx.pharma.centerId, productId: ctx.para.id, type: "DETERIORATION", quantity: 5, reason: "Lot périmé" },
  });
  assert.equal(noLot.status, 400);
  assert.equal(noLot.json.code, "BATCH_REQUIRED");

  const ok = await call(stockRoute.POST, {
    path: "/api/stock", cookie: ctx.pharma.cookie,
    body: { centerId: ctx.pharma.centerId, productId: ctx.para.id, type: "DETERIORATION", quantity: 5, reason: "Lot périmé détruit", batchId: ctx.expiredBatch },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: ctx.expiredBatch } });
  assert.equal(Number(batch.remainingQty), 0);

  const list = await call(stockRoute.GET, { path: `/api/stock?centerId=${ctx.pharma.centerId}`, cookie: ctx.pharma.cookie });
  const row = list.json.data.find((r: Json) => r.productId === ctx.para.id);
  assert.equal(Number(row.quantity), 8);
  assert.deepEqual(row.product.batches.map((b: Json) => b.lotNumber), ["LOT-B"]);
});

test("pharmacie : l'annulation remet les boîtes dans leurs lots d'origine", async () => {
  const pharmacist = await prisma.user.create({
    data: {
      email: "adjoint@pharma.bj", passwordHash: (await prisma.user.findFirstOrThrow({ where: { email: "pharma@test.bj" } })).passwordHash,
      firstName: "Adjoint", lastName: "T", role: "CENTER_MANAGER", companyId: ctx.pharma.companyId,
      centers: { create: [{ centerId: ctx.pharma.centerId }] },
    },
  });
  const managerCookie = await login(pharmacist.email);
  const req = await call(cancelRoute.POST, {
    path: `/api/sales/${ctx.pharmaSale}/cancel`, cookie: ctx.pharma.cookie, params: { id: ctx.pharmaSale },
    body: { action: "request", reason: "Erreur de délivrance" },
  });
  const ok = await call(cancelRoute.POST, {
    path: `/api/sales/${ctx.pharmaSale}/cancel`, cookie: managerCookie, params: { id: ctx.pharmaSale },
    body: { action: "decide", cancellationId: req.json.data.id, decision: "APPROVED" },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const lots = await prisma.batch.findMany({ where: { productId: ctx.para.id, lotNumber: { in: ["LOT-A", "LOT-B"] } }, orderBy: { lotNumber: "asc" } });
  assert.deepEqual(lots.map((b) => Number(b.remainingQty)), [10, 10]);
});

// ── Quincaillerie ───────────────────────────
test("quincaillerie : vente à la pièce ou à la boîte (prix propre), quantités entières", async () => {
  const p = await call(productsRoute.POST, {
    path: "/api/products", cookie: ctx.quinca.cookie,
    body: {
      name: "Vis à bois 6 mm", baseUnitId: ctx.quinca.units["pce"], purchasePrice: 15, sellingPrice: 25, stockAlertQty: 100,
      attributes: { Dimension: "6 × 40 mm" },
      packagings: [{ unitId: ctx.quinca.units["boîte"], factor: 100, sellingPrice: 2000, barcode: "BOX-VIS-6" }],
    },
  });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  assert.equal(p.json.data.trackBatches, false);
  ctx.vis = p.json.data;

  const dup = await call(productsRoute.POST, {
    path: "/api/products", cookie: ctx.quinca.cookie,
    body: { name: "Autre", baseUnitId: ctx.quinca.units["pce"], purchasePrice: 1, sellingPrice: 2, stockAlertQty: 0, barcode: "BOX-VIS-6" },
  });
  assert.equal(dup.status, 409, "un code-barres de conditionnement ne peut pas être réutilisé");

  assert.equal((await receive(ctx.quinca, [{ productId: ctx.vis.id, quantity: 1000, unitPrice: 15, totalPrice: 15000 }])).status, 200);

  const box = await sell(ctx.quinca, [{ productId: ctx.vis.id, quantity: 2, unitId: ctx.quinca.units["boîte"], unitPrice: 0 }]);
  assert.equal(box.status, 201, JSON.stringify(box.json));
  assert.equal(Number(box.json.data.totalAmount), 4000, "2 boîtes au prix du carton, pas 200 × 25");
  assert.equal(Number(box.json.data.lines[0].baseQuantity), 200);

  const pieces = await sell(ctx.quinca, [{ productId: ctx.vis.id, quantity: 30, unitPrice: 25 }]);
  assert.equal(Number(pieces.json.data.totalAmount), 750);

  const stock = await prisma.stock.findFirstOrThrow({ where: { productId: ctx.vis.id } });
  assert.equal(Number(stock.quantity), 770);

  const half = await sell(ctx.quinca, [{ productId: ctx.vis.id, quantity: 1.5, unitPrice: 25 }]);
  assert.equal(half.status, 400);
  assert.equal(half.json.code, "INTEGER_QUANTITY");

  const scan = await call(productsRoute.GET, { path: "/api/products?barcode=BOX-VIS-6", cookie: ctx.quinca.cookie });
  assert.equal(scan.json.data.length, 1);
  assert.equal(scan.json.offlineData[0].packagings[0].sellingPrice, 2000);
});

test("quincaillerie : vente au mètre (quantité décimale)", async () => {
  const p = await call(productsRoute.POST, {
    path: "/api/products", cookie: ctx.quinca.cookie,
    body: { name: "Câble électrique 2,5 mm²", baseUnitId: ctx.quinca.units["m"], purchasePrice: 300, sellingPrice: 450, stockAlertQty: 20 },
  });
  assert.equal((await receive(ctx.quinca, [{ productId: p.json.data.id, quantity: 100, unitPrice: 300, totalPrice: 30000 }])).status, 200);
  const s = await sell(ctx.quinca, [{ productId: p.json.data.id, quantity: 2.5, unitPrice: 450 }]);
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal(Number(s.json.data.totalAmount), 1125);
});

// ── Supermarché ─────────────────────────────
test("supermarché : TVA 18 % incluse dans le prix, extraite sur la vente", async () => {
  const p = await call(productsRoute.POST, {
    path: "/api/products", cookie: ctx.super.cookie,
    body: { name: "Lait concentré 397 g", baseUnitId: ctx.super.units["pce"], purchasePrice: 800, sellingPrice: 1180, stockAlertQty: 24, barcode: "6111234567890" },
  });
  assert.equal(Number(p.json.data.taxRate), 18);
  assert.equal((await receive(ctx.super, [{ productId: p.json.data.id, quantity: 48, unitPrice: 800, totalPrice: 38400 }])).status, 200);

  const s = await sell(ctx.super, [{ productId: p.json.data.id, quantity: 2, unitPrice: 1180 }]);
  assert.equal(s.status, 201);
  assert.equal(Number(s.json.data.totalAmount), 2360);
  assert.equal(Number(s.json.data.taxAmount), 360);
  assert.equal(Number(s.json.data.lines[0].taxAmount), 360);
  ctx.lait = p.json.data;
});

test("vente à crédit : client obligatoire", async () => {
  const s = await sell(ctx.super, [{ productId: ctx.lait.id, quantity: 1, unitPrice: 1180 }], [{ method: "CREDIT", amount: 1180 }]);
  assert.equal(s.status, 400);
  assert.equal(s.json.code, "CUSTOMER_REQUIRED");
});

test("changement de métier : seul le propriétaire, les unités s'ajoutent sans rien supprimer", async () => {
  const before = Object.keys(ctx.quinca.units).length;
  const r = await call(companyRoute.PATCH, {
    path: "/api/company", method: "PATCH", cookie: ctx.quinca.cookie, body: { businessType: "BUILDING_MATERIALS" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const units = await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.quinca.cookie });
  const symbols = units.json.data.map((u: Json) => u.symbol);
  assert.ok(symbols.includes("m³") && symbols.includes("sac") && symbols.includes("pce"));
  assert.ok(symbols.length > before);
});

test("journaux d'audit intègres pour les trois entreprises", async () => {
  for (const shop of [ctx.pharma, ctx.quinca, ctx.super]) {
    const check = await verifyAuditChain(shop.companyId);
    assert.equal(check.isValid, true);
  }
});

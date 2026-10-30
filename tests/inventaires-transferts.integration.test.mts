/**
 * Inventaire physique et transferts entre centres.
 * Scénario : poissonnerie avec un dépôt (chambre froide) et un magasin de détail.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const productsRoute = await import("@/app/api/products/route");
const unitsRoute = await import("@/app/api/units/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateReceipt = await import("@/app/api/goods-receipts/[id]/validate/route");
const stockRoute = await import("@/app/api/stock/route");
const inventoriesRoute = await import("@/app/api/inventories/route");
const inventoryRoute = await import("@/app/api/inventories/[id]/route");
const inventoryValidate = await import("@/app/api/inventories/[id]/validate/route");
const inventoryCancel = await import("@/app/api/inventories/[id]/cancel/route");
const transfersRoute = await import("@/app/api/transfers/route");
const transferRoute = await import("@/app/api/transfers/[id]/route");
const transferReceive = await import("@/app/api/transfers/[id]/receive/route");
const transferCancel = await import("@/app/api/transfers/[id]/cancel/route");
const { verifyAuditChain } = await import("@/lib/audit");

const ctx: Json = {};
const qty = async (centerId: string, productId: string) =>
  Number((await prisma.stock.findUnique({ where: { centerId_productId: { centerId, productId } } }))?.quantity ?? 0);

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Ets Ray-Espoir", ownerName: "Patron", phone: "97000000", email: "owner@ray.bj", password: "Motdepasse1", businessType: "FISHMONGER" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.companyId = reg.json.data.companyId;
  ctx.owner = await login("owner@ray.bj");
  ctx.depot = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Dépôt froid", code: "DEP" } })).json.data.id;
  ctx.shop = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Magasin détail", code: "DET" } })).json.data.id;

  const hash = await passwordHash();
  const mkUser = async (key: string, role: "CASHIER" | "CENTER_MANAGER", centerId: string) => {
    const u = await prisma.user.create({
      data: { email: `${key}@ray.bj`, passwordHash: hash, firstName: key, lastName: "T", role, companyId: ctx.companyId, centers: { create: [{ centerId }] } },
    });
    return login(u.email);
  };
  ctx.cashier = await mkUser("caissier", "CASHIER", ctx.depot);
  ctx.shopManager = await mkUser("gerant", "CENTER_MANAGER", ctx.shop);

  const units = await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner });
  const U = Object.fromEntries(units.json.data.map((u: Json) => [u.symbol, u.id]));
  const mk = async (body: Json) => {
    const r = await call(productsRoute.POST, { path: "/api/products", cookie: ctx.owner, body: { purchasePrice: 0, stockAlertQty: 0, ...body } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.data;
  };
  ctx.saucisse = await mk({ name: "SAUCISSE", baseUnitId: U["carton"], sellingPrice: 800 });
  ctx.chinchard = await mk({ name: "CHINCHARD 25+", baseUnitId: U["carton"], sellingPrice: 1500 });
  ctx.glace = await mk({ name: "GLACE (pain)", baseUnitId: U["pce"] ?? U["unité"] ?? Object.values(U)[0], sellingPrice: 300 });
  ctx.crevette = await mk({ name: "CREVETTE", baseUnitId: U["carton"], sellingPrice: 9000, trackBatches: true, requiresExpiry: true });
  ctx.pieceUnitAllowsDecimal = units.json.data.find((u: Json) => u.id === ctx.glace.baseUnitId)?.allowsDecimal;

  const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const in90 = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const r = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie: ctx.owner,
    body: {
      centerId: ctx.depot,
      lines: [
        { productId: ctx.saucisse.id, quantity: 100, unitPrice: 650, totalPrice: 65000 },
        { productId: ctx.chinchard.id, quantity: 10, unitPrice: 1200, totalPrice: 12000 },
        { productId: ctx.glace.id, quantity: 40, unitPrice: 200, totalPrice: 8000 },
        { productId: ctx.crevette.id, quantity: 6, unitPrice: 7000, totalPrice: 42000, lotNumber: "LOT-A", expiresAt: in30 },
        { productId: ctx.crevette.id, quantity: 4, unitPrice: 7500, totalPrice: 30000, lotNumber: "LOT-B", expiresAt: in90 },
      ],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const v = await call(validateReceipt.POST, { path: `/api/goods-receipts/${r.json.data.id}/validate`, cookie: ctx.owner, params: { id: r.json.data.id }, body: {} });
  assert.equal(v.status, 200, JSON.stringify(v.json));
});

after(async () => {
  await prisma.$disconnect();
});

// ── Inventaire ──────────────────────────────────────────────────────────

test("inventaire : ouverture, un seul en cours par centre, droits", async () => {
  const denied = await call(inventoriesRoute.POST, { path: "/api/inventories", cookie: ctx.cashier, body: { centerId: ctx.depot } });
  assert.equal(denied.status, 403);

  const r = await call(inventoriesRoute.POST, { path: "/api/inventories", cookie: ctx.owner, body: { centerId: ctx.depot, label: "Inventaire de fin de mois" } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.number, "INV-000001");
  ctx.inv = r.json.data.id;

  const again = await call(inventoriesRoute.POST, { path: "/api/inventories", cookie: ctx.owner, body: { centerId: ctx.depot } });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "INVENTORY_IN_PROGRESS");

  const detail = await call(inventoryRoute.GET, { path: `/api/inventories/${ctx.inv}`, cookie: ctx.owner, params: { id: ctx.inv } });
  assert.equal(detail.status, 200);
  const line = detail.json.data.lines.find((l: Json) => l.productId === ctx.saucisse.id);
  assert.equal(Number(line.theoreticalQty), 100);
  assert.equal(line.countedQty, null);
  assert.equal(detail.json.data.summary.lineCount, 4);
  assert.equal(detail.json.data.summary.countedCount, 0);
});

test("inventaire : saisie des comptages (écarts, entiers, article ajouté)", async () => {
  const bad = await call(inventoryRoute.PATCH, {
    path: `/api/inventories/${ctx.inv}`,
    cookie: ctx.owner,
    params: { id: ctx.inv },
    body: { lines: [{ productId: ctx.saucisse.id, countedQty: -1 }] },
  });
  assert.equal(bad.status, 400);

  if (ctx.pieceUnitAllowsDecimal === false) {
    const frac = await call(inventoryRoute.PATCH, {
      path: `/api/inventories/${ctx.inv}`,
      cookie: ctx.owner,
      params: { id: ctx.inv },
      body: { lines: [{ productId: ctx.glace.id, countedQty: 2.5 }] },
    });
    assert.equal(frac.status, 400);
    assert.equal(frac.json.code, "INTEGER_QUANTITY");
  }

  const r = await call(inventoryRoute.PATCH, {
    path: `/api/inventories/${ctx.inv}`,
    cookie: ctx.owner,
    params: { id: ctx.inv },
    body: {
      lines: [
        { productId: ctx.saucisse.id, countedQty: 95, reason: "Cartons abîmés" },
        { productId: ctx.chinchard.id, countedQty: 12 },
        { productId: ctx.crevette.id, countedQty: 7 },
      ],
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = r.json.data.lines.find((l: Json) => l.productId === ctx.saucisse.id);
  assert.equal(Number(s.discrepancy), -5);
  assert.equal(r.json.data.summary.countedCount, 3);
  // Valorisation au CMP : −5 × 650 + 2 × 1 200 + (−3 × CMP crevette)
  assert.equal(Number(r.json.data.summary.shortageValue) < 0, true);
  assert.equal(Number(r.json.data.summary.surplusValue), 2400);
});

test("inventaire : validation — écart appliqué au stock courant, sans compter deux fois", async () => {
  // Après le comptage, 3 cartons de saucisse partent en perte : ils ne doivent pas être recomptés
  const loss = await call(stockRoute.POST, {
    path: "/api/stock",
    cookie: ctx.owner,
    body: { centerId: ctx.depot, productId: ctx.saucisse.id, type: "LOSS", quantity: 3, reason: "Rupture de froid" },
  });
  assert.equal(loss.status, 200, JSON.stringify(loss.json));

  const denied = await call(inventoryValidate.POST, { path: `/api/inventories/${ctx.inv}/validate`, cookie: ctx.cashier, params: { id: ctx.inv }, body: {} });
  assert.equal(denied.status, 403);

  const r = await call(inventoryValidate.POST, { path: `/api/inventories/${ctx.inv}/validate`, cookie: ctx.owner, params: { id: ctx.inv }, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.adjusted, 3);

  assert.equal(await qty(ctx.depot, ctx.saucisse.id), 92); // 100 − 3 (perte) − 5 (écart)
  assert.equal(await qty(ctx.depot, ctx.chinchard.id), 12);
  assert.equal(await qty(ctx.depot, ctx.glace.id), 40); // non compté : laissé tel quel
  assert.equal(await qty(ctx.depot, ctx.crevette.id), 7);

  // Crevette : les 3 manquants sortent du lot le plus proche de la péremption ; les lots suivent le stock
  const lots = await prisma.batch.findMany({ where: { productId: ctx.crevette.id, centerId: ctx.depot }, orderBy: { lotNumber: "asc" } });
  assert.deepEqual(lots.map((b) => [b.lotNumber, Number(b.remainingQty)]), [["LOT-A", 3], ["LOT-B", 4]]);

  const moves = await prisma.stockMovement.findMany({ where: { referenceType: "Inventory", referenceId: ctx.inv } });
  assert.equal(moves.every((m) => m.type === "INVENTORY_ADJUST"), true);
  assert.equal(moves.reduce((s, m) => s + Number(m.quantity), 0), -5 + 2 - 3);

  const edit = await call(inventoryRoute.PATCH, {
    path: `/api/inventories/${ctx.inv}`,
    cookie: ctx.owner,
    params: { id: ctx.inv },
    body: { lines: [{ productId: ctx.glace.id, countedQty: 1 }] },
  });
  assert.equal(edit.status, 409);
  const twice = await call(inventoryValidate.POST, { path: `/api/inventories/${ctx.inv}/validate`, cookie: ctx.owner, params: { id: ctx.inv }, body: {} });
  assert.equal(twice.status, 409);
});

test("inventaire : « mettre à zéro » les non comptés, annulation sans effet", async () => {
  const a = await call(inventoriesRoute.POST, { path: "/api/inventories", cookie: ctx.owner, body: { centerId: ctx.depot } });
  assert.equal(a.status, 201);
  const cancel = await call(inventoryCancel.POST, { path: `/api/inventories/${a.json.data.id}/cancel`, cookie: ctx.owner, params: { id: a.json.data.id }, body: { reason: "Erreur de périmètre" } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  assert.equal(cancel.json.data.status, "CANCELLED");
  assert.equal(await qty(ctx.depot, ctx.glace.id), 40);

  const b = await call(inventoriesRoute.POST, { path: "/api/inventories", cookie: ctx.owner, body: { centerId: ctx.depot } });
  assert.equal(b.status, 201);
  assert.equal(b.json.data.number, "INV-000003");
  await call(inventoryRoute.PATCH, { path: `/api/inventories/${b.json.data.id}`, cookie: ctx.owner, params: { id: b.json.data.id }, body: { lines: [{ productId: ctx.saucisse.id, countedQty: 92 }, { productId: ctx.crevette.id, countedQty: 7 }] } });
  const v = await call(inventoryValidate.POST, { path: `/api/inventories/${b.json.data.id}/validate`, cookie: ctx.owner, params: { id: b.json.data.id }, body: { uncounted: "zero" } });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(await qty(ctx.depot, ctx.glace.id), 0);
  assert.equal(await qty(ctx.depot, ctx.saucisse.id), 92);
  assert.equal(await qty(ctx.depot, ctx.chinchard.id), 0);

  // Remise en stock pour la suite
  for (const [p, q] of [[ctx.chinchard.id, 12], [ctx.glace.id, 40]] as const) {
    await call(stockRoute.POST, { path: "/api/stock", cookie: ctx.owner, body: { centerId: ctx.depot, productId: p, type: "CORRECTION", quantity: q, reason: "Remise en stock test" } });
  }
});

// ── Transferts ──────────────────────────────────────────────────────────

test("transfert : expédition — le stock quitte l'origine tout de suite", async () => {
  const same = await call(transfersRoute.POST, {
    path: "/api/transfers",
    cookie: ctx.owner,
    body: { fromCenterId: ctx.depot, toCenterId: ctx.depot, lines: [{ productId: ctx.saucisse.id, quantity: 1 }] },
  });
  assert.equal(same.status, 400);

  const tooMuch = await call(transfersRoute.POST, {
    path: "/api/transfers",
    cookie: ctx.owner,
    body: { fromCenterId: ctx.depot, toCenterId: ctx.shop, lines: [{ productId: ctx.saucisse.id, quantity: 20 }, { productId: ctx.chinchard.id, quantity: 500 }] },
  });
  assert.equal(tooMuch.status, 409);
  assert.equal(await qty(ctx.depot, ctx.saucisse.id), 92); // tout ou rien

  const r = await call(transfersRoute.POST, {
    path: "/api/transfers",
    cookie: ctx.owner,
    body: {
      fromCenterId: ctx.depot,
      toCenterId: ctx.shop,
      notes: "Réassort samedi",
      lines: [
        { productId: ctx.saucisse.id, quantity: 20 },
        { productId: ctx.crevette.id, quantity: 4 },
      ],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.number, "TR-000001");
  assert.equal(r.json.data.status, "IN_TRANSIT");
  ctx.tr = r.json.data.id;
  assert.equal(await qty(ctx.depot, ctx.saucisse.id), 72);
  assert.equal(await qty(ctx.shop, ctx.saucisse.id), 0);
  assert.equal(await qty(ctx.depot, ctx.crevette.id), 3);

  const detail = await call(transferRoute.GET, { path: `/api/transfers/${ctx.tr}`, cookie: ctx.shopManager, params: { id: ctx.tr } });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.canReceive, true);
  assert.equal(detail.json.data.canCancel, false); // n'a pas accès au dépôt
  const crev = detail.json.data.lines.find((l: Json) => l.productId === ctx.crevette.id);
  assert.deepEqual(crev.batches.map((b: Json) => [b.lotNumber, Number(b.quantity)]), [["LOT-A", 3], ["LOT-B", 1]]);
  assert.equal(Number(detail.json.data.lines.find((l: Json) => l.productId === ctx.saucisse.id).unitCost), 650);

  const cancelDenied = await call(transferCancel.POST, { path: `/api/transfers/${ctx.tr}/cancel`, cookie: ctx.shopManager, params: { id: ctx.tr }, body: { reason: "test" } });
  assert.equal(cancelDenied.status, 403);
});

test("transfert : réception partielle — lots, coût et écart tracés", async () => {
  const detail = await call(transferRoute.GET, { path: `/api/transfers/${ctx.tr}`, cookie: ctx.shopManager, params: { id: ctx.tr } });
  const sauLine = detail.json.data.lines.find((l: Json) => l.productId === ctx.saucisse.id);

  const over = await call(transferReceive.POST, {
    path: `/api/transfers/${ctx.tr}/receive`,
    cookie: ctx.shopManager,
    params: { id: ctx.tr },
    body: { lines: [{ lineId: sauLine.id, receivedQty: 25 }] },
  });
  assert.equal(over.status, 400);

  const r = await call(transferReceive.POST, {
    path: `/api/transfers/${ctx.tr}/receive`,
    cookie: ctx.shopManager,
    params: { id: ctx.tr },
    body: { lines: [{ lineId: sauLine.id, receivedQty: 18 }], notes: "2 cartons manquants à l'arrivée" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.missingValue, "1300");
  assert.equal(await qty(ctx.shop, ctx.saucisse.id), 18);
  assert.equal(await qty(ctx.shop, ctx.crevette.id), 4);
  const shopStock = await prisma.stock.findUnique({ where: { centerId_productId: { centerId: ctx.shop, productId: ctx.saucisse.id } } });
  assert.equal(Number(shopStock!.avgCost), 650);

  const lots = await prisma.batch.findMany({ where: { productId: ctx.crevette.id, centerId: ctx.shop }, orderBy: { lotNumber: "asc" } });
  assert.deepEqual(lots.map((b) => [b.lotNumber, Number(b.remainingQty), b.expiresAt !== null]), [["LOT-A", 3, true], ["LOT-B", 1, true]]);

  const again = await call(transferReceive.POST, { path: `/api/transfers/${ctx.tr}/receive`, cookie: ctx.shopManager, params: { id: ctx.tr }, body: {} });
  assert.equal(again.status, 409);
  const cancelReceived = await call(transferCancel.POST, { path: `/api/transfers/${ctx.tr}/cancel`, cookie: ctx.owner, params: { id: ctx.tr }, body: { reason: "trop tard" } });
  assert.equal(cancelReceived.status, 409);
});

test("transfert : annulation en transit — retour à l'origine, mêmes lots", async () => {
  const r = await call(transfersRoute.POST, {
    path: "/api/transfers",
    cookie: ctx.owner,
    body: { fromCenterId: ctx.depot, toCenterId: ctx.shop, lines: [{ productId: ctx.chinchard.id, quantity: 5 }, { productId: ctx.crevette.id, quantity: 2 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(await qty(ctx.depot, ctx.chinchard.id), 7);

  const c = await call(transferCancel.POST, { path: `/api/transfers/${r.json.data.id}/cancel`, cookie: ctx.owner, params: { id: r.json.data.id }, body: { reason: "Camion en panne" } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.data.status, "CANCELLED");
  assert.equal(await qty(ctx.depot, ctx.chinchard.id), 12);
  assert.equal(await qty(ctx.depot, ctx.crevette.id), 3);
  const lotsAtDepot = await prisma.batch.aggregate({ where: { productId: ctx.crevette.id, centerId: ctx.depot }, _sum: { remainingQty: true } });
  assert.equal(Number(lotsAtDepot._sum.remainingQty), 3);

  // Listes : visible au départ comme à l'arrivée
  const list = await call(transfersRoute.GET, { path: `/api/transfers?centerId=${ctx.shop}`, cookie: ctx.shopManager });
  assert.equal(list.status, 200);
  assert.equal(list.json.data.length, 2);
  const received = list.json.data.find((t: Json) => t.status === "RECEIVED");
  assert.equal(received.missingValue, "1300");
});

test("journal d'audit intact après inventaires et transferts", async () => {
  const chain = await verifyAuditChain(ctx.companyId);
  assert.equal(chain.isValid, true, JSON.stringify(chain));
  const events = await prisma.auditLog.findMany({ where: { companyId: ctx.companyId }, select: { eventType: true } });
  const types = new Set(events.map((e) => e.eventType));
  for (const t of ["INVENTORY_STARTED", "INVENTORY_VALIDATED", "INVENTORY_CANCELLED", "STOCK_TRANSFERRED", "STOCK_TRANSFER_RECEIVED", "STOCK_TRANSFER_CANCELLED"]) {
    assert.equal(types.has(t as never), true, `événement ${t} manquant`);
  }
});

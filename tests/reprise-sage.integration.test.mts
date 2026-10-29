/**
 * Passage d'un autre logiciel (Sage Gestion Commerciale) à fishcore :
 * import du catalogue et du stock, suite de la numérotation des factures,
 * références articles, unités vendues au quart.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";
import { parseImport } from "../src/lib/import-articles.ts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const importRoute = await import("@/app/api/products/import/route");
const productsRoute = await import("@/app/api/products/route");
const unitsRoute = await import("@/app/api/units/route");
const unitRoute = await import("@/app/api/units/[id]/route");
const companyRoute = await import("@/app/api/company/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const { verifyAuditChain } = await import("@/lib/audit");

const ctx: Json = {};

// Extrait de la liste d'articles Sage d'une poissonnerie (copier-coller, tabulations)
const SAGE = [
  "Type\tRéférence\tStock réel\tDésignation\tPrix de vente\tPrix d'achat",
  "\tA01\t52,15\tAILERON\t2 500\t2 100",
  "\tC02\t54,75\tCUISSE NORMALE\t1 800\t1 500",
  "\tS02\t423,85\tSILVIE 16+\t1 200\t950",
  "\tS08\t465,00\tSAUCISSE\t800\t650",
  "\tG04\t\tG T\t\t", // sans prix : écarté
].join("\n");

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Ets Ray-Espoir", ownerName: "Patron", phone: "97000000", email: "owner@ray.bj", password: "Motdepasse1", businessType: "FISHMONGER" },
  });
  ctx.companyId = reg.json.data.companyId;
  ctx.owner = await login("owner@ray.bj");
  ctx.centerId = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Calavi 42", code: "CAL" } })).json.data.id;
  const hash = await passwordHash();
  const u = await prisma.user.create({
    data: { email: "gladys@ray.bj", passwordHash: hash, firstName: "Gladys", lastName: "T", role: "CASHIER", companyId: ctx.companyId, centers: { create: [{ centerId: ctx.centerId }] } },
  });
  ctx.cashier = await login(u.email);
  const units = await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner });
  ctx.U = Object.fromEntries(units.json.data.map((x: Json) => [x.symbol, x]));
});
after(async () => prisma.$disconnect());

const imp = (body: Json, cookie = ctx.owner) => call(importRoute.POST, { path: "/api/products/import", cookie, body });

test("le carton de poissonnerie se vend au quart", () => {
  assert.equal(ctx.U["carton"].allowsDecimal, true);
});

test("import : vérification sans rien enregistrer, puis import réel avec le stock", async () => {
  const parsed = parseImport(SAGE);
  assert.equal(parsed.rows.length, 5);
  const body = { rows: parsed.rows, centerId: ctx.centerId, defaultUnitId: ctx.U["carton"].id };

  const cashierTry = await imp({ ...body, dryRun: true }, ctx.cashier);
  assert.equal(cashierTry.status, 403);

  const dry = await imp({ ...body, dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.equal(dry.json.data.created, 4);
  assert.deepEqual(dry.json.data.skipped.map((s: Json) => s.reason), ["prix de vente manquant"]);
  assert.equal(await prisma.product.count({ where: { companyId: ctx.companyId } }), 0, "la vérification n'enregistre rien");

  const real = await imp(body);
  assert.equal(real.status, 201, JSON.stringify(real.json));
  assert.equal(real.json.data.created, 4);
  assert.equal(real.json.data.stockSet, 4);

  const aileron = await prisma.product.findFirstOrThrow({ where: { companyId: ctx.companyId, internalCode: "A01" }, include: { stocks: true } });
  assert.equal(aileron.name, "AILERON");
  assert.equal(Number(aileron.sellingPrice), 2500);
  assert.equal(Number(aileron.stocks[0].quantity), 52.15);
  assert.equal(Number(aileron.stocks[0].avgCost), 2100, "coût moyen = prix d'achat importé");
  const mv = await prisma.stockMovement.findFirstOrThrow({ where: { stockId: aileron.stocks[0].id } });
  assert.equal(mv.type, "INVENTORY_ADJUST");
  ctx.saucisse = await prisma.product.findFirstOrThrow({ where: { companyId: ctx.companyId, internalCode: "S08" } });
});

test("réimport : stock ramené à l'inventaire, prix mis à jour seulement sur demande", async () => {
  const text = "Référence\tDésignation\tStock réel\tPrix de vente\nA01\tAILERON\t50\t2600\nN01\tNOUVEAU\t\t1000";
  const keep = await imp({ rows: parseImport(text).rows, centerId: ctx.centerId });
  assert.equal(keep.status, 201, JSON.stringify(keep.json));
  assert.equal(keep.json.data.created, 1);
  assert.equal(keep.json.data.unchanged, 1);
  const a = await prisma.product.findFirstOrThrow({ where: { companyId: ctx.companyId, internalCode: "A01" }, include: { stocks: true } });
  assert.equal(Number(a.sellingPrice), 2500, "prix non modifié");
  assert.equal(Number(a.stocks[0].quantity), 50, "stock ramené à 50 (−2,15)");

  const noCenter = await imp({ rows: parseImport(text).rows, updateExisting: true });
  assert.equal(noCenter.status, 400, "le stock importé doit viser un magasin");
  const upd = await imp({ rows: parseImport(text).rows, updateExisting: true, centerId: ctx.centerId });
  assert.equal(upd.json.data.updated, 1);
  assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).sellingPrice), 2600);
  assert.equal(await prisma.productPriceHistory.count({ where: { productId: a.id } }), 2);
});

test("une référence ne désigne qu'un article", async () => {
  const r = await call(productsRoute.POST, {
    path: "/api/products", cookie: ctx.owner,
    body: { name: "Autre saucisse", internalCode: "s08", baseUnitId: ctx.U["kg"].id, purchasePrice: 0, sellingPrice: 900, stockAlertQty: 0 },
  });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "REFERENCE_TAKEN");
});

test("numérotation : suite des factures de Sage (2768 → 2769), jamais en arrière", async () => {
  const set = await call(companyRoute.PATCH, {
    path: "/api/company", method: "PATCH", cookie: ctx.owner, body: { invoicePrefix: "CPF26", nextInvoiceNumber: 2769, invoiceFormat: "TICKET_80" },
  });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal(set.json.data.invoiceFormat, "TICKET_80");

  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.centerId } });
  const session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: register.id, openingBalance: 0 } })).json.data.id;
  // ½ kg de saucisse… ici l'unité est le carton (fractionnable) : 0,5 × 800 = 400
  const s = await call(salesRoute.POST, {
    path: "/api/sales", cookie: ctx.cashier,
    body: { sessionId: session, idempotencyKey: idem(), lines: [{ productId: ctx.saucisse.id, quantity: 0.5, unitPrice: 800 }], payments: [{ method: "CASH", amount: 400 }] },
  });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal(s.json.data.saleNumber, "CPF26-002769");
  assert.equal(Number(s.json.data.totalAmount), 400);

  const back = await call(companyRoute.PATCH, { path: "/api/company", method: "PATCH", cookie: ctx.owner, body: { nextInvoiceNumber: 100 } });
  assert.equal(back.status, 400);
  assert.equal(back.json.code, "INVOICE_NUMBER_BACKWARDS");
  const bad = await call(companyRoute.PATCH, { path: "/api/company", method: "PATCH", cookie: ctx.owner, body: { invoicePrefix: "CP F/26" } });
  assert.equal(bad.status, 400);
});

test("unité rendue entière : le quart est refusé à la caisse", async () => {
  const r = await call(unitRoute.PATCH, {
    path: `/api/units/${ctx.U["carton"].id}`, method: "PATCH", cookie: ctx.owner, params: { id: ctx.U["carton"].id }, body: { allowsDecimal: false },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.centerId } });
  const session = await prisma.cashSession.findFirstOrThrow({ where: { cashRegisterId: register.id, closedAt: null } });
  const s = await call(salesRoute.POST, {
    path: "/api/sales", cookie: ctx.cashier,
    body: { sessionId: session.id, idempotencyKey: idem(), lines: [{ productId: ctx.saucisse.id, quantity: 0.25, unitPrice: 800 }], payments: [{ method: "CASH", amount: 200 }] },
  });
  assert.equal(s.json.code, "INTEGER_QUANTITY");
  const cashierTry = await call(unitRoute.PATCH, {
    path: `/api/units/${ctx.U["carton"].id}`, method: "PATCH", cookie: ctx.cashier, params: { id: ctx.U["carton"].id }, body: { allowsDecimal: true },
  });
  assert.equal(cashierTry.status, 403);
});

test("journal d'audit intègre", async () => {
  assert.equal((await verifyAuditChain(ctx.companyId)).isValid, true);
});

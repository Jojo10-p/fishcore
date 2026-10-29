/**
 * Phase 2 — Gestion financière (cahier §12, §14, §15) : coût de revient,
 * marge, créances clients, dettes fournisseurs, dépenses, rapport.
 * Tous les montants attendus sont calculés à la main dans les commentaires.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const productsRoute = await import("@/app/api/products/route");
const unitsRoute = await import("@/app/api/units/route");
const suppliersRoute = await import("@/app/api/suppliers/route");
const supplierRoute = await import("@/app/api/suppliers/[id]/route");
const supplierPaymentsRoute = await import("@/app/api/suppliers/[id]/payments/route");
const customersRoute = await import("@/app/api/customers/route");
const customerRoute = await import("@/app/api/customers/[id]/route");
const customerPaymentsRoute = await import("@/app/api/customers/[id]/payments/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const expensesRoute = await import("@/app/api/expenses/route");
const expenseCancelRoute = await import("@/app/api/expenses/[id]/cancel/route");
const financeRoute = await import("@/app/api/reports/finance/route");
const { verifyAuditChain } = await import("@/lib/audit");

const ctx: Json = {};

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Dépôt Finances", ownerName: "Patron Test", phone: "97000000", email: "owner@fin.bj", password: "Motdepasse1", businessType: "GENERAL" },
  });
  ctx.companyId = reg.json.data.companyId;
  ctx.owner = await login("owner@fin.bj");
  const center = await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Dépôt", code: "DEP" } });
  ctx.centerId = center.json.data.id;

  const hash = await passwordHash();
  for (const [key, role] of [["cashier", "CASHIER"], ["manager", "CENTER_MANAGER"], ["accountant", "ACCOUNTANT"]] as const) {
    const u = await prisma.user.create({
      data: { email: `${key}@fin.bj`, passwordHash: hash, firstName: key, lastName: "T", role, companyId: ctx.companyId, centers: { create: [{ centerId: ctx.centerId }] } },
    });
    ctx[`${key}Id`] = u.id;
    ctx[key] = await login(u.email);
  }

  const units = await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner });
  const U = Object.fromEntries(units.json.data.map((u: Json) => [u.symbol, u.id]));
  const mk = async (name: string, unit: string, price: number) =>
    (await call(productsRoute.POST, { path: "/api/products", cookie: ctx.owner, body: { name, baseUnitId: U[unit], purchasePrice: 0, sellingPrice: price, stockAlertQty: 0 } })).json.data;
  ctx.A = await mk("Article A", "pce", 2000);
  ctx.B = await mk("Article B", "kg", 3000);

  const sup = await call(suppliersRoute.POST, { path: "/api/suppliers", cookie: ctx.owner, body: { name: "Grossiste Lomé", paymentTermDays: 30 } });
  ctx.supplierId = sup.json.data.id;

  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.centerId } });
  const open = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: register.id, openingBalance: 0 } });
  ctx.sessionId = open.json.data.id;
});
after(async () => prisma.$disconnect());

async function receive(body: Json) {
  const r = await call(receiptsRoute.POST, { path: "/api/goods-receipts", cookie: ctx.owner, body: { centerId: ctx.centerId, ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const v = await call(validateRoute.POST, { path: `/api/goods-receipts/${r.json.data.id}/validate`, cookie: ctx.owner, params: { id: r.json.data.id }, body: {} });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  return r.json.data.id;
}

const sell = (cookie: string, lines: Json[], payments: Json[], extra: Json = {}) =>
  call(salesRoute.POST, { path: "/api/sales", cookie, body: { sessionId: ctx.sessionId, idempotencyKey: idem(), lines, payments, ...extra } });

test("coût de revient : frais annexes répartis au prorata de la valeur", async () => {
  // A : 100 × 1 000 = 100 000 ; B : 50 × 2 000 = 100 000 ; frais 10 000 → 5 000 chacun
  // A : (100 000 + 5 000) / 100 = 1 050 ; B : (100 000 + 5 000) / 50 = 2 100
  ctx.receipt1 = await receive({
    supplierId: ctx.supplierId,
    reference: "FAC-001",
    transportCost: 8000,
    iceCost: 2000,
    lines: [
      { productId: ctx.A.id, quantity: 100, unitPrice: 1000, totalPrice: 100000 },
      { productId: ctx.B.id, quantity: 50, unitPrice: 2000, totalPrice: 100000 },
    ],
  });
  const lines = await prisma.goodsReceiptLine.findMany({ where: { receiptId: ctx.receipt1 }, orderBy: { productId: "asc" } });
  const byProduct = Object.fromEntries(lines.map((l) => [l.productId, Number(l.landedUnitCost)]));
  assert.equal(byProduct[ctx.A.id], 1050);
  assert.equal(byProduct[ctx.B.id], 2100);
  const stockA = await prisma.stock.findFirstOrThrow({ where: { productId: ctx.A.id } });
  assert.equal(Number(stockA.avgCost), 1050);
});

test("la réception d'un fournisseur crée sa facture (dette) avec échéance", async () => {
  const purchase = await prisma.purchase.findFirstOrThrow({ where: { supplierId: ctx.supplierId } });
  assert.equal(Number(purchase.totalAmount), 210000, "marchandise 200 000 + frais 10 000");
  const days = Math.round((purchase.dueDate!.getTime() - Date.now()) / 86400000);
  assert.ok(days >= 29 && days <= 30, `échéance à 30 jours (${days})`);
});

test("coût moyen pondéré après une 2e réception", async () => {
  // CMP A = (100 × 1 050 + 100 × 1 200) / 200 = 1 125
  await receive({ supplierId: ctx.supplierId, reference: "FAC-002", lines: [{ productId: ctx.A.id, quantity: 100, unitPrice: 1200, totalPrice: 120000 }] });
  const stockA = await prisma.stock.findFirstOrThrow({ where: { productId: ctx.A.id } });
  assert.equal(Number(stockA.avgCost), 1125);
});

test("le coût des marchandises est figé sur chaque ligne de vente", async () => {
  // 10 × 2 000 = 20 000 ; coût 10 × 1 125 = 11 250
  const s = await sell(ctx.cashier, [{ productId: ctx.A.id, quantity: 10, unitPrice: 2000 }], [{ method: "CASH", amount: 20000 }]);
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal(Number(s.json.data.lines[0].costAmount), 11250);
});

test("vente à crédit : plafond du client respecté", async () => {
  const c = await call(customersRoute.POST, { path: "/api/customers", cookie: ctx.manager, body: { name: "Entreprise BTP Akpro", phone: "96000000", creditLimit: 30000 } });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  ctx.customerId = c.json.data.id;

  const noLimitForCashier = await call(customersRoute.POST, { path: "/api/customers", cookie: ctx.cashier, body: { name: "Autre", creditLimit: 1000000 } });
  assert.equal(noLimitForCashier.status, 403, "seul un responsable fixe un plafond");

  const ok = await sell(ctx.cashier, [{ productId: ctx.A.id, quantity: 10, unitPrice: 2000 }], [{ method: "CREDIT", amount: 20000 }], { customerId: ctx.customerId });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const over = await sell(ctx.cashier, [{ productId: ctx.A.id, quantity: 10, unitPrice: 2000 }], [{ method: "CREDIT", amount: 20000 }], { customerId: ctx.customerId });
  assert.equal(over.status, 409);
  assert.equal(over.json.code, "CREDIT_LIMIT", "20 000 + 20 000 > 30 000");
});

test("règlement client en espèces : encaissé dans la caisse, jamais au-delà de la dette", async () => {
  const pay = await call(customerPaymentsRoute.POST, {
    path: `/api/customers/${ctx.customerId}/payments`, cookie: ctx.cashier, params: { id: ctx.customerId },
    body: { amount: 15000, method: "CASH", sessionId: ctx.sessionId, idempotencyKey: idem() },
  });
  assert.equal(pay.status, 201, JSON.stringify(pay.json));

  const over = await call(customerPaymentsRoute.POST, {
    path: `/api/customers/${ctx.customerId}/payments`, cookie: ctx.cashier, params: { id: ctx.customerId },
    body: { amount: 6000, method: "MOBILE_MONEY", idempotencyKey: idem() },
  });
  assert.equal(over.status, 400);
  assert.equal(over.json.code, "OVERPAYMENT");

  const statement = await call(customerRoute.GET, { path: `/api/customers/${ctx.customerId}`, cookie: ctx.manager, params: { id: ctx.customerId } });
  assert.equal(Number(statement.json.data.balance), 5000);
  assert.deepEqual(statement.json.data.statement.map((e: Json) => e.balance), [20000, 5000]);
});

test("dépenses : sortie de caisse, annulation qui remet l'argent", async () => {
  const e1 = await call(expensesRoute.POST, {
    path: "/api/expenses", cookie: ctx.manager,
    body: { centerId: ctx.centerId, category: "Transport", amount: 5000, description: "Livraison", sessionId: ctx.sessionId },
  });
  assert.equal(e1.status, 201, JSON.stringify(e1.json));
  const cancel = await call(expenseCancelRoute.POST, {
    path: `/api/expenses/${e1.json.data.id}/cancel`, cookie: ctx.manager, params: { id: e1.json.data.id }, body: { reason: "Saisie en double" },
  });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));

  const e2 = await call(expensesRoute.POST, {
    path: "/api/expenses", cookie: ctx.manager,
    body: { centerId: ctx.centerId, category: "Électricité", amount: 3000, sessionId: ctx.sessionId },
  });
  assert.equal(e2.status, 201);

  const accountant = await call(expensesRoute.POST, {
    path: "/api/expenses", cookie: ctx.accountant, body: { centerId: ctx.centerId, category: "Divers", amount: 100 },
  });
  assert.equal(accountant.status, 403, "le comptable consulte, il ne saisit pas");
});

test("paiement fournisseur imputé sur les factures les plus anciennes", async () => {
  // Factures : 210 000 (FAC-001) puis 120 000 (FAC-002)
  const p1 = await call(supplierPaymentsRoute.POST, {
    path: `/api/suppliers/${ctx.supplierId}/payments`, cookie: ctx.owner, params: { id: ctx.supplierId },
    body: { amount: 150000, method: "TRANSFER", reference: "VIR-1" },
  });
  assert.equal(p1.status, 201, JSON.stringify(p1.json));
  const p2 = await call(supplierPaymentsRoute.POST, {
    path: `/api/suppliers/${ctx.supplierId}/payments`, cookie: ctx.owner, params: { id: ctx.supplierId },
    body: { amount: 100000, method: "MOBILE_MONEY" },
  });
  assert.deepEqual(
    (p2.json.data.allocations as Json[]).map((a) => Number(a.amount)),
    [60000, 40000],
    "solde de FAC-001 (60 000) puis acompte sur FAC-002"
  );
  const over = await call(supplierPaymentsRoute.POST, {
    path: `/api/suppliers/${ctx.supplierId}/payments`, cookie: ctx.owner, params: { id: ctx.supplierId },
    body: { amount: 90000, method: "CASH" },
  });
  assert.equal(over.status, 400, "il ne reste que 80 000");

  const cashierTry = await call(supplierPaymentsRoute.POST, {
    path: `/api/suppliers/${ctx.supplierId}/payments`, cookie: ctx.cashier, params: { id: ctx.supplierId }, body: { amount: 1000, method: "CASH" },
  });
  assert.equal(cashierTry.status, 403);

  const detail = await call(supplierRoute.GET, { path: `/api/suppliers/${ctx.supplierId}`, cookie: ctx.owner, params: { id: ctx.supplierId } });
  assert.equal(detail.json.data.debt, 80000);
});

test("§15 — rapport financier : CA, marge, dépenses, encaissements, créances, dettes", async () => {
  const r = await call(financeRoute.GET, { path: "/api/reports/finance?compare=true", cookie: ctx.accountant });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const f = r.json.data.current;
  // Ventes : 20 000 (espèces) + 20 000 (crédit) = 40 000 ; coût 2 × 11 250 = 22 500
  assert.equal(f.revenueTTC, 40000);
  assert.equal(f.costOfSales, 22500);
  assert.equal(f.grossMargin, 17500);
  assert.equal(f.expenses.total, 3000, "la dépense annulée n'est pas comptée");
  assert.equal(f.netResult, 14500);
  // Encaissements : 20 000 vente espèces + 15 000 règlement client
  assert.equal(f.collections.total, 35000);
  assert.equal(f.collections.creditGranted, 20000);
  assert.equal(f.receivables, 5000);
  assert.equal(f.payables.total, 80000);
  assert.equal(f.topProducts[0].name, "Article A");
  assert.ok(r.json.data.previous, "comparaison avec la période précédente");

  const cashier = await call(financeRoute.GET, { path: "/api/reports/finance", cookie: ctx.cashier });
  assert.equal(cashier.status, 403);
});

test("export CSV : réservé, historisé", async () => {
  const before = await prisma.auditLog.count({ where: { eventType: "DOCUMENT_EXPORTED" } });
  const req = await import("next/server");
  const res = await financeRoute.GET(
    new req.NextRequest("http://localhost:3000/api/reports/finance?format=csv", { headers: { cookie: `fishcore-session=${ctx.accountant}` } })
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  const text = await res.text();
  assert.match(text, /Marge brute;17500/);
  assert.equal(await prisma.auditLog.count({ where: { eventType: "DOCUMENT_EXPORTED" } }), before + 1);
});

test("clôture : la caisse tient compte du règlement client et des dépenses", async () => {
  // Fond 0 + vente espèces 20 000 + règlement 15 000 − dépense 5 000 + annulation 5 000 − dépense 3 000 = 32 000
  const close = await call(cashRoute.POST, {
    path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "close", sessionId: ctx.sessionId, declaredBalance: 32000 },
  });
  assert.equal(close.status, 200, JSON.stringify(close.json));
  assert.equal(Number(close.json.data.theoreticalBalance), 32000);
  assert.equal(Number(close.json.data.discrepancy), 0);
});

test("journal d'audit intègre", async () => {
  assert.equal((await verifyAuditChain(ctx.companyId)).isValid, true);
});

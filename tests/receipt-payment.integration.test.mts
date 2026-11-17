/**
 * Arrivage « déjà payé » ou « pris à crédit », rappels à la direction,
 * et plusieurs numéros par fournisseur.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const suppliersRoute = await import("@/app/api/suppliers/route");
const supplierRoute = await import("@/app/api/suppliers/[id]/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const editRoute = await import("@/app/api/goods-receipts/[id]/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");
const { remindSupplierDues } = await import("@/lib/receipt-payment");

const ctx: Json = {};

async function receive(payment: Json | undefined, supplierId: string | null = ctx.s1, qty = 10) {
  const r = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie: ctx.owner,
    body: { centerId: ctx.center, supplierId: supplierId ?? undefined, receivedAt: "2026-11-15", lines: [{ productId: ctx.p1, quantity: qty, unitPrice: 2800, totalPrice: 2800 * qty }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const v = await call(validateRoute.POST, { path: `/api/goods-receipts/${r.json.data.id}/validate`, cookie: ctx.owner, body: payment === undefined ? {} : { payment }, params: { id: r.json.data.id } });
  await waitForStockAlerts();
  return { id: r.json.data.id as string, v };
}
const purchaseOf = (receiptId: string) => prisma.purchase.findFirstOrThrow({ where: { receipts: { some: { id: receiptId } } }, include: { payments: true } });

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Boutique Test", ownerName: "Direction Test", phone: "97000000", email: "direction@test.bj", password: "Motdepasse1", businessType: "LUBRICANTS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.owner = await login("direction@test.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Calavi", code: "CAL" } })).json.data.id;
  const company = (await prisma.company.findFirstOrThrow({ select: { id: true } })).id;
  ctx.company = company;
  const unit = await prisma.unit.findFirstOrThrow({ where: { companyId: company } });
  ctx.p1 = (await prisma.product.create({ data: { companyId: company, centerId: ctx.center, name: "ORYX — 1 L", baseUnitId: unit.id, sellingPrice: 3500, purchasePrice: 2800 } })).id;
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("fournisseur avec plusieurs numéros", async () => {
  const r = await call(suppliersRoute.POST, { path: "/api/suppliers", cookie: ctx.owner, body: { name: "MAISON ORYX", phone: "01000000", otherPhones: ["0197000001", "0161000002"] } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  ctx.s1 = r.json.data.id;
  const u = await call(supplierRoute.PATCH, { path: `/api/suppliers/${ctx.s1}`, method: "PATCH", cookie: ctx.owner, params: { id: ctx.s1 }, body: { phone: "01000000", otherPhones: ["0197000001"] } });
  assert.equal(u.status, 200);
  const list = await call(suppliersRoute.GET, { path: "/api/suppliers", cookie: ctx.owner });
  assert.deepEqual(list.json.data.find((s: Json) => s.id === ctx.s1).otherPhones, ["0197000001"]);
});

test("déjà payé : la facture fournisseur est soldée, règlement « payé à l'arrivage »", async () => {
  const { id, v } = await receive({ mode: "PAID", method: "MOBILE_MONEY" });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const p = await purchaseOf(id);
  assert.equal(Number(p.paidAmount), 28000);
  assert.equal(p.payments.length, 1);
  assert.equal(p.payments[0].atReceipt, true);
  assert.equal(p.payments[0].method, "MOBILE_MONEY");
  ctx.paidReceipt = id;
});

test("arrivage payé modifié : le règlement suit le nouveau total ; supprimé : le règlement part avec", async () => {
  const r = await call(editRoute.PUT, {
    path: `/api/goods-receipts/${ctx.paidReceipt}`,
    method: "PUT",
    cookie: ctx.owner,
    params: { id: ctx.paidReceipt },
    body: { centerId: ctx.center, supplierId: ctx.s1, receivedAt: "2026-11-15", lines: [{ productId: ctx.p1, quantity: 12, unitPrice: 2800, totalPrice: 33600 }] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = await purchaseOf(ctx.paidReceipt);
  assert.equal(Number(p.totalAmount), 33600);
  assert.equal(Number(p.paidAmount), 33600);
  assert.equal(Number(p.payments[0].amount), 33600);
  await waitForStockAlerts();
  const d = await call(editRoute.DELETE, { path: `/api/goods-receipts/${ctx.paidReceipt}`, method: "DELETE", cookie: ctx.owner, params: { id: ctx.paidReceipt }, body: { reason: "Erreur de saisie" } });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(await prisma.supplierPayment.count({ where: { atReceipt: true } }), 0);
});

test("pris à crédit sans fournisseur : refusé", async () => {
  const { v } = await receive({ mode: "CREDIT" }, null);
  assert.equal(v.status, 400);
  assert.equal(v.json.code, "CREDIT_NEEDS_SUPPLIER");
});

test("pris à crédit : dette avec échéance, rappel à la direction 2 jours avant, une fois par jour", async () => {
  const { id, v } = await receive({ mode: "CREDIT", dueDate: "2026-11-20" });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const p = await purchaseOf(id);
  assert.equal(Number(p.paidAmount), 0);
  assert.equal(p.dueDate!.toISOString().slice(0, 10), "2026-11-20");

  // Trop tôt : pas de rappel
  assert.equal(await remindSupplierDues(ctx.company, new Date("2026-11-16T09:00:00Z")), 0);
  // 2 jours avant : rappel
  assert.equal(await remindSupplierDues(ctx.company, new Date("2026-11-18T10:00:00Z")), 1);
  await waitForNotifications();
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "direction@test.bj" } });
  const n = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: "SUPPLIER_DUE" } });
  assert.match(n.title, /MAISON ORYX — 28\s000 F à régler dans 2 jours/);
  // Revérifié 3 heures plus tard : rien (au plus toutes les 6 heures)
  assert.equal(await remindSupplierDues(ctx.company, new Date("2026-11-18T13:00:00Z")), 0);
  // En retard : nouveau rappel le lendemain
  assert.equal(await remindSupplierDues(ctx.company, new Date("2026-11-21T10:00:00Z")), 1);
  await waitForNotifications();
  const late = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: "SUPPLIER_DUE" }, orderBy: { createdAt: "desc" } });
  assert.match(late.title, /en retard de 1 jour/);
});

test("pris à crédit sans date : 7 jours pour payer", async () => {
  const { id } = await receive({ mode: "CREDIT" });
  const p = await purchaseOf(id);
  const days = (p.dueDate!.getTime() - p.createdAt.getTime()) / (24 * 3600_000);
  assert.ok(Math.abs(days - 7) < 0.01, `échéance à ${days} jours`);
});

test("déjà payé : jamais de rappel", async () => {
  const { id } = await receive({ mode: "PAID", method: "CASH" });
  await prisma.purchase.update({ where: { id: (await purchaseOf(id)).id }, data: { dueDate: new Date("2026-11-01") } });
  await prisma.company.update({ where: { id: ctx.company }, data: { dueRemindersAt: null } });
  // Les achats à crédit des tests précédents viennent d'être rappelés
  await prisma.purchase.updateMany({ where: { id: { not: (await purchaseOf(id)).id } }, data: { lastReminderAt: new Date("2026-12-31") } });
  assert.equal(await remindSupplierDues(ctx.company, new Date("2026-11-25T10:00:00Z")), 0);
});

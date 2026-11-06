/**
 * Notifications de stock (édition GJH) :
 *  - seuil fixe à 7 : une notification « Bien reçu » à 7, puis à chaque nouvelle vente ;
 *  - « moitié vendue » une seule fois depuis le dernier ajout de stock ;
 *  - seuls le patron et les gérants de la boutique reçoivent (pas la caisse) ;
 *  - un ajout de stock remet le suivi à zéro ; inscription fermée.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const unitsRoute = await import("@/app/api/units/route");
const productsRoute = await import("@/app/api/products/route");
const usersRoute = await import("@/app/api/users/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const pushRoute = await import("@/app/api/push/route");
const pushTestRoute = await import("@/app/api/push/test/route");
const stockRoute = await import("@/app/api/stock/route");
const { waitForStockAlerts, stockNotification } = await import("@/lib/stock-alerts");
const { pushTransport } = await import("@/lib/push");
const { waitForNotifications } = await import("@/lib/notify");

const ctx: Json = {};
const sent: Array<{ endpoint: string; payload: Json }> = [];
const realSend = pushTransport.send;

const sell = async (qty: number, product = ctx.product) => {
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.cashier,
    body: { sessionId: ctx.session, idempotencyKey: idem(), lines: [{ productId: product, quantity: qty, unitPrice: 5000 }], payments: [{ method: "CASH", amount: qty * 5000 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await waitForStockAlerts();
};
const take = () => sent.splice(0, sent.length);
const sub = (name: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: "BPk" + "x".repeat(60), auth: "auth-" + name } });

before(async () => {
  await resetDb();
  process.env.VAPID_PUBLIC_KEY = "test-public";
  process.env.VAPID_PRIVATE_KEY = "test-private";
  pushTransport.send = async (s, payload) => {
    if (s.endpoint.endsWith("/expire")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
  };
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "GRACES JUMELLES HOUSE", ownerName: "Direction GJH", phone: "97000000", email: "direction@gjh.bj", password: "Motdepasse1", businessType: "LUBRICANTS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.owner = await login("direction@gjh.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Boutique GJH", code: "GJH" } })).json.data.id;
  const units = (await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner })).json.data;
  ctx.unit = units.find((u: Json) => u.symbol === "bidon").id;
  const p = await call(productsRoute.POST, {
    path: "/api/products",
    cookie: ctx.owner,
    // seuil demandé : 2, mais l'édition GJH impose 7
    body: { name: "Huile nationale 1 L", internalCode: "N01", baseUnitId: ctx.unit, sellingPrice: 5000, purchasePrice: 4000, stockAlertQty: 2 },
  });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  ctx.product = p.json.data.id;
  assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: ctx.product } })).stockAlertQty), 7);

  for (const [email, role] of [["caisse@gjh.bj", "CASHIER"], ["gerant@gjh.bj", "CENTER_MANAGER"]]) {
    const u = await call(usersRoute.POST, {
      path: "/api/users",
      cookie: ctx.owner,
      body: { firstName: role === "CASHIER" ? "Rachidi" : "Fabrice", lastName: "GJH", email, password: "Motdepasse1", role, centerIds: [ctx.center] },
    });
    assert.equal(u.status, 201, JSON.stringify(u.json));
  }
  ctx.cashier = await login("caisse@gjh.bj");
  ctx.manager = await login("gerant@gjh.bj");

  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.product, quantity: 20, avgCost: 4000 } });
  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: register.id, openingBalance: 0 } })).json.data.id;
});

after(async () => {
  pushTransport.send = realSend;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  await prisma.$disconnect();
});

test("inscription fermée hors tests", async () => {
  const prev = process.env.NEXT_PUBLIC_REGISTRATION_OPEN;
  delete process.env.NEXT_PUBLIC_REGISTRATION_OPEN;
  try {
    const r = await call(registerRoute.POST, { path: "/api/auth/register", body: { tradeName: "Autre", ownerName: "X", phone: "1", email: "x@y.bj", password: "Motdepasse1", businessType: "LUBRICANTS" } });
    assert.equal(r.status, 403);
  } finally {
    process.env.NEXT_PUBLIC_REGISTRATION_OPEN = prev;
  }
});

test("abonnement : réservé au gérant et au patron", async () => {
  const no = await call(pushRoute.POST, { path: "/api/push", cookie: ctx.cashier, body: sub("caisse") });
  assert.equal(no.status, 403);
  for (const [cookie, name] of [[ctx.owner, "patron"], [ctx.manager, "gerant"]]) {
    const r = await call(pushRoute.POST, { path: "/api/push", cookie, body: sub(name) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  const info = (await call(pushRoute.GET, { path: "/api/push", cookie: ctx.owner })).json.data;
  assert.deepEqual([info.allowed, info.configured, info.publicKey, info.devices], [true, true, "test-public", 1]);
  assert.equal((await call(pushRoute.GET, { path: "/api/push", cookie: ctx.cashier })).json.data.allowed, false);
});

test("notification d'essai", async () => {
  const r = await call(pushTestRoute.POST, { path: "/api/push/test", cookie: ctx.manager, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = take();
  assert.equal(s.length, 1);
  assert.ok(s[0].endpoint.endsWith("/gerant"));
});

test("premier passage : rien n'est envoyé (point de départ = 20)", async () => {
  await sell(1); // 19 — premier passage
  assert.equal(take().length, 0);
});

test("moitié du stock vendue : une seule notification, qui ne demande pas de réponse", async () => {
  // Le point de départ est 19 (premier passage) : la moitié est 9,5
  await sell(5); // 14
  assert.equal(take().length, 0);
  await sell(5); // 9 ≤ 9,5
  const s = take();
  assert.equal(s.length, 2, "patron + gérant");
  assert.equal(s[0].payload.title, "Moitié du stock vendue");
  assert.equal(s[0].payload.requireAck, false);
  assert.match(s[0].payload.body, /il reste 9 bidons sur 19/);
  await sell(1); // 8 : pas de nouvelle « moitié »
  assert.equal(take().length, 0);
});

test("à 7 : « presque épuisé » avec « Bien reçu », puis une nouvelle à chaque vente", async () => {
  await sell(1); // 7
  let s = take();
  assert.equal(s.length, 2);
  assert.equal(s[0].payload.title, "Stock presque épuisé");
  assert.equal(s[0].payload.requireAck, true);
  assert.equal(s[0].payload.body, "Plus que 7 bidons de Huile nationale 1 L.");
  assert.equal(s[0].payload.tag, `low-${ctx.center}-${ctx.product}`);
  for (const left of [6, 5]) {
    await sell(1);
    s = take();
    assert.equal(s.length, 2, `notification à ${left}`);
    assert.equal(s[0].payload.body, `Plus que ${left} bidons de Huile nationale 1 L.`);
  }
  await sell(4); // 1
  assert.equal(take()[0].payload.body, "Plus que 1 bidon de Huile nationale 1 L.");
  await sell(1); // 0
  const z = take();
  assert.equal(z[0].payload.title, "Rupture de stock");
});

test("ajout de stock : le suivi repart du nouveau niveau", async () => {
  const r = await call(stockRoute.POST, {
    path: "/api/stock",
    cookie: ctx.owner,
    body: { centerId: ctx.center, productId: ctx.product, type: "CORRECTION", quantity: 30, reason: "Arrivage fournisseur" },
  });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
  await waitForStockAlerts();
  assert.equal(take().length, 0, "pas de notification à l'ajout");
  await sell(14); // 16 > 15 = moitié de 30
  assert.equal(take().length, 0);
  await sell(1); // 15
  const s = take();
  assert.equal(s[0].payload.title, "Moitié du stock vendue");
  assert.match(s[0].payload.body, /sur 30/);
});

test("appareil désinstallé (410) : retiré automatiquement", async () => {
  await call(pushRoute.POST, { path: "/api/push", cookie: ctx.owner, body: sub("expire") });
  assert.equal(await prisma.pushSubscription.count(), 3);
  await sell(8); // 7
  assert.equal(take().length, 2);
  assert.equal(await prisma.pushSubscription.count(), 2);
});

test("texte : plusieurs boutiques → nom de la boutique ; unités au pluriel", () => {
  const p = stockNotification(
    { kind: "low", companyId: "c", centerId: "x", productId: "p", productName: "Total Rubia 15W-40 — seau 20 L", unit: "seau", centerName: "Dépôt Calavi", quantity: 3, refQty: 10 },
    true
  );
  assert.equal(p.body, "Plus que 3 seaux de Total Rubia 15W-40 — seau 20 L (Dépôt Calavi).");
});

// ── Caisse GJH : nom du client, montant remis, dépense depuis la caisse, fournisseur dans l'alerte ──
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const suppliersRoute = await import("@/app/api/suppliers/route");
const expensesRoute = await import("@/app/api/expenses/route");
const saleIdRoute = await import("@/app/api/sales/[id]/route");
const registersRoute = await import("@/app/api/cash/registers/route");

test("vente : nom du client, montant remis et monnaie rendue enregistrés", async () => {
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.cashier,
    body: { sessionId: ctx.session, idempotencyKey: idem(), customerName: "Garage Kpota", lines: [{ productId: ctx.product, quantity: 1, unitPrice: 5000 }], payments: [{ method: "CASH", amount: 10000 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await waitForStockAlerts();
  take();
  const d = await call(saleIdRoute.GET, { path: `/api/sales/${r.json.data.id}`, cookie: ctx.owner, params: { id: r.json.data.id } });
  assert.equal(d.json.data.customerName, "Garage Kpota");
  assert.equal(Number(d.json.data.amountTendered), 10000);
  assert.equal(Number(d.json.data.changeGiven), 5000);
  assert.equal(d.json.data.cashier.role, "CASHIER");
});

test("le caissier enregistre une dépense payée avec sa caisse ; la clôture la déduit et sert de fond le lendemain", async () => {
  const e = await call(expensesRoute.POST, {
    path: "/api/expenses",
    cookie: ctx.cashier,
    body: { centerId: ctx.center, sessionId: ctx.session, category: "Transport", amount: 2000, description: "Zémidjan", method: "CASH" },
  });
  assert.equal(e.status, 201, JSON.stringify(e.json));
  const close = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "close", sessionId: ctx.session, declaredBalance: 1000 } });
  assert.equal(close.status, 200, JSON.stringify(close.json));
  const j = close.json.data.journal;
  assert.equal(j.expenses.length, 1);
  assert.equal(j.expenses[0].category, "Transport");
  assert.equal(Number(j.totalCashOut), 2000);
  assert.ok(j.salesCount > 0);
  const regs = await call(registersRoute.GET, { path: `/api/cash/registers?centerId=${ctx.center}`, cookie: ctx.cashier });
  assert.equal(Number(regs.json.data[0].lastClosing.amount), 1000, "fond du matin = clôture de la veille");
  // nouvelle session pour la suite
  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: register.id, openingBalance: 1000 } })).json.data.id;
});

test("alerte « presque épuisé » : dit chez quel fournisseur racheter et son numéro", async () => {
  const sup = await call(suppliersRoute.POST, { path: "/api/suppliers", cookie: ctx.owner, body: { name: "Distrilub Cotonou", phone: "+229 01 97 00 11 22" } });
  const stock = await prisma.stock.findFirstOrThrow({ where: { centerId: ctx.center, productId: ctx.product } });
  const add = 20 - Number(stock.quantity);
  const gr = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie: ctx.owner,
    body: { centerId: ctx.center, supplierId: sup.json.data.id, reference: "BL-1", receivedAt: new Date().toISOString(), lines: [{ productId: ctx.product, quantity: add, unitPrice: 4000, totalPrice: add * 4000 }] },
  });
  assert.equal(gr.status, 201, JSON.stringify(gr.json));
  await call(validateRoute.POST, { path: `/api/goods-receipts/${gr.json.data.id}/validate`, cookie: ctx.owner, params: { id: gr.json.data.id }, body: {} });
  await waitForStockAlerts();
  await waitForNotifications(); // résumé « Stock ajouté » envoyé au gérant
  take();
  await sell(13); // 7
  const s = take();
  assert.equal(s[0].payload.title, "Stock presque épuisé");
  assert.equal(s[0].payload.body, "Plus que 7 bidons de Huile nationale 1 L. Acheté chez Distrilub Cotonou : contactez-le au +229 01 97 00 11 22.");
});

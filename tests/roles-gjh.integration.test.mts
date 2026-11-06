/**
 * Rôles de l'édition GJH :
 *  - caissier et magasinier vendent, ajoutent du stock et changent les prix ;
 *    la direction et le gérant en reçoivent un résumé dans leur cloche ;
 *  - seuls la direction et le gérant ajoutent des utilisateurs ;
 *  - annulation : le caissier demande (avec la raison), la direction est notifiée et décide ;
 *  - tableau de bord pour tous : chaque caissier ses ventes, la direction tout + qui est connecté ;
 *  - caisse fermée : journal gardé et consultable à tout moment par la direction.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const unitsRoute = await import("@/app/api/units/route");
const productsRoute = await import("@/app/api/products/route");
const productRoute = await import("@/app/api/products/[id]/route");
const usersRoute = await import("@/app/api/users/route");
const invitationsRoute = await import("@/app/api/invitations/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const journalRoute = await import("@/app/api/cash/sessions/[id]/journal/route");
const salesRoute = await import("@/app/api/sales/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateRoute = await import("@/app/api/goods-receipts/[id]/validate/route");
const notificationsRoute = await import("@/app/api/notifications/route");
const dashboardRoute = await import("@/app/api/reports/dashboard/route");
const historyRoute = await import("@/app/api/products/[id]/price-history/route");
const { waitForNotifications } = await import("@/lib/notify");

const ctx: Json = {};

const bell = async (cookie: string) => {
  await waitForNotifications();
  const r = await call(notificationsRoute.GET, { path: "/api/notifications", cookie });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data as { items: Json[]; unread: number };
};

const openSession = async (cookie: string, registerId: string) => {
  const r = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie, body: { action: "open", cashRegisterId: registerId, openingBalance: 0 } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data.id as string;
};

const sell = async (cookie: string, session: string, qty = 1) => {
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie,
    body: { sessionId: session, idempotencyKey: idem(), lines: [{ productId: ctx.product, quantity: qty, unitPrice: 5200 }], payments: [{ method: "CASH", amount: qty * 5200 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data.id as string;
};

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "GRACES JUMELLES HOUSE", ownerName: "Eustache GJH", phone: "97000000", email: "direction@gjh.bj", password: "Motdepasse1", businessType: "LUBRICANTS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.owner = await login("direction@gjh.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Boutique GJH", code: "GJH" } })).json.data.id;
  const units = (await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner })).json.data;
  ctx.unit = units.find((u: Json) => u.symbol === "bidon").id;
  const p = await call(productsRoute.POST, {
    path: "/api/products",
    cookie: ctx.owner,
    body: { name: "SHELL HELIX 4L", internalCode: "SH4", baseUnitId: ctx.unit, sellingPrice: 5000, purchasePrice: 4000, stockAlertQty: 7 },
  });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  ctx.product = p.json.data.id;

  for (const [email, role, first] of [
    ["caisse1@gjh.bj", "CASHIER", "Samson"],
    ["caisse2@gjh.bj", "CASHIER", "Rachidi"],
    ["magasin@gjh.bj", "STOCK_MANAGER", "Koffi"],
    ["gerant@gjh.bj", "CENTER_MANAGER", "Fabrice"],
  ]) {
    const u = await call(usersRoute.POST, {
      path: "/api/users",
      cookie: ctx.owner,
      body: { firstName: first, lastName: "GJH", email, password: "Motdepasse1", role, centerIds: [ctx.center] },
    });
    assert.equal(u.status, 201, JSON.stringify(u.json));
  }
  ctx.cashier1 = await login("caisse1@gjh.bj");
  ctx.cashier2 = await login("caisse2@gjh.bj");
  ctx.stockman = await login("magasin@gjh.bj");
  ctx.manager = await login("gerant@gjh.bj");

  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.product, quantity: 50, avgCost: 4000 } });
  ctx.register1 = (await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } })).id;
  ctx.register2 = (await prisma.cashRegister.create({ data: { centerId: ctx.center, name: "Caisse 2" } })).id;
});

after(async () => {
  await prisma.$disconnect();
});

test("seuls la direction et le gérant ajoutent des utilisateurs", async () => {
  for (const cookie of [ctx.cashier1, ctx.stockman]) {
    const r = await call(invitationsRoute.POST, { path: "/api/invitations", cookie, body: { role: "CASHIER", centerId: ctx.center, kind: "code" } });
    assert.equal(r.status, 403);
  }
  const byManager = await call(invitationsRoute.POST, { path: "/api/invitations", cookie: ctx.manager, body: { role: "CASHIER", centerId: ctx.center, kind: "code" } });
  assert.equal(byManager.status, 201, JSON.stringify(byManager.json));
  const ownerByManager = await call(invitationsRoute.POST, { path: "/api/invitations", cookie: ctx.manager, body: { role: "COMPANY_OWNER", kind: "code" } });
  assert.equal(ownerByManager.status, 403, "le gérant n'ajoute pas de propriétaire");
});

test("le caissier ajoute du stock : résumé dans la cloche de la direction et du gérant", async () => {
  const supplier = await prisma.supplier.create({ data: { companyId: (await prisma.center.findUniqueOrThrow({ where: { id: ctx.center } })).companyId, name: "SOBEMAP Lubrifiants" } });
  const draft = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie: ctx.cashier1,
    body: { centerId: ctx.center, supplierId: supplier.id, lines: [{ productId: ctx.product, quantity: 12, unitId: ctx.unit, unitPrice: 4000, totalPrice: 48000 }] },
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  const v = await call(validateRoute.POST, { path: `/api/goods-receipts/${draft.json.data.id}/validate`, cookie: ctx.cashier1, params: { id: draft.json.data.id } });
  assert.equal(v.status, 200, JSON.stringify(v.json));

  for (const cookie of [ctx.owner, ctx.manager]) {
    const b = await bell(cookie);
    const n = b.items.find((i) => i.type === "STOCK_ADDED");
    assert.ok(n, "résumé reçu");
    assert.match(n!.title, /SOBEMAP/);
    assert.match(n!.message, /Samson \(Caissier\).*12 × SHELL HELIX 4L.*48/);
    assert.ok(b.unread >= 1);
  }
  const own = await bell(ctx.cashier1);
  assert.equal(own.items.filter((i) => i.type === "STOCK_ADDED").length, 0, "l'auteur ne se notifie pas");
});

test("le magasinier change un prix : autorisé, historisé, signalé ; l'historique reste réservé", async () => {
  const r = await call(productRoute.PATCH, {
    path: `/api/products/${ctx.product}`,
    method: "PATCH",
    cookie: ctx.stockman,
    params: { id: ctx.product },
    body: { sellingPrice: 5200, priceReason: "hausse fournisseur" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const b = await bell(ctx.owner);
  const n = b.items.find((i) => i.type === "PRICE_CHANGED");
  assert.ok(n);
  assert.match(n!.message, /Koffi \(Magasinier\).*5\s?000 → 5\s?200 F.*hausse fournisseur/);

  const hist = await call(historyRoute.GET, { path: `/api/products/${ctx.product}/price-history`, cookie: ctx.owner, params: { id: ctx.product } });
  assert.equal(hist.status, 200);
  assert.equal(hist.json.data.history[0].by, "Koffi GJH");
  for (const cookie of [ctx.stockman, ctx.cashier1]) {
    const h = await call(historyRoute.GET, { path: `/api/products/${ctx.product}/price-history`, cookie, params: { id: ctx.product } });
    assert.equal(h.status, 403, "historique des prix : direction et gérant");
  }
  // « Vu » : marque comme lu, n'efface rien
  const read = await call(notificationsRoute.POST, { path: "/api/notifications", cookie: ctx.owner, body: { all: true } });
  assert.equal(read.status, 200);
  const after = await bell(ctx.owner);
  assert.equal(after.unread, 0);
  assert.ok(after.items.length >= 2);
});

test("annulation : le caissier demande, la direction est notifiée et décide ; le caissier est prévenu", async () => {
  ctx.s1 = await openSession(ctx.cashier1, ctx.register1);
  const sale = await sell(ctx.cashier1, ctx.s1, 2);

  const forbidden = await call(cancelRoute.POST, {
    path: `/api/sales/${sale}/cancel`,
    cookie: ctx.cashier1,
    params: { id: sale },
    body: { action: "decide", cancellationId: "x", decision: "APPROVED" },
  });
  assert.equal(forbidden.status, 403, "le caissier ne peut pas annuler lui-même");

  const req = await call(cancelRoute.POST, { path: `/api/sales/${sale}/cancel`, cookie: ctx.cashier1, params: { id: sale }, body: { action: "request", reason: "Le client a changé d'avis" } });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  const b = await bell(ctx.manager);
  const n = b.items.find((i) => i.type === "CANCEL_REQUESTED");
  assert.ok(n);
  assert.match(n!.message, /Samson \(Caissier\).*Le client a changé d'avis/);
  assert.equal(n!.data.link, "/annulations");

  const ok = await call(cancelRoute.POST, {
    path: `/api/sales/${sale}/cancel`,
    cookie: ctx.manager,
    params: { id: sale },
    body: { action: "decide", cancellationId: req.json.data.id, decision: "APPROVED" },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const mine = await bell(ctx.cashier1);
  assert.ok(mine.items.some((i) => i.type === "CANCEL_DECIDED" && /acceptée/.test(i.title)));
  const stock = await prisma.stock.findFirstOrThrow({ where: { productId: ctx.product, centerId: ctx.center } });
  assert.equal(Number(stock.quantity), 62, "50 + 12 reçus, vente de 2 annulée");
});

test("tableau de bord : chaque caissier ses ventes, la direction tout et qui est connecté", async () => {
  await sell(ctx.cashier1, ctx.s1, 3); // 15 600
  ctx.s2 = await openSession(ctx.cashier2, ctx.register2);
  await sell(ctx.cashier2, ctx.s2, 1); // 5 200

  const c1 = await call(dashboardRoute.GET, { path: "/api/reports/dashboard", cookie: ctx.cashier1 });
  assert.equal(c1.status, 200, JSON.stringify(c1.json));
  assert.equal(c1.json.data.scope, "mine");
  assert.equal(c1.json.data.today.revenue, 15600);
  assert.equal(c1.json.data.activeUsers.length, 0);

  const c2 = await call(dashboardRoute.GET, { path: "/api/reports/dashboard", cookie: ctx.cashier2 });
  assert.equal(c2.json.data.today.revenue, 5200);

  const stockman = await call(dashboardRoute.GET, { path: "/api/reports/dashboard", cookie: ctx.stockman });
  assert.equal(stockman.status, 200, "le magasinier a aussi son tableau de bord");

  const boss = await call(dashboardRoute.GET, { path: "/api/reports/dashboard", cookie: ctx.owner });
  assert.equal(boss.json.data.scope, "all");
  assert.equal(boss.json.data.today.revenue, 20800);
  const names = boss.json.data.activeUsers.map((u: Json) => u.name);
  assert.ok(names.includes("Samson GJH") && names.includes("Rachidi GJH"), JSON.stringify(names));
  const samson = boss.json.data.activeUsers.find((u: Json) => u.name === "Samson GJH");
  assert.equal(samson.openSession.total, 15600);
  assert.deepEqual(
    boss.json.data.perCashier.map((c: Json) => [c.name, c.revenue]),
    [["Samson GJH", 15600], ["Rachidi GJH", 5200]]
  );
  const stock = await prisma.stock.findFirstOrThrow({ where: { productId: ctx.product, centerId: ctx.center } });
  assert.equal(Number(stock.quantity), 58, "un seul stock pour les deux caisses");
});

test("fermeture de caisse : journal rendu, gardé pour la direction, introuvable pour un autre caissier", async () => {
  const close = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier1, body: { action: "close", sessionId: ctx.s1, declaredBalance: 15600 } });
  assert.equal(close.status, 200, JSON.stringify(close.json));
  assert.equal(close.json.data.journal.cashier.firstName, "Samson");
  assert.equal(Number(close.json.data.theoreticalBalance), 15600, "vente annulée remboursée : retirée des espèces attendues");

  const b = await bell(ctx.owner);
  const n = b.items.find((i) => i.type === "CASH_CLOSED");
  assert.ok(n);
  assert.equal(n!.data.link, `/caisses?journal=${ctx.s1}`);

  const later = await call(journalRoute.GET, { path: `/api/cash/sessions/${ctx.s1}/journal`, cookie: ctx.owner, params: { id: ctx.s1 } });
  assert.equal(later.status, 200, JSON.stringify(later.json));
  assert.equal(later.json.data.journal.salesCount, 1);
  assert.equal(Number(later.json.data.discrepancy), 0);

  const other = await call(journalRoute.GET, { path: `/api/cash/sessions/${ctx.s1}/journal`, cookie: ctx.cashier2, params: { id: ctx.s1 } });
  assert.equal(other.status, 404);
  const own = await call(journalRoute.GET, { path: `/api/cash/sessions/${ctx.s1}/journal`, cookie: ctx.cashier1, params: { id: ctx.s1 } });
  assert.equal(own.status, 200);
});

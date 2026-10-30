/**
 * Console du créateur : vue d'ensemble, entreprises et filiales, export,
 * suspension, notes internes, lien de mot de passe, départs (comptes supprimés).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { call, idem, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const loginRoute = await import("@/app/api/auth/login/route");
const meRoute = await import("@/app/api/auth/me/route");
const centersRoute = await import("@/app/api/centers/route");
const productsRoute = await import("@/app/api/products/route");
const unitsRoute = await import("@/app/api/units/route");
const companyRoute = await import("@/app/api/company/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const deleteRoute = await import("@/app/api/company/delete/route");
const overviewRoute = await import("@/app/api/platform/overview/route");
const companiesRoute = await import("@/app/api/platform/companies/route");
const companyAdminRoute = await import("@/app/api/platform/companies/[id]/route");
const resetLinkRoute = await import("@/app/api/platform/companies/[id]/reset-link/route");
const deletionsRoute = await import("@/app/api/platform/deletions/route");
const { verifyAuditChain } = await import("@/lib/audit");

const ctx: Json = {};
const DAY = 86_400_000;
const register = async (tradeName: string, email: string, businessType: string) => {
  const r = await call(registerRoute.POST, { path: "/api/auth/register", body: { tradeName, ownerName: "Patron", phone: "97000000", email, password: "Motdepasse1", businessType, city: "Cotonou" } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data.companyId as string;
};
const admin = (handler: Parameters<typeof call>[0], path: string, extra: Partial<Parameters<typeof call>[1]> = {}) => call(handler, { path, cookie: ctx.admin, ...extra });

before(async () => {
  await resetDb();
  ctx.companyId = await register("Roger Doks", "roger@doks.bj", "HARDWARE");
  ctx.owner = await login("roger@doks.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Boutique Akpakpa", code: "AKP" } })).json.data.id;
  await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Boutique Calavi", code: "CAL" } });
  ctx.fifa = await register("Boutique Fifa", "fifa@boutique.bj", "GENERAL");
  ctx.fifaOwner = await login("fifa@boutique.bj");
  await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.fifaOwner, body: { name: "Magasin", code: "MAG" } });

  // Une vente chez Roger Doks
  const unit = (await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner })).json.data[0].id;
  const product = (await call(productsRoute.POST, { path: "/api/products", cookie: ctx.owner, body: { name: "Clou 10", baseUnitId: unit, sellingPrice: 1500, purchasePrice: 1000, stockAlertQty: 0 } })).json.data.id;
  await prisma.stock.create({ data: { centerId: ctx.center, productId: product, quantity: 40, avgCost: 1000 } });
  const reg = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  const open = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.owner, body: { action: "open", cashRegisterId: reg.id, openingBalance: 0 } });
  assert.equal(open.status, 201, JSON.stringify(open.json));
  const sale = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.owner,
    body: { sessionId: open.json.data.id, idempotencyKey: idem(), lines: [{ productId: product, quantity: 2, unitPrice: 1500 }], payments: [{ method: "CASH", amount: 3000 }] },
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));

  await prisma.user.create({ data: { email: "john@fishcore.bj", passwordHash: await passwordHash(), firstName: "John", lastName: "Créateur", role: "PLATFORM_ADMIN" } });
  ctx.admin = await login("john@fishcore.bj");
});

after(async () => {
  await prisma.$disconnect();
});

test("la console est réservée au créateur", async () => {
  for (const [h, path] of [
    [overviewRoute.GET, "/api/platform/overview"],
    [companiesRoute.GET, "/api/platform/companies"],
    [deletionsRoute.GET, "/api/platform/deletions"],
  ] as const) {
    assert.equal((await call(h, { path, cookie: ctx.owner })).status, 403, path);
    assert.equal((await call(h, { path })).status, 401, path);
  }
  const p = await call(companyAdminRoute.GET, { path: `/api/platform/companies/${ctx.fifa}`, cookie: ctx.owner, params: { id: ctx.fifa } });
  assert.equal(p.status, 403, "un client ne voit pas la fiche d'un autre");
  // Le compte du créateur n'a pas d'entreprise : il n'entre pas dans le logiciel des clients
  assert.equal((await call(productsRoute.GET, { path: "/api/products", cookie: ctx.admin })).status, 403);
});

test("vue d'ensemble : entreprises, filiales, utilisateurs, ventes", async () => {
  const o = (await admin(overviewRoute.GET, "/api/platform/overview")).json.data;
  assert.equal(o.companies, 2);
  assert.equal(o.centers, 3);
  assert.equal(o.withSeveralCenters, 1, "Roger Doks a deux filiales");
  assert.equal(o.users, 2);
  assert.equal(o.sales30d.count, 1);
  assert.equal(o.sales30d.amount, 3000);
  assert.equal(o.activeLast7d, 1);
  assert.equal(o.signups30d, 2);
  assert.deepEqual(o.byBusinessType, { HARDWARE: 1, GENERAL: 1 });
  assert.equal(o.signupsByMonth.length, 12);
  assert.equal(o.signupsByMonth.at(-1).count, 2);
  assert.equal(o.recentSignups[0].tradeName, "Boutique Fifa");
});

test("liste : filtres (plusieurs centres, métier, inactives, recherche) et export Excel", async () => {
  const multi = (await admin(companiesRoute.GET, "/api/platform/companies?state=multi")).json.data;
  assert.deepEqual(multi.map((c: Json) => c.tradeName), ["Roger Doks"]);
  assert.equal(multi[0]._count.centers, 2);
  assert.equal(multi[0].activity.sales30d, 1);

  const general = (await admin(companiesRoute.GET, "/api/platform/companies?type=GENERAL")).json.data;
  assert.deepEqual(general.map((c: Json) => c.tradeName), ["Boutique Fifa"]);
  assert.equal((await admin(companiesRoute.GET, "/api/platform/companies?q=doks")).json.data.length, 1);

  // Boutique Fifa sans activité depuis 20 jours → inactive
  await prisma.company.update({ where: { id: ctx.fifa }, data: { createdAt: new Date(Date.now() - 20 * DAY) } });
  await prisma.user.updateMany({ where: { companyId: ctx.fifa }, data: { lastLoginAt: new Date(Date.now() - 20 * DAY) } });
  const inactive = (await admin(companiesRoute.GET, "/api/platform/companies?state=inactive")).json.data;
  assert.deepEqual(inactive.map((c: Json) => c.tradeName), ["Boutique Fifa"]);
  assert.equal((await admin(overviewRoute.GET, "/api/platform/overview")).json.data.inactive, 1);

  const res = await companiesRoute.GET(new NextRequest("http://localhost:3000/api/platform/companies?format=csv", { headers: { cookie: `fishcore-session=${ctx.admin}` } }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  const csv = await res.text();
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Entreprise.*Centres.*Statut/);
  assert.ok(csv.includes('"Roger Doks"') && csv.includes('"Inactive"'));
});

test("fiche : chaque filiale avec ses ventes, son stock, ses caisses", async () => {
  const r = await admin(companyAdminRoute.GET, `/api/platform/companies/${ctx.companyId}`, { params: { id: ctx.companyId } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const c = r.json.data;
  assert.equal(c.centers.length, 2);
  const akp = c.centers.find((x: Json) => x.code === "AKP");
  assert.equal(akp.sales30d, 1);
  assert.equal(akp.revenue30d, 3000);
  assert.equal(akp.openSessions, 1);
  assert.equal(akp.stockArticles, 1);
  assert.equal(akp.stockValue, 38 * 1000);
  assert.equal(c.centers.find((x: Json) => x.code === "CAL").sales30d, 0);
  assert.equal(c.daily.length, 30);
  assert.equal(c.daily.at(-1).amount, 3000);
  assert.equal(c.users[0].email, "roger@doks.bj");
});

test("suspension : déconnexion immédiate ; réactivation ; notes jamais visibles du client", async () => {
  const s = await admin(companyAdminRoute.PATCH, `/api/platform/companies/${ctx.companyId}`, {
    params: { id: ctx.companyId },
    body: { suspend: { reason: "Solde non réglé" }, platformNotes: "Vendu 150 000 F, installé le 30/10" },
    method: "PATCH",
  });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.data.isActive, false);
  assert.equal((await call(meRoute.GET, { path: "/api/auth/me", cookie: ctx.owner })).status, 401);
  assert.notEqual((await call(loginRoute.POST, { path: "/api/auth/login", body: { email: "roger@doks.bj", password: "Motdepasse1" } })).status, 200);
  assert.equal((await admin(overviewRoute.GET, "/api/platform/overview")).json.data.suspended, 1);

  const r = await admin(companyAdminRoute.PATCH, `/api/platform/companies/${ctx.companyId}`, { params: { id: ctx.companyId }, body: { reactivate: true }, method: "PATCH" });
  assert.equal(r.json.data.isActive, true);
  ctx.owner = await login("roger@doks.bj");
  const company = await call(companyRoute.GET, { path: "/api/company", cookie: ctx.owner });
  assert.equal(JSON.stringify(company.json).includes("150 000"), false);

  const types = new Set((await prisma.auditLog.findMany({ where: { companyId: ctx.companyId }, select: { eventType: true } })).map((e) => e.eventType));
  assert.ok(types.has("COMPANY_SUSPENDED") && types.has("COMPANY_REACTIVATED"));
  assert.equal((await verifyAuditChain(ctx.companyId)).isValid, true);
});

test("lien de mot de passe du propriétaire", async () => {
  const link = await admin(resetLinkRoute.POST, `/api/platform/companies/${ctx.companyId}/reset-link`, { params: { id: ctx.companyId }, body: {} });
  assert.equal(link.status, 201);
  assert.match(link.json.data.url, /\/reinitialiser\//);
  assert.equal(link.json.data.owner.email, "roger@doks.bj");
});

test("départs : la raison du client arrive dans la console", async () => {
  const del = await call(deleteRoute.POST, {
    path: "/api/company/delete",
    cookie: ctx.fifaOwner,
    body: { password: "Motdepasse1", confirmName: "Boutique Fifa", reasons: ["missing_features", "other"], otherReason: "Il me faut la gestion des commandes" },
  });
  assert.equal(del.status, 200, JSON.stringify(del.json));

  const d = (await admin(deletionsRoute.GET, "/api/platform/deletions")).json.data;
  assert.equal(d.total, 1);
  assert.deepEqual(d.byReason, { missing_features: 1, other: 1 });
  const row = d.rows[0];
  assert.equal(row.tradeName, "Boutique Fifa");
  assert.equal(row.email, "fifa@boutique.bj");
  assert.equal(row.otherReason, "Il me faut la gestion des commandes");
  assert.equal(row.centersCount, 1);
  assert.equal(row.businessType, "GENERAL");

  const o = (await admin(overviewRoute.GET, "/api/platform/overview")).json.data;
  assert.equal(o.companies, 1);
  assert.equal(o.deletions.total, 1);
  assert.equal(o.deletions.last30d, 1);
  assert.equal(o.deletions.recent[0].tradeName, "Boutique Fifa");
});

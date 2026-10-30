/**
 * Plateforme : essai gratuit, délai de grâce, consultation seule à l'échéance,
 * paiements d'abonnement, limites des offres, suspension, espace administrateur.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const loginRoute = await import("@/app/api/auth/login/route");
const meRoute = await import("@/app/api/auth/me/route");
const centersRoute = await import("@/app/api/centers/route");
const usersRoute = await import("@/app/api/users/route");
const userRoute = await import("@/app/api/users/[id]/route");
const productsRoute = await import("@/app/api/products/route");
const unitsRoute = await import("@/app/api/units/route");
const companyRoute = await import("@/app/api/company/route");
const subscriptionRoute = await import("@/app/api/company/subscription/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const overviewRoute = await import("@/app/api/platform/overview/route");
const companiesRoute = await import("@/app/api/platform/companies/route");
const companyAdminRoute = await import("@/app/api/platform/companies/[id]/route");
const paymentsRoute = await import("@/app/api/platform/companies/[id]/payments/route");
const resetLinkRoute = await import("@/app/api/platform/companies/[id]/reset-link/route");
const plansRoute = await import("@/app/api/platform/plans/route");
const { verifyAuditChain } = await import("@/lib/audit");

const ctx: Json = {};
const DAY = 86_400_000;
const setDates = (data: { trialEndsAt?: Date | null; paidUntil?: Date | null }) => prisma.company.update({ where: { id: ctx.companyId }, data });
const sub = async () => (await call(subscriptionRoute.GET, { path: "/api/company/subscription", cookie: ctx.owner })).json.data;
const mkProduct = (name: string) =>
  call(productsRoute.POST, { path: "/api/products", cookie: ctx.owner, body: { name, baseUnitId: ctx.unit, sellingPrice: 1000, purchasePrice: 0, stockAlertQty: 0 } });

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Roger Doks", ownerName: "Roger Dossou", phone: "97000000", email: "roger@doks.bj", password: "Motdepasse1", businessType: "HARDWARE" },
  });
  assert.equal(reg.status, 201);
  ctx.companyId = reg.json.data.companyId;
  ctx.owner = await login("roger@doks.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Boutique", code: "BTQ" } })).json.data.id;
  ctx.unit = (await call(unitsRoute.GET, { path: "/api/units", cookie: ctx.owner })).json.data[0].id;
  const hash = await passwordHash();
  await prisma.user.create({ data: { email: "admin@fishcore.bj", passwordHash: hash, firstName: "John", lastName: "Admin", role: "PLATFORM_ADMIN" } });
  ctx.admin = await login("admin@fishcore.bj");
  await prisma.user.create({
    data: { email: "caisse@doks.bj", passwordHash: hash, firstName: "Awa", lastName: "C", role: "CASHIER", companyId: ctx.companyId, centers: { create: [{ centerId: ctx.center }] } },
  });
  ctx.cashier = await login("caisse@doks.bj");
});

after(async () => {
  await prisma.$disconnect();
});

test("inscription : 14 jours d'essai gratuit, sans limite", async () => {
  const s = await sub();
  assert.equal(s.status, "TRIAL");
  assert.equal(s.plan.code, "TRIAL");
  assert.ok(s.daysLeft >= 13 && s.daysLeft <= 14, String(s.daysLeft));
  assert.equal(s.limits.maxCenters, null);
  assert.ok(s.plans.length >= 3, "les offres payantes sont proposées");
  const me = await call(meRoute.GET, { path: "/api/auth/me", cookie: ctx.owner });
  assert.equal(me.json.data.subscription.status, "TRIAL");
});

test("espace plateforme : réservé à l'administrateur", async () => {
  assert.equal((await call(overviewRoute.GET, { path: "/api/platform/overview", cookie: ctx.owner })).status, 403);
  const o = await call(overviewRoute.GET, { path: "/api/platform/overview", cookie: ctx.admin });
  assert.equal(o.status, 200, JSON.stringify(o.json));
  assert.equal(o.json.data.total, 1);
  assert.equal(o.json.data.byStatus.TRIAL, 1);
  const list = await call(companiesRoute.GET, { path: "/api/platform/companies?q=doks", cookie: ctx.admin });
  assert.equal(list.json.data.length, 1);
  assert.equal(list.json.data[0].status, "TRIAL");
  assert.equal(list.json.data[0]._count.users, 2);
});

test("échéance dépassée : délai de grâce, tout fonctionne encore", async () => {
  await setDates({ trialEndsAt: new Date(Date.now() - 3 * DAY) });
  assert.equal((await sub()).status, "GRACE");
  const p = await mkProduct("Tôle bac");
  assert.equal(p.status, 201, JSON.stringify(p.json));
  ctx.product = p.json.data.id;
});

test("après le délai de grâce : consultation seule (402), sauf l'essentiel", async () => {
  await setDates({ trialEndsAt: new Date(Date.now() - 10 * DAY) });
  assert.equal((await sub()).status, "EXPIRED");
  const blocked = await mkProduct("Ciment");
  assert.equal(blocked.status, 402);
  assert.equal(blocked.json.code, "SUBSCRIPTION_EXPIRED");
  assert.equal((await call(productsRoute.GET, { path: "/api/products", cookie: ctx.owner })).status, 200, "la consultation reste possible");
  assert.equal((await call(companyRoute.PATCH, { path: "/api/company", cookie: ctx.owner, body: { address: "x" } })).status, 402);

  // Caisse : ouverture et clôture restent possibles, une nouvelle vente non
  const register = await prisma.cashRegister.findFirst({ where: { centerId: ctx.center } });
  const open = await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: register!.id, openingBalance: 0 } });
  assert.equal(open.status, 201, JSON.stringify(open.json));
  ctx.session = open.json.data.id;
  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.product, quantity: 50 } });
  const online = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.cashier,
    body: { sessionId: ctx.session, idempotencyKey: idem(), lines: [{ productId: ctx.product, quantity: 1, unitPrice: 1000 }], payments: [{ method: "CASH", amount: 1000 }] },
  });
  assert.equal(online.status, 402);

  // Vente faite hors connexion AVANT la consultation seule : acceptée à la synchronisation
  await prisma.cashSession.update({ where: { id: ctx.session }, data: { openedAt: new Date(Date.now() - 6 * DAY) } });
  const offline = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.cashier,
    body: {
      sessionId: ctx.session,
      idempotencyKey: idem(),
      createdOffline: true,
      soldAt: new Date(Date.now() - 5 * DAY).toISOString(),
      lines: [{ productId: ctx.product, quantity: 2, unitPrice: 1000 }],
      payments: [{ method: "CASH", amount: 2000 }],
    },
  });
  assert.equal(offline.status, 201, JSON.stringify(offline.json));
  // …mais pas une vente « hors connexion » datée d'après
  const late = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.cashier,
    body: { sessionId: ctx.session, idempotencyKey: idem(), createdOffline: true, soldAt: new Date(Date.now() - DAY).toISOString(), lines: [{ productId: ctx.product, quantity: 1, unitPrice: 1000 }], payments: [{ method: "CASH", amount: 1000 }] },
  });
  assert.equal(late.status, 402);
});

test("paiement enregistré par la plateforme : l'abonnement repart, périodes enchaînées", async () => {
  const denied = await call(paymentsRoute.POST, { path: `/api/platform/companies/${ctx.companyId}/payments`, cookie: ctx.owner, params: { id: ctx.companyId }, body: { planCode: "PRO", months: 1, method: "MOBILE_MONEY" } });
  assert.ok([402, 403].includes(denied.status), "un client ne peut pas s'enregistrer un paiement");
  const trial = await call(paymentsRoute.POST, { path: `/api/platform/companies/${ctx.companyId}/payments`, cookie: ctx.admin, params: { id: ctx.companyId }, body: { planCode: "TRIAL", months: 1, method: "MOBILE_MONEY" } });
  assert.equal(trial.status, 400);

  const p1 = await call(paymentsRoute.POST, {
    path: `/api/platform/companies/${ctx.companyId}/payments`,
    cookie: ctx.admin,
    params: { id: ctx.companyId },
    body: { planCode: "PRO", months: 2, method: "MOBILE_MONEY", reference: "MTN-7788" },
  });
  assert.equal(p1.status, 201, JSON.stringify(p1.json));
  assert.equal(p1.json.data.amount, 50000, "prix de l'offre × mois");
  const s = await sub();
  assert.equal(s.status, "ACTIVE");
  assert.equal(s.plan.code, "PRO");
  assert.ok(s.daysLeft >= 58 && s.daysLeft <= 62, String(s.daysLeft));
  assert.equal((await mkProduct("Ciment")).status, 201, "les ventes et saisies reprennent");

  const p2 = await call(paymentsRoute.POST, { path: `/api/platform/companies/${ctx.companyId}/payments`, cookie: ctx.admin, params: { id: ctx.companyId }, body: { planCode: "PRO", months: 1, amount: 20000, method: "ESPECES" } });
  assert.equal(p2.status, 201);
  assert.equal(new Date(p2.json.data.periodStart).getTime(), new Date(p1.json.data.periodEnd).getTime(), "la période suivante démarre à la fin de la précédente");
  assert.equal((await sub()).payments.length, 2);

  const o = await call(overviewRoute.GET, { path: "/api/platform/overview", cookie: ctx.admin });
  assert.equal(o.json.data.mrr, 25000);
  assert.equal(o.json.data.paidThisMonth.amount, 70000);
});

test("limites de l'offre : centres et utilisateurs", async () => {
  // PRO : 3 centres — déjà 1
  for (const code of ["MAG2", "DEP"]) {
    const r = await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: code, code } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  const over = await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Quatrième", code: "Q4" } });
  assert.equal(over.status, 403);
  assert.equal(over.json.code, "PLAN_LIMIT_CENTERS");

  // Limite particulière fixée par la plateforme : 2 utilisateurs actifs (déjà 2)
  const lim = await call(companyAdminRoute.PATCH, { path: `/api/platform/companies/${ctx.companyId}`, cookie: ctx.admin, params: { id: ctx.companyId }, body: { customMaxUsers: 2 } });
  assert.equal(lim.status, 200, JSON.stringify(lim.json));
  const u = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { firstName: "Paul", lastName: "V", email: "paul@doks.bj", role: "SALES_EMPLOYEE", centerIds: [ctx.center], password: "Provisoire1" } });
  assert.equal(u.status, 403);
  assert.equal(u.json.code, "PLAN_LIMIT_USERS");
  const cashierId = (await prisma.user.findUniqueOrThrow({ where: { email: "caisse@doks.bj" } })).id;
  await call(userRoute.PATCH, { path: `/api/users/${cashierId}`, cookie: ctx.owner, params: { id: cashierId }, body: { isActive: false } });
  assert.equal((await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { firstName: "Paul", lastName: "V", email: "paul@doks.bj", role: "SALES_EMPLOYEE", centerIds: [ctx.center], password: "Provisoire1" } })).status, 201);
  const react = await call(userRoute.PATCH, { path: `/api/users/${cashierId}`, cookie: ctx.owner, params: { id: cashierId }, body: { isActive: true } });
  assert.equal(react.status, 403, "réactiver dépasserait la limite");
  await call(companyAdminRoute.PATCH, { path: `/api/platform/companies/${ctx.companyId}`, cookie: ctx.admin, params: { id: ctx.companyId }, body: { customMaxUsers: null } });
});

test("suspension : déconnexion immédiate, connexion refusée ; réactivation", async () => {
  const s = await call(companyAdminRoute.PATCH, { path: `/api/platform/companies/${ctx.companyId}`, cookie: ctx.admin, params: { id: ctx.companyId }, body: { suspend: { reason: "Impayé depuis 2 mois" }, platformNotes: "Relancé par WhatsApp le 30/10" } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.data.status, "SUSPENDED");
  assert.equal((await call(meRoute.GET, { path: "/api/auth/me", cookie: ctx.owner })).status, 401);
  assert.notEqual((await call(loginRoute.POST, { path: "/api/auth/login", body: { email: "roger@doks.bj", password: "Motdepasse1" } })).status, 200);

  const r = await call(companyAdminRoute.PATCH, { path: `/api/platform/companies/${ctx.companyId}`, cookie: ctx.admin, params: { id: ctx.companyId }, body: { reactivate: true } });
  assert.equal(r.json.data.status, "ACTIVE");
  ctx.owner = await login("roger@doks.bj");
  // Les notes internes ne sont jamais montrées au client
  const company = await call(companyRoute.GET, { path: "/api/company", cookie: ctx.owner });
  assert.equal(JSON.stringify(company.json).includes("Relancé"), false);
});

test("essai prolongé, offres modifiables, lien de mot de passe du patron", async () => {
  const ext = await call(companyAdminRoute.PATCH, { path: `/api/platform/companies/${ctx.companyId}`, cookie: ctx.admin, params: { id: ctx.companyId }, body: { extendTrialDays: 30 } });
  assert.equal(ext.status, 200);
  assert.ok(new Date(ext.json.data.trialEndsAt).getTime() > Date.now() + 29 * DAY);

  const plans = (await call(plansRoute.GET, { path: "/api/platform/plans", cookie: ctx.admin })).json.data;
  const edited = plans.map((p: Json) => (p.code === "PRO" ? { ...p, monthlyPrice: 30000, maxCenters: 5 } : p.code === "TRIAL" ? { ...p, isActive: true } : p));
  const put = await call(plansRoute.PUT, { path: "/api/platform/plans", cookie: ctx.admin, body: { plans: edited } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const pro = put.json.data.find((p: Json) => p.code === "PRO");
  assert.deepEqual([pro.monthlyPrice, pro.maxCenters, pro._count.companies], [30000, 5, 1]);
  assert.equal(put.json.data.find((p: Json) => p.code === "TRIAL").isActive, false, "l'essai ne se vend pas");
  assert.equal((await call(plansRoute.PUT, { path: "/api/platform/plans", cookie: ctx.owner, body: { plans: edited } })).status, 403);

  const link = await call(resetLinkRoute.POST, { path: `/api/platform/companies/${ctx.companyId}/reset-link`, cookie: ctx.admin, params: { id: ctx.companyId }, body: {} });
  assert.equal(link.status, 201);
  assert.match(link.json.data.url, /\/reinitialiser\//);
  assert.equal(link.json.data.owner.email, "roger@doks.bj");
});

test("journal de l'entreprise : actions de la plateforme tracées, chaîne intègre", async () => {
  const types = new Set((await prisma.auditLog.findMany({ where: { companyId: ctx.companyId }, select: { eventType: true } })).map((e) => e.eventType));
  for (const t of ["SUBSCRIPTION_PAYMENT_RECORDED", "SUBSCRIPTION_CHANGED", "COMPANY_SUSPENDED", "COMPANY_REACTIVATED"]) assert.ok(types.has(t as never), `${t} manquant`);
  assert.equal((await verifyAuditChain(ctx.companyId)).isValid, true);
});

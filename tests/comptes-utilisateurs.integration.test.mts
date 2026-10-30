/**
 * Mots de passe (lien de réinitialisation, changement), gestion des comptes
 * (rôle, désactivation) et consultation du journal d'audit.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const loginRoute = await import("@/app/api/auth/login/route");
const centersRoute = await import("@/app/api/centers/route");
const meRoute = await import("@/app/api/auth/me/route");
const resetLinkRoute = await import("@/app/api/users/[id]/reset-link/route");
const resetRoute = await import("@/app/api/auth/password-reset/route");
const passwordRoute = await import("@/app/api/auth/password/route");
const userRoute = await import("@/app/api/users/[id]/route");
const auditRoute = await import("@/app/api/audit/route");
const auditVerifyRoute = await import("@/app/api/audit/verify/route");
const { verifyAuditChain } = await import("@/lib/audit");

const ctx: Json = {};
const tokenOf = (url: string) => url.split("/reinitialiser/")[1];
const me = (cookie: string) => call(meRoute.GET, { path: "/api/auth/me", cookie });
const tryLogin = (email: string, password: string) => call(loginRoute.POST, { path: "/api/auth/login", body: { email, password } });

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Roger Doks", ownerName: "Roger", phone: "97000000", email: "roger@doks.bj", password: "Motdepasse1", businessType: "GENERAL" },
  });
  assert.equal(reg.status, 201);
  ctx.companyId = reg.json.data.companyId;
  ctx.owner = await login("roger@doks.bj");
  ctx.ownerId = (await me(ctx.owner)).json.data.user.id;
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Boutique", code: "BTQ" } })).json.data.id;
  const hash = await passwordHash();
  for (const [key, role] of [["caissier", "CASHIER"], ["gerant", "CENTER_MANAGER"]] as const) {
    const u = await prisma.user.create({
      data: { email: `${key}@doks.bj`, passwordHash: hash, firstName: key, lastName: "T", phone: "+229 97 11 22 33", role, companyId: ctx.companyId, centers: { create: [{ centerId: ctx.center }] } },
    });
    ctx[`${key}Id`] = u.id;
    ctx[key] = await login(u.email);
  }
});

after(async () => {
  await prisma.$disconnect();
});

test("lien de mot de passe : droits", async () => {
  const byCashier = await call(resetLinkRoute.POST, { path: `/api/users/${ctx.gerantId}/reset-link`, cookie: ctx.caissier, params: { id: ctx.gerantId }, body: {} });
  assert.equal(byCashier.status, 403);
  // Le gérant n'a pas le droit de modifier les comptes (réservé au propriétaire ici)
  const byManager = await call(resetLinkRoute.POST, { path: `/api/users/${ctx.ownerId}/reset-link`, cookie: ctx.gerant, params: { id: ctx.ownerId }, body: {} });
  assert.equal(byManager.status, 403);
});

test("lien de mot de passe : usage unique, sessions fermées, ancien lien annulé", async () => {
  const first = await call(resetLinkRoute.POST, { path: `/api/users/${ctx.caissierId}/reset-link`, cookie: ctx.owner, params: { id: ctx.caissierId }, body: {} });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const second = await call(resetLinkRoute.POST, { path: `/api/users/${ctx.caissierId}/reset-link`, cookie: ctx.owner, params: { id: ctx.caissierId }, body: {} });
  assert.match(second.json.data.url, /\/reinitialiser\/[A-Za-z0-9_-]{40,}$/);

  // Le premier lien ne marche plus
  const old = await call(resetRoute.GET, { path: `/api/auth/password-reset?token=${tokenOf(first.json.data.url)}` });
  assert.equal(old.status, 400);

  const token = tokenOf(second.json.data.url);
  const check = await call(resetRoute.GET, { path: `/api/auth/password-reset?token=${token}` });
  assert.equal(check.status, 200);
  assert.equal(check.json.data.firstName, "caissier");
  assert.equal(check.json.data.companyName, "Roger Doks");

  const weak = await call(resetRoute.POST, { path: "/api/auth/password-reset", body: { token, password: "court" } });
  assert.equal(weak.status, 400);

  const ok = await call(resetRoute.POST, { path: "/api/auth/password-reset", body: { token, password: "Nouveau2026" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const reuse = await call(resetRoute.POST, { path: "/api/auth/password-reset", body: { token, password: "Autre2026x" } });
  assert.equal(reuse.status, 400);

  assert.equal((await me(ctx.caissier)).status, 401, "les sessions ouvertes sont fermées");
  assert.equal((await tryLogin("caissier@doks.bj", "Motdepasse1")).status, 401);
  assert.equal((await tryLogin("caissier@doks.bj", "Nouveau2026")).status, 200);
  ctx.caissier = await login("caissier@doks.bj", "Nouveau2026");

  // Seule l'empreinte du jeton est stockée
  const stored = await prisma.passwordResetToken.findMany({ where: { userId: ctx.caissierId } });
  assert.equal(stored.some((t) => t.tokenHash === token), false);
});

test("lien de mot de passe : expiré", async () => {
  const link = await call(resetLinkRoute.POST, { path: `/api/users/${ctx.gerantId}/reset-link`, cookie: ctx.owner, params: { id: ctx.gerantId }, body: {} });
  await prisma.passwordResetToken.updateMany({ where: { userId: ctx.gerantId, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const r = await call(resetRoute.POST, { path: "/api/auth/password-reset", body: { token: tokenOf(link.json.data.url), password: "Nouveau2026" } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "RESET_LINK_INVALID");
});

test("changer son mot de passe : les autres appareils sont déconnectés", async () => {
  const otherDevice = await login("roger@doks.bj");
  const wrong = await call(passwordRoute.POST, { path: "/api/auth/password", cookie: ctx.owner, body: { currentPassword: "faux", newPassword: "Proprio2026", confirmPassword: "Proprio2026" } });
  assert.equal(wrong.status, 400);
  const mismatch = await call(passwordRoute.POST, { path: "/api/auth/password", cookie: ctx.owner, body: { currentPassword: "Motdepasse1", newPassword: "Proprio2026", confirmPassword: "Proprio2027" } });
  assert.equal(mismatch.status, 400);
  const ok = await call(passwordRoute.POST, { path: "/api/auth/password", cookie: ctx.owner, body: { currentPassword: "Motdepasse1", newPassword: "Proprio2026", confirmPassword: "Proprio2026" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await me(ctx.owner)).status, 200, "cet appareil reste connecté");
  assert.equal((await me(otherDevice)).status, 401, "l'autre appareil est déconnecté");
});

test("comptes : désactivation immédiate, réactivation, garde-fous", async () => {
  const self = await call(userRoute.PATCH, { path: `/api/users/${ctx.ownerId}`, cookie: ctx.owner, params: { id: ctx.ownerId }, body: { isActive: false } });
  assert.equal(self.status, 400);
  const byCashier = await call(userRoute.PATCH, { path: `/api/users/${ctx.gerantId}`, cookie: ctx.caissier, params: { id: ctx.gerantId }, body: { firstName: "X" } });
  assert.equal(byCashier.status, 403);

  const off = await call(userRoute.PATCH, { path: `/api/users/${ctx.caissierId}`, cookie: ctx.owner, params: { id: ctx.caissierId }, body: { isActive: false } });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.equal((await me(ctx.caissier)).status, 401);
  assert.notEqual((await tryLogin("caissier@doks.bj", "Nouveau2026")).status, 200);

  const on = await call(userRoute.PATCH, { path: `/api/users/${ctx.caissierId}`, cookie: ctx.owner, params: { id: ctx.caissierId }, body: { isActive: true, role: "SALES_EMPLOYEE", phone: "" } });
  assert.equal(on.status, 200);
  assert.equal(on.json.data.role, "SALES_EMPLOYEE");
  assert.equal(on.json.data.phone, null);
  assert.equal((await tryLogin("caissier@doks.bj", "Nouveau2026")).status, 200);

  // L'entreprise garde toujours un propriétaire actif
  const promote = await call(userRoute.PATCH, { path: `/api/users/${ctx.gerantId}`, cookie: ctx.owner, params: { id: ctx.gerantId }, body: { role: "COMPANY_OWNER" } });
  assert.equal(promote.status, 200);
  const gerantOwner = await login("gerant@doks.bj");
  const demote = await call(userRoute.PATCH, { path: `/api/users/${ctx.ownerId}`, cookie: gerantOwner, params: { id: ctx.ownerId }, body: { role: "CASHIER", centerIds: [ctx.center] } });
  assert.equal(demote.status, 200, "un autre propriétaire reste");
  const last = await call(userRoute.PATCH, { path: `/api/users/${ctx.gerantId}`, cookie: ctx.owner, params: { id: ctx.gerantId }, body: { isActive: false } });
  assert.equal(last.status, 403, "un caissier ne touche pas à un propriétaire");
  // Remise en état
  await call(userRoute.PATCH, { path: `/api/users/${ctx.ownerId}`, cookie: gerantOwner, params: { id: ctx.ownerId }, body: { role: "COMPANY_OWNER" } });
  const lastOwnerOff = await call(userRoute.PATCH, { path: `/api/users/${ctx.ownerId}`, cookie: gerantOwner, params: { id: ctx.ownerId }, body: { isActive: false } });
  assert.equal(lastOwnerOff.status, 200);
  const nowLast = await call(userRoute.PATCH, { path: `/api/users/${ctx.gerantId}`, cookie: gerantOwner, params: { id: ctx.gerantId }, body: { role: "CASHIER", centerIds: [ctx.center] } });
  assert.equal(nowLast.status, 400, "ne peut pas changer son propre rôle");
  ctx.lastOwner = gerantOwner;
});

test("journal d'audit : consultation filtrée, réservée, intègre", async () => {
  const cashier = await login("caissier@doks.bj", "Nouveau2026");
  assert.equal((await call(auditRoute.GET, { path: "/api/audit", cookie: cashier })).status, 403);

  const all = await call(auditRoute.GET, { path: "/api/audit", cookie: ctx.lastOwner });
  assert.equal(all.status, 200, JSON.stringify(all.json));
  assert.ok(all.json.data.length > 5);
  const types = new Set(all.json.data.map((e: Json) => e.eventType));
  for (const t of ["PASSWORD_RESET_LINK_CREATED", "PASSWORD_CHANGED", "USER_DEACTIVATED", "USER_REACTIVATED", "ROLE_CHANGED"]) assert.ok(types.has(t), `${t} manquant`);

  const onlyPwd = await call(auditRoute.GET, { path: "/api/audit?eventType=PASSWORD_CHANGED", cookie: ctx.lastOwner });
  assert.ok(onlyPwd.json.data.every((e: Json) => e.eventType === "PASSWORD_CHANGED"));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo" }).format(new Date());
  const dated = await call(auditRoute.GET, { path: `/api/audit?from=${today}&to=${today}`, cookie: ctx.lastOwner });
  assert.equal(dated.json.data.length, all.json.data.length);
  const past = await call(auditRoute.GET, { path: "/api/audit?from=2020-01-01&to=2020-01-02", cookie: ctx.lastOwner });
  assert.equal(past.json.data.length, 0);

  const v = await call(auditVerifyRoute.GET, { path: "/api/audit/verify", cookie: ctx.lastOwner });
  assert.equal(v.json.data.isValid, true);
  assert.equal((await verifyAuditChain(ctx.companyId)).isValid, true);
});

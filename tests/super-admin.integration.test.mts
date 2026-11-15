/**
 * Super administrateur unique, créé avec le code d'installation.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const CODE = "47*9#3*1";
process.env.SETUP_CODE_HASH = crypto.createHash("sha256").update(CODE).digest("hex");

const startRoute = await import("@/app/api/auth/start/route");
const checkRoute = await import("@/app/api/auth/setup/check/route");
const setupRoute = await import("@/app/api/auth/setup/route");
const meRoute = await import("@/app/api/auth/me/route");
const centersRoute = await import("@/app/api/centers/route");
const invitesRoute = await import("@/app/api/invitations/route");
const usersRoute = await import("@/app/api/users/route");

const ctx: Json = {};
const ADMIN = "patron@exemple.com";
const COMPANY = { tradeName: "GRACES JUMELLES HOUSE", ownerName: "Eustache Adjaho", phone: "+229 01 61 87 13 83", city: "Abomey-Calavi" };

async function setup(body: Json) {
  const req = new NextRequest("http://localhost:3000/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const res = await setupRoute.POST(req);
  return { status: res.status, json: (await res.json()) as Json, cookie: (res as unknown as { cookies: { get: (n: string) => { value: string } | undefined } }).cookies.get("fishcore-session")?.value };
}

before(async () => {
  await resetDb();
});
after(async () => {
  delete process.env.SETUP_CODE_HASH;
  await prisma.$disconnect();
});

test("base vide : la 1re adresse doit donner le code d'installation", async () => {
  const r = await call(startRoute.POST, { path: "/api/auth/start", body: { email: ADMIN } });
  assert.equal(r.json.data.mode, "setup");
});

test("mauvais code : refusé, rien n'est créé", async () => {
  const r = await call(checkRoute.POST, { path: "/api/auth/setup/check", body: { email: ADMIN, code: "11111111" } });
  assert.equal(r.status, 400);
  const s = await setup({ email: ADMIN, code: "12*4#678", password: "Motdepasse1", company: COMPANY });
  assert.equal(s.status, 400);
  assert.equal(await prisma.company.count(), 0);
  assert.equal(await prisma.user.count(), 0);
});

test("bon code : super administrateur + entreprise, connecté directement", async () => {
  const c = await call(checkRoute.POST, { path: "/api/auth/setup/check", body: { email: ADMIN, code: CODE } });
  assert.equal(c.status, 200);
  assert.equal(c.json.data.mode, "install");
  const s = await setup({ email: ADMIN, code: CODE, password: "Motdepasse1", company: COMPANY });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal(s.json.data.next, "/onboarding");
  assert.ok(s.cookie);
  ctx.admin = s.cookie;
  const u = await prisma.user.findUnique({ where: { email: ADMIN }, include: { company: true } });
  assert.equal(u?.role, "COMPANY_OWNER");
  assert.equal(u?.isSuperAdmin, true);
  assert.equal(u?.company?.tradeName, "GRACES JUMELLES HOUSE");
  assert.equal(u?.company?.invoicePrefix, "GJH");
  assert.equal(u?.company?.invoiceFormat, "TICKET_80");
  const me = await call(meRoute.GET, { path: "/api/auth/me", cookie: ctx.admin });
  assert.equal(me.json.data.user.role, "COMPANY_OWNER");
});

test("ensuite : connexion normale avec son mot de passe ; le code ne recrée rien", async () => {
  const r = await call(startRoute.POST, { path: "/api/auth/start", body: { email: "autre@exemple.com" } });
  assert.equal(r.json.data.mode, "password");
  await login(ADMIN, "Motdepasse1");
  const other = await setup({ email: "autre@exemple.com", code: CODE, password: "Motdepasse1", company: COMPANY });
  assert.equal(other.status, 403);
  assert.equal(await prisma.company.count(), 1);
});

test("mot de passe oublié : le code d'installation le redéfinit", async () => {
  const c = await call(checkRoute.POST, { path: "/api/auth/setup/check", body: { email: ADMIN, code: CODE } });
  assert.equal(c.json.data.mode, "reset");
  const s = await setup({ email: ADMIN, code: CODE, password: "Nouveau2026" });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  ctx.admin = s.cookie;
  await login(ADMIN, "Nouveau2026");
});

test("il crée les codes des employés, mais aucun autre super administrateur", async () => {
  const center = await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.admin, body: { name: "Huile de moteur", code: "MOT" } });
  assert.equal(center.status, 201, JSON.stringify(center.json));
  const cashier = await call(invitesRoute.POST, { path: "/api/invitations", cookie: ctx.admin, body: { kind: "link", role: "CASHIER", centerId: center.json.data.id } });
  assert.equal(cashier.status, 201, JSON.stringify(cashier.json));
  const owner = await call(invitesRoute.POST, { path: "/api/invitations", cookie: ctx.admin, body: { kind: "link", role: "COMPANY_OWNER" } });
  assert.equal(owner.status, 403);
  const direct = await call(usersRoute.POST, {
    path: "/api/users",
    cookie: ctx.admin,
    body: { email: "autre@exemple.com", password: "Motdepasse1", firstName: "Autre", lastName: "Patron", role: "COMPANY_OWNER", centerIds: [center.json.data.id] },
  });
  assert.equal(direct.status, 403, JSON.stringify(direct.json));
  assert.equal(await prisma.user.count({ where: { role: "COMPANY_OWNER" } }), 1);
});

test("trop de mauvais codes : bloqué une heure", async () => {
  for (let i = 0; i < 12; i++) await call(checkRoute.POST, { path: "/api/auth/setup/check", body: { email: ADMIN, code: "00000000" } });
  const r = await call(checkRoute.POST, { path: "/api/auth/setup/check", body: { email: ADMIN, code: CODE } });
  assert.equal(r.status, 429);
});

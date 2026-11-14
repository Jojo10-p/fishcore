/**
 * Super administrateur unique : connexion sans mot de passe, par code reçu par e-mail.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

process.env.MAIL_TRANSPORT = "memory";
process.env.SUPER_ADMIN_EMAIL = "Patron@Exemple.com";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const requestRoute = await import("@/app/api/auth/code/request/route");
const verifyRoute = await import("@/app/api/auth/code/verify/route");
const loginRoute = await import("@/app/api/auth/login/route");
const meRoute = await import("@/app/api/auth/me/route");
const invitesRoute = await import("@/app/api/invitations/route");
const usersRoute = await import("@/app/api/users/route");
const { outbox } = await import("@/lib/mailer");

const ctx: Json = {};
const ADMIN = "patron@exemple.com";
const lastCode = () => {
  const m = outbox.at(-1)!.text.match(/code de connexion : ([A-Z0-9]{4}) ([A-Z0-9]{4})/);
  assert.ok(m, "code dans le mail");
  return m[1] + m[2];
};
async function verify(email: string, code: string) {
  const req = new NextRequest("http://localhost:3000/api/auth/code/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, code }) });
  const res = await verifyRoute.POST(req);
  return { status: res.status, json: (await res.json()) as Json, cookie: (res as unknown as { cookies: { get: (n: string) => { value: string } | undefined } }).cookies.get("fishcore-session")?.value };
}

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "GRACES JUMELLES HOUSE", ownerName: "Direction GJH", phone: "97000000", email: "direction@gjh.bj", password: "Motdepasse1", businessType: "LUBRICANTS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.company = reg.json.data?.company?.id ?? (await prisma.company.findFirst({ select: { id: true } }))!.id;
  const owner = await login("direction@gjh.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: owner, body: { name: "Boutique Adjagbo", code: "ADJ" } })).json.data.id;
  // Base remise à zéro pour la livraison : plus aucun compte
  await prisma.$executeRawUnsafe(`ALTER TABLE "audit_logs" DISABLE TRIGGER USER`);
  await prisma.authSession.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$executeRawUnsafe(`ALTER TABLE "audit_logs" ENABLE TRIGGER USER`);
});

after(async () => {
  delete process.env.SUPER_ADMIN_EMAIL;
  await prisma.$disconnect();
});

test("une adresse ordinaire passe au mot de passe, sans e-mail envoyé", async () => {
  const r = await call(requestRoute.POST, { path: "/api/auth/code/request", body: { email: "caisse@exemple.com" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.mode, "password");
  assert.equal(outbox.length, 0);
});

test("le super admin reçoit un code de 8 caractères par e-mail", async () => {
  const r = await call(requestRoute.POST, { path: "/api/auth/code/request", body: { email: "PATRON@exemple.com " } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.mode, "code");
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, ADMIN);
  ctx.code = lastCode();
  assert.equal(ctx.code.length, 8);
  const stored = await prisma.loginCode.findFirst({ where: { email: ADMIN } });
  assert.ok(stored && stored.codeHash !== ctx.code && !stored.codeHash.includes(ctx.code), "le code n'est pas stocké en clair");
});

test("pas de nouveau code avant 60 s", async () => {
  const r = await call(requestRoute.POST, { path: "/api/auth/code/request", body: { email: ADMIN } });
  assert.equal(r.status, 429);
  assert.equal(outbox.length, 1);
});

test("mauvais code : refusé, essais comptés", async () => {
  const r = await verify(ADMIN, "AAAA2222");
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Encore 4 essais/);
  assert.equal(r.cookie, undefined);
});

test("bon code (tapé en minuscules avec espace) : connecté comme super administrateur", async () => {
  const typed = `${ctx.code.slice(0, 4).toLowerCase()} ${ctx.code.slice(4)}`;
  const r = await verify(ADMIN, typed);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.cookie);
  ctx.admin = r.cookie;
  const u = await prisma.user.findUnique({ where: { email: ADMIN } });
  assert.equal(u?.role, "COMPANY_OWNER");
  assert.equal(u?.companyId, ctx.company);
  const me = await call(meRoute.GET, { path: "/api/auth/me", cookie: ctx.admin });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.user.role, "COMPANY_OWNER");
});

test("le code ne sert qu'une fois", async () => {
  const r = await verify(ADMIN, ctx.code);
  assert.equal(r.status, 400);
});

test("5 mauvais essais annulent le code", async () => {
  await prisma.loginCode.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await call(requestRoute.POST, { path: "/api/auth/code/request", body: { email: ADMIN } })).status, 200);
  const good = lastCode();
  for (let i = 0; i < 5; i++) assert.equal((await verify(ADMIN, "ZZZZ9999")).status, 400);
  assert.equal((await verify(ADMIN, good)).status, 400, "même le bon code est refusé ensuite");
});

test("le super admin ne peut pas se connecter avec un mot de passe", async () => {
  const req = new NextRequest("http://localhost:3000/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: ADMIN, password: "nimportequoi" }) });
  const res = await loginRoute.POST(req);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as Json).code, "USE_EMAIL_CODE");
});

test("il crée les codes des employés, mais aucun autre super administrateur", async () => {
  const cashier = await call(invitesRoute.POST, { path: "/api/invitations", cookie: ctx.admin, body: { kind: "link", role: "CASHIER", centerId: ctx.center } });
  assert.equal(cashier.status, 201, JSON.stringify(cashier.json));
  const stock = await call(invitesRoute.POST, { path: "/api/invitations", cookie: ctx.admin, body: { kind: "link", role: "STOCK_MANAGER", centerId: ctx.center } });
  assert.equal(stock.status, 201);
  const owner = await call(invitesRoute.POST, { path: "/api/invitations", cookie: ctx.admin, body: { kind: "link", role: "COMPANY_OWNER" } });
  assert.equal(owner.status, 403, JSON.stringify(owner.json));
  const direct = await call(usersRoute.POST, {
    path: "/api/users",
    cookie: ctx.admin,
    body: { email: "autre@exemple.com", password: "Motdepasse1", firstName: "Autre", lastName: "Patron", role: "COMPANY_OWNER", centerIds: [ctx.center] },
  });
  assert.equal(direct.status, 403, JSON.stringify(direct.json));
  assert.equal(await prisma.user.count({ where: { role: "COMPANY_OWNER" } }), 1);
});

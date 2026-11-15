/**
 * Changer d'adresse e-mail : soi-même (mot de passe demandé) ou celle d'un employé.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const usersRoute = await import("@/app/api/users/route");
const userRoute = await import("@/app/api/users/[id]/route");
const emailRoute = await import("@/app/api/auth/email/route");
const { waitForNotifications } = await import("@/lib/notify");

const ctx: Json = {};

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Boutique Test", ownerName: "Direction Test", phone: "97000000", email: "direction@test.bj", password: "Motdepasse1", businessType: "LUBRICANTS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.owner = await login("direction@test.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Calavi", code: "CAL" } })).json.data.id;
  const r = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email: "caisse@test.bj", password: "Motdepasse1", firstName: "Samson", lastName: "Test", role: "CASHIER", centerIds: [ctx.center] } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  ctx.cashierId = r.json.data.id;
});
after(async () => {
  await waitForNotifications();
  await prisma.$disconnect();
});

test("mauvais mot de passe : refusé", async () => {
  const r = await call(emailRoute.POST, { path: "/api/auth/email", cookie: ctx.owner, body: { newEmail: "patron@test.bj", password: "Faux12345" } });
  assert.equal(r.status, 400);
});

test("adresse déjà prise : refusé", async () => {
  const r = await call(emailRoute.POST, { path: "/api/auth/email", cookie: ctx.owner, body: { newEmail: "caisse@test.bj", password: "Motdepasse1" } });
  assert.equal(r.status, 409);
});

test("le patron change son adresse et se connecte avec la nouvelle", async () => {
  const r = await call(emailRoute.POST, { path: "/api/auth/email", cookie: ctx.owner, body: { newEmail: " Patron@Test.bj ", password: "Motdepasse1" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.email, "patron@test.bj");
  ctx.owner = await login("patron@test.bj");
  assert.ok(ctx.owner);
  assert.equal(await prisma.user.count({ where: { email: "direction@test.bj" } }), 0);
});

test("le patron change l'adresse d'un employé (pas la sienne par ce chemin)", async () => {
  const r = await call(userRoute.PATCH, { path: `/api/users/${ctx.cashierId}`, method: "PATCH", cookie: ctx.owner, params: { id: ctx.cashierId }, body: { email: "samson@test.bj" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.email, "samson@test.bj");
  await login("samson@test.bj");
  const me = await prisma.user.findFirstOrThrow({ where: { email: "patron@test.bj" } });
  const self = await call(userRoute.PATCH, { path: `/api/users/${me.id}`, method: "PATCH", cookie: ctx.owner, params: { id: me.id }, body: { email: "autre@test.bj" } });
  assert.equal(self.status, 400);
  const taken = await call(userRoute.PATCH, { path: `/api/users/${ctx.cashierId}`, method: "PATCH", cookie: ctx.owner, params: { id: ctx.cashierId }, body: { email: "patron@test.bj" } });
  assert.equal(taken.status, 409);
});

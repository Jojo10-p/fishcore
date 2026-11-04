/**
 * Création de compte par invitation (lien WhatsApp) et connexion avec Google.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const usersRoute = await import("@/app/api/users/route");
const invitesRoute = await import("@/app/api/invitations/route");
const inviteIdRoute = await import("@/app/api/invitations/[id]/route");
const acceptRoute = await import("@/app/api/invitations/accept/route");
const meRoute = await import("@/app/api/auth/me/route");
const providersRoute = await import("@/app/api/auth/providers/route");
const gStart = await import("@/app/api/auth/google/start/route");
const gCallback = await import("@/app/api/auth/google/callback/route");

const ctx: Json = {};
const tokenOf = (url: string) => url.split("/").pop()!;
const invite = async (cookie: string, body: Json) => call(invitesRoute.POST, { path: "/api/invitations", cookie, body });

before(async () => {
  await resetDb();
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "GRACES JUMELLES HOUSE", ownerName: "Direction GJH", phone: "97000000", email: "direction@gjh.bj", password: "Motdepasse1", businessType: "LUBRICANTS" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  ctx.owner = await login("direction@gjh.bj");
  ctx.center = (await call(centersRoute.POST, { path: "/api/centers", cookie: ctx.owner, body: { name: "Boutique Adjagbo", code: "ADJ" } })).json.data.id;
});

after(async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  await prisma.$disconnect();
});

test("le patron crée un lien pour un caissier ; le lien dit pour quel poste", async () => {
  const r = await invite(ctx.owner, { role: "CASHIER", centerId: ctx.center, label: "Rachidi" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.data.url, /\/rejoindre\/[A-Za-z0-9_-]{30,}$/);
  ctx.cashierToken = tokenOf(r.json.data.url);
  const info = await call(acceptRoute.GET, { path: `/api/invitations/accept?token=${ctx.cashierToken}` });
  assert.equal(info.status, 200);
  assert.equal(info.json.data.companyName, "GRACES JUMELLES HOUSE");
  assert.equal(info.json.data.roleName, "Caissier");
  assert.equal(info.json.data.centerName, "Boutique Adjagbo");
  assert.equal(info.json.data.label, "Rachidi");
  const list = await call(invitesRoute.GET, { path: "/api/invitations", cookie: ctx.owner });
  assert.equal(list.json.data.length, 1);
});

test("le caissier crée son compte avec le lien et est connecté tout de suite", async () => {
  const req = new NextRequest("http://localhost:3000/api/invitations/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: ctx.cashierToken, firstName: "Rachidi", lastName: "Bello", email: "Rachidi@Exemple.com", password: "monmotdepasse" }),
  });
  const res = await acceptRoute.POST(req);
  assert.equal(res.status, 201, await res.clone().text());
  const cookie = (res as unknown as { cookies: { get: (n: string) => { value: string } | undefined } }).cookies.get("fishcore-session")?.value;
  assert.ok(cookie, "session ouverte");
  const me = await call(meRoute.GET, { path: "/api/auth/me", cookie });
  assert.equal(me.status, 200);
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "rachidi@exemple.com" }, include: { centers: true } });
  assert.equal(u.role, "CASHIER");
  assert.deepEqual(u.centers.map((c) => c.centerId), [ctx.center]);
  // il pourra se reconnecter avec son mot de passe
  assert.ok(await login("rachidi@exemple.com", "monmotdepasse"));
  ctx.cashier = cookie;
});

test("un lien ne sert qu'une fois", async () => {
  const r = await call(acceptRoute.POST, { path: "/api/invitations/accept", body: { token: ctx.cashierToken, firstName: "X", lastName: "Y", email: "autre@exemple.com", password: "monmotdepasse" } });
  assert.equal(r.status, 410);
  assert.match(r.json.error, /déjà servi/);
  assert.equal((await call(invitesRoute.GET, { path: "/api/invitations", cookie: ctx.owner })).json.data.length, 0);
});

test("e-mail déjà utilisé, lien annulé, lien expiré", async () => {
  const a = await invite(ctx.owner, { role: "CENTER_MANAGER", centerId: ctx.center });
  const t = tokenOf(a.json.data.url);
  const dup = await call(acceptRoute.POST, { path: "/api/invitations/accept", body: { token: t, firstName: "F", lastName: "D", email: "direction@gjh.bj", password: "monmotdepasse" } });
  assert.equal(dup.status, 409);
  const rev = await call(inviteIdRoute.DELETE, { path: `/api/invitations/${a.json.data.id}`, method: "DELETE", cookie: ctx.owner, params: { id: a.json.data.id } });
  assert.equal(rev.status, 200);
  assert.equal((await call(acceptRoute.GET, { path: `/api/invitations/accept?token=${t}` })).status, 404);
  const b = await invite(ctx.owner, { role: "CASHIER", centerId: ctx.center });
  await prisma.invitation.update({ where: { id: b.json.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const exp = await call(acceptRoute.GET, { path: `/api/invitations/accept?token=${tokenOf(b.json.data.url)}` });
  assert.equal(exp.status, 404);
  assert.match(exp.json.error, /expiré/);
});

test("droits : seul le patron envoie des invitations", async () => {
  assert.equal((await invite(ctx.cashier, { role: "CASHIER", centerId: ctx.center })).status, 403);
  const mgrInv = await invite(ctx.owner, { role: "CENTER_MANAGER", centerId: ctx.center });
  await call(acceptRoute.POST, { path: "/api/invitations/accept", body: { token: tokenOf(mgrInv.json.data.url), firstName: "Fabrice", lastName: "Dossou", email: "gerant@exemple.com", password: "monmotdepasse" } });
  const mgr = await login("gerant@exemple.com", "monmotdepasse");
  assert.equal((await invite(mgr, { role: "COMPANY_OWNER" })).status, 403);
  assert.equal((await invite(mgr, { role: "CASHIER", centerId: ctx.center })).status, 403);
  assert.equal((await invite(ctx.owner, { role: "CASHIER" })).status, 400, "boutique obligatoire");
});

test("plus de création directe de compte par le patron (inscription fermée)", async () => {
  const prev = process.env.NEXT_PUBLIC_REGISTRATION_OPEN;
  delete process.env.NEXT_PUBLIC_REGISTRATION_OPEN;
  try {
    const r = await call(registerRoute.POST, { path: "/api/auth/register", body: { tradeName: "Autre", ownerName: "X", phone: "1", email: "x@y.bj", password: "Motdepasse1", businessType: "LUBRICANTS" } });
    assert.equal(r.status, 403);
  } finally {
    process.env.NEXT_PUBLIC_REGISTRATION_OPEN = prev;
  }
  assert.ok(usersRoute.GET);
});

// ── Google ───────────────────────────────────────────
// Une seule clé pour tout le fichier (les clés publiques Google sont mises en cache)
const keys = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
async function googleFlow(inviteToken: string | null, claims: Json) {
  const { privateKey } = keys;
  const start = await gStart.GET(new NextRequest(`http://localhost:3000/api/auth/google/start${inviteToken ? `?invite=${inviteToken}` : ""}`));
  const location = new URL(start.headers.get("location")!);
  assert.equal(location.host, "accounts.google.com");
  const state = location.searchParams.get("state")!;
  const nonce = location.searchParams.get("nonce")!;
  const oauthCookie = (start as unknown as { cookies: { get: (n: string) => { value: string } } }).cookies.get("gjh-oauth").value;
  const idToken = await new SignJWT({ nonce, email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer("https://accounts.google.com")
    .setAudience("test-client")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ id_token: idToken }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.startsWith("https://www.googleapis.com/oauth2/v3/certs")) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error("fetch inattendu " + u);
  }) as typeof fetch;
  try {
    const res = await gCallback.GET(
      new NextRequest(`http://localhost:3000/api/auth/google/callback?code=abc&state=${state}`, { headers: { cookie: `gjh-oauth=${oauthCookie}` } })
    );
    const session = (res as unknown as { cookies: { get: (n: string) => { value: string } | undefined } }).cookies.get("fishcore-session")?.value;
    return { location: res.headers.get("location")!, session };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("Google : bouton affiché seulement si configuré", async () => {
  assert.equal((await providersRoute.GET()).status, 200);
  assert.equal((await (await providersRoute.GET()).json()).data.google, false);
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  assert.equal((await (await providersRoute.GET()).json()).data.google, true);
});

test("Google : création du compte avec le lien d'invitation", async () => {
  const inv = await invite(ctx.owner, { role: "STOCK_MANAGER", centerId: ctx.center });
  const r = await googleFlow(tokenOf(inv.json.data.url), { sub: "g-111", email: "mireille@gmail.com", given_name: "Mireille", family_name: "Agossou" });
  assert.match(r.location, /\/dashboard$/);
  assert.ok(r.session);
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "mireille@gmail.com" } });
  assert.deepEqual([u.role, u.googleSub, u.firstName, u.lastName], ["STOCK_MANAGER", "g-111", "Mireille", "Agossou"]);
});

test("Google : connexion d'un compte existant, et refus sans compte ni invitation", async () => {
  const again = await googleFlow(null, { sub: "g-111", email: "mireille@gmail.com" });
  assert.match(again.location, /\/dashboard$/);
  assert.ok(again.session);
  // même e-mail qu'un compte créé avec mot de passe : le compte est relié à Google
  const linked = await googleFlow(null, { sub: "g-222", email: "rachidi@exemple.com" });
  assert.ok(linked.session);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: "rachidi@exemple.com" } })).googleSub, "g-222");
  const unknown = await googleFlow(null, { sub: "g-999", email: "inconnu@gmail.com" });
  assert.match(unknown.location, /\/login\?erreur=google-inconnu$/);
  assert.equal(unknown.session, undefined);
});

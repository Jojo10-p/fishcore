/**
 * Annulation : motif obligatoire (écrit ou note vocale) et échange avec le patron.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { call, login, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const usersRoute = await import("@/app/api/users/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const cancelRoute = await import("@/app/api/sales/[id]/cancel/route");
const messagesRoute = await import("@/app/api/cancellations/[id]/messages/route");
const audioRoute = await import("@/app/api/cancellations/[id]/messages/[msgId]/route");
const { waitForNotifications } = await import("@/lib/notify");
const { waitForStockAlerts } = await import("@/lib/stock-alerts");

const ctx: Json = {};
// Faux son (quelques Ko) : le serveur ne décode pas l'audio, il le garde
const voice = { data: Buffer.alloc(3000, 7).toString("base64"), mime: "audio/webm", seconds: 6 };

async function sale() {
  const r = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: ctx.cashier,
    body: { sessionId: ctx.session, idempotencyKey: randomUUID(), lines: [{ productId: ctx.p, quantity: 1, unitPrice: 1200 }], payments: [{ method: "CASH", amount: 1200 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await waitForStockAlerts();
  return r.json.data.id as string;
}

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
  const unit = await prisma.unit.findFirstOrThrow({ where: { companyId: company } });
  ctx.p = (await prisma.product.create({ data: { companyId: company, centerId: ctx.center, name: "VIGO — 1 L", baseUnitId: unit.id, sellingPrice: 1200, purchasePrice: 1000 } })).id;
  await prisma.stock.create({ data: { centerId: ctx.center, productId: ctx.p, quantity: 50 } });
  const u = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email: "caisse@test.bj", password: "Motdepasse1", firstName: "Samson", lastName: "Test", role: "CASHIER", centerIds: [ctx.center] } });
  assert.equal(u.status, 201);
  ctx.cashier = await login("caisse@test.bj");
  const register = await prisma.cashRegister.findFirstOrThrow({ where: { centerId: ctx.center } });
  ctx.session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: ctx.cashier, body: { action: "open", cashRegisterId: register.id, openingBalance: 0 } })).json.data.id;
});
after(async () => {
  await waitForStockAlerts();
  await waitForNotifications();
  await prisma.$disconnect();
});

test("sans motif ni note vocale : refusé", async () => {
  const id = await sale();
  const r = await call(cancelRoute.POST, { path: `/api/sales/${id}/cancel`, cookie: ctx.cashier, params: { id }, body: { action: "request", reason: "" } });
  assert.equal(r.status, 400);
  ctx.sale = id;
});

test("note vocale seule : la demande part, le patron est prévenu", async () => {
  const r = await call(cancelRoute.POST, { path: `/api/sales/${ctx.sale}/cancel`, cookie: ctx.cashier, params: { id: ctx.sale }, body: { action: "request", reason: "", voice } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  ctx.cancel = r.json.data.id;
  assert.match(r.json.data.requestReason, /Note vocale \(6 s\)/);
  await waitForNotifications();
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "direction@test.bj" } });
  const n = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id, type: "CANCEL_REQUESTED" } });
  assert.match(n.message, /Note vocale de 6 s à écouter/);
});

test("le patron écoute la note, demande des précisions en vocal ; le caissier est prévenu et répond", async () => {
  const list = await call(messagesRoute.GET, { path: `/api/cancellations/${ctx.cancel}/messages`, cookie: ctx.owner, params: { id: ctx.cancel } });
  assert.equal(list.status, 200);
  assert.equal(list.json.data.length, 1);
  assert.equal(list.json.data[0].hasAudio, true);
  const audio = await audioRoute.GET(
    new (await import("next/server")).NextRequest(`http://localhost/api/cancellations/${ctx.cancel}/messages/${list.json.data[0].id}`, { headers: { cookie: `fishcore-session=${ctx.owner}` } }),
    { params: Promise.resolve({ id: ctx.cancel, msgId: list.json.data[0].id }) }
  );
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get("content-type"), "audio/webm");
  assert.equal((await audio.arrayBuffer()).byteLength, 3000);

  const ask = await call(messagesRoute.POST, { path: `/api/cancellations/${ctx.cancel}/messages`, cookie: ctx.owner, params: { id: ctx.cancel }, body: { text: "Le client a rapporté le bidon ?", voice } });
  assert.equal(ask.status, 201, JSON.stringify(ask.json));
  await waitForNotifications();
  const cashier = await prisma.user.findFirstOrThrow({ where: { email: "caisse@test.bj" } });
  const n = await prisma.notification.findFirstOrThrow({ where: { userId: cashier.id, type: "CANCEL_MESSAGE" } });
  assert.match(n.message, /note vocale \(6 s\) : « Le client a rapporté le bidon \? »/);

  const reply = await call(messagesRoute.POST, { path: `/api/cancellations/${ctx.cancel}/messages`, cookie: ctx.cashier, params: { id: ctx.cancel }, body: { text: "Oui, il est au magasin" } });
  assert.equal(reply.status, 201);
  const empty = await call(messagesRoute.POST, { path: `/api/cancellations/${ctx.cancel}/messages`, cookie: ctx.cashier, params: { id: ctx.cancel }, body: {} });
  assert.equal(empty.status, 400);
});

test("un autre caissier ne voit pas l'échange", async () => {
  const u = await call(usersRoute.POST, { path: "/api/users", cookie: ctx.owner, body: { email: "caisse2@test.bj", password: "Motdepasse1", firstName: "Autre", lastName: "Test", role: "CASHIER", centerIds: [ctx.center] } });
  assert.equal(u.status, 201);
  const other = await login("caisse2@test.bj");
  const r = await call(messagesRoute.GET, { path: `/api/cancellations/${ctx.cancel}/messages`, cookie: other, params: { id: ctx.cancel } });
  assert.equal(r.status, 404);
});

test("motif écrit seul : toujours accepté", async () => {
  const id = await sale();
  const r = await call(cancelRoute.POST, { path: `/api/sales/${id}/cancel`, cookie: ctx.cashier, params: { id }, body: { action: "request", reason: "Erreur de bidon" } });
  assert.equal(r.status, 201);
});

test("après 30 jours, les notes vocales s'effacent ; le texte reste", async () => {
  const { purgeOldVoiceNotes } = await import("@/lib/voice");
  const later = new Date(Date.now() + 31 * 24 * 3600_000);
  assert.ok((await purgeOldVoiceNotes(later)) >= 2);
  const list = await call(messagesRoute.GET, { path: `/api/cancellations/${ctx.cancel}/messages`, cookie: ctx.owner, params: { id: ctx.cancel } });
  const voiced = list.json.data.filter((m: Json) => m.audioSeconds);
  assert.ok(voiced.length >= 2);
  for (const m of voiced) {
    assert.equal(m.hasAudio, false);
    assert.equal(m.audioExpired, true);
  }
  assert.ok(list.json.data.some((m: Json) => m.text === "Le client a rapporté le bidon ?"), "le texte reste");
  assert.equal(await prisma.cancellationMessage.count({ where: { audio: { not: null } } }), 0);
});

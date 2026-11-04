/**
 * Suppression définitive d'un compte entreprise : tout disparaît proprement, une
 * autre entreprise n'est pas touchée, et le même e-mail se réinscrit aussitôt.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call, idem, login, passwordHash, prisma, resetDb, type Json } from "./helpers.mts";

const registerRoute = await import("@/app/api/auth/register/route");
const centersRoute = await import("@/app/api/centers/route");
const productsRoute = await import("@/app/api/products/route");
const unitsRoute = await import("@/app/api/units/route");
const suppliersRoute = await import("@/app/api/suppliers/route");
const customersRoute = await import("@/app/api/customers/route");
const receiptsRoute = await import("@/app/api/goods-receipts/route");
const validateReceipt = await import("@/app/api/goods-receipts/[id]/validate/route");
const cashRoute = await import("@/app/api/cash/sessions/route");
const salesRoute = await import("@/app/api/sales/route");
const quotesRoute = await import("@/app/api/quotes/route");
const expensesRoute = await import("@/app/api/expenses/route");
const inventoriesRoute = await import("@/app/api/inventories/route");
const transfersRoute = await import("@/app/api/transfers/route");
const logoRoute = await import("@/app/api/company/logo/route");
const brandRoute = await import("@/app/api/brand/[companyId]/[file]/route");
const deleteRoute = await import("@/app/api/company/delete/route");
const companyRoute = await import("@/app/api/company/route");
const meRoute = await import("@/app/api/auth/me/route");
const { verifyAuditChain } = await import("@/lib/audit");

const ctx: Json = {};
const { NextRequest } = await import("next/server");

/** Appel d'une ressource non JSON (image, redirection) : renvoie le statut et le type. */
async function raw(companyId: string, file: string) {
  const req = new NextRequest(`http://localhost:3000/api/brand/${companyId}/${file}`);
  const res = await brandRoute.GET(req, { params: Promise.resolve({ companyId, file }) });
  return { status: res.status, type: res.headers.get("content-type"), bytes: (await res.arrayBuffer()).byteLength };
}

/** PNG carré valide de la taille demandée (une couleur), généré sans dépendance. */
async function png(size: number): Promise<string> {
  const zlib = await import("node:zlib");
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x33)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const file = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${file.toString("base64")}`;
}

/** Crée une entreprise avec un peu de tout : ventes, devis, stock, inventaire, transfert, logo… */
async function populate(email: string, name: string) {
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: name, ownerName: "Roger", phone: "97000000", email, password: "Motdepasse1", businessType: "HARDWARE" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const companyId = reg.json.data.companyId;
  const owner = await login(email);
  const c1 = (await call(centersRoute.POST, { path: "/api/centers", cookie: owner, body: { name: "Magasin", code: "MAG" } })).json.data.id;
  const c2 = (await call(centersRoute.POST, { path: "/api/centers", cookie: owner, body: { name: "Dépôt", code: "DEP" } })).json.data.id;
  const hash = await passwordHash();
  const cashierEmail = `caisse.${email}`;
  await prisma.user.create({
    data: { email: cashierEmail, passwordHash: hash, firstName: "Caisse", lastName: "T", role: "CASHIER", companyId, centers: { create: [{ centerId: c1 }] } },
  });
  const cashier = await login(cashierEmail);
  const units = await call(unitsRoute.GET, { path: "/api/units", cookie: owner });
  const unit = units.json.data[0].id;
  const p = (await call(productsRoute.POST, { path: "/api/products", cookie: owner, body: { name: "Tôle bac", baseUnitId: unit, sellingPrice: 5000, purchasePrice: 0, stockAlertQty: 0 } })).json.data;
  const sup = (await call(suppliersRoute.POST, { path: "/api/suppliers", cookie: owner, body: { name: "Grossiste" } })).json.data;
  const cus = (await call(customersRoute.POST, { path: "/api/customers", cookie: owner, body: { name: "Client fidèle", phone: "96000000" } })).json.data;
  const r = await call(receiptsRoute.POST, {
    path: "/api/goods-receipts",
    cookie: owner,
    body: { centerId: c1, supplierId: sup.id, lines: [{ productId: p.id, quantity: 50, unitPrice: 4000, totalPrice: 200000 }] },
  });
  await call(validateReceipt.POST, { path: `/api/goods-receipts/${r.json.data.id}/validate`, cookie: owner, params: { id: r.json.data.id }, body: {} });
  const register = await prisma.cashRegister.findFirst({ where: { centerId: c1 } });
  const session = (await call(cashRoute.POST, { path: "/api/cash/sessions", cookie: cashier, body: { action: "open", cashRegisterId: register!.id, openingBalance: 0 } })).json.data.id;
  const sale = await call(salesRoute.POST, {
    path: "/api/sales",
    cookie: cashier,
    body: { sessionId: session, idempotencyKey: idem(), customerId: cus.id, lines: [{ productId: p.id, quantity: 2, unitPrice: 5000 }], payments: [{ method: "CASH", amount: 10000 }] },
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  await call(quotesRoute.POST, { path: "/api/quotes", cookie: owner, body: { centerId: c1, customerId: cus.id, lines: [{ productId: p.id, quantity: 3, unitPrice: 5000 }] } });
  await call(expensesRoute.POST, { path: "/api/expenses", cookie: owner, body: { centerId: c1, category: "Transport", amount: 2000, method: "MOBILE_MONEY" } });
  await call(inventoriesRoute.POST, { path: "/api/inventories", cookie: owner, body: { centerId: c1 } });
  const tr = await call(transfersRoute.POST, { path: "/api/transfers", cookie: owner, body: { fromCenterId: c1, toCenterId: c2, lines: [{ productId: p.id, quantity: 5 }] } });
  assert.equal(tr.status, 201, JSON.stringify(tr.json));
  const logo = await call(logoRoute.POST, { path: "/api/company/logo", cookie: owner, body: { logo512: await png(512), logo192: await png(192), maskable512: await png(512) } });
  assert.equal(logo.status, 200, JSON.stringify(logo.json));
  return { companyId, owner, cashier };
}

before(async () => {
  await resetDb();
  ctx.other = await populate("autre@boutique.bj", "Autre Boutique");
  ctx.roger = await populate("roger@doks.bj", "Roger Doks");
});

after(async () => {
  await prisma.$disconnect();
});

test("marque blanche : l'application porte le nom et le logo de l'entreprise", async () => {
  const m = await call(brandRoute.GET, { path: `/api/brand/${ctx.roger.companyId}/manifest.webmanifest`, params: { companyId: ctx.roger.companyId, file: "manifest.webmanifest" } });
  assert.equal(m.status, 200);
  assert.equal(m.json.name, "Roger Doks");
  assert.equal(m.json.id, `/?app=${ctx.roger.companyId}`);
  assert.match(m.json.icons[0].src, new RegExp(`/api/brand/${ctx.roger.companyId}/icon-192\\.png\\?v=`));

  const icon = await raw(ctx.roger.companyId, "icon-192.png");
  assert.equal(icon.status, 200);
  assert.equal(icon.type, "image/png");
  assert.ok(icon.bytes > 100);

  const bad = await call(logoRoute.POST, { path: "/api/company/logo", cookie: ctx.roger.owner, body: { logo512: await png(100), logo192: await png(192), maskable512: await png(512) } });
  assert.equal(bad.status, 400);
  const cashier = await call(logoRoute.POST, { path: "/api/company/logo", cookie: ctx.roger.cashier, body: { logo512: await png(512), logo192: await png(192), maskable512: await png(512) } });
  assert.equal(cashier.status, 403);

  // Nom de l'application distinct du nom commercial (icône et fenêtre), puis retour au nom commercial
  const named = await call(companyRoute.PATCH, { path: "/api/company", method: "PATCH", cookie: ctx.roger.owner, body: { appName: "RD Gestion" } });
  assert.equal(named.status, 200, JSON.stringify(named.json));
  const m2 = await call(brandRoute.GET, { path: `/api/brand/${ctx.roger.companyId}/manifest.webmanifest`, params: { companyId: ctx.roger.companyId, file: "manifest.webmanifest" } });
  assert.equal(m2.json.name, "RD Gestion");
  assert.match(m2.json.description, /Roger Doks/);
  await call(companyRoute.PATCH, { path: "/api/company", method: "PATCH", cookie: ctx.roger.owner, body: { appName: "" } });
  const m3 = await call(brandRoute.GET, { path: `/api/brand/${ctx.roger.companyId}/manifest.webmanifest`, params: { companyId: ctx.roger.companyId, file: "manifest.webmanifest" } });
  assert.equal(m3.json.name, "Roger Doks");
});

test("suppression : refusée sans le bon mot de passe, le bon nom ou le bon rôle", async () => {
  const cashier = await call(deleteRoute.POST, { path: "/api/company/delete", cookie: ctx.roger.cashier, body: { password: "Motdepasse1", confirmName: "Roger Doks", reasons: ["test_account"] } });
  assert.equal(cashier.status, 403);
  const badPwd = await call(deleteRoute.POST, { path: "/api/company/delete", cookie: ctx.roger.owner, body: { password: "mauvais", confirmName: "Roger Doks", reasons: ["test_account"] } });
  assert.equal(badPwd.status, 400);
  assert.equal(badPwd.json.code, "BAD_PASSWORD");
  const badName = await call(deleteRoute.POST, { path: "/api/company/delete", cookie: ctx.roger.owner, body: { password: "Motdepasse1", confirmName: "Roger", reasons: ["test_account"] } });
  assert.equal(badName.status, 400);
  assert.equal(badName.json.code, "CONFIRM_MISMATCH");
  // Une raison est obligatoire ; « Autre » demande un texte
  const noReason = await call(deleteRoute.POST, { path: "/api/company/delete", cookie: ctx.roger.owner, body: { password: "Motdepasse1", confirmName: "Roger Doks", reasons: [] } });
  assert.equal(noReason.status, 400);
  const otherEmpty = await call(deleteRoute.POST, { path: "/api/company/delete", cookie: ctx.roger.owner, body: { password: "Motdepasse1", confirmName: "Roger Doks", reasons: ["other"], otherReason: " " } });
  assert.equal(otherEmpty.status, 400);
  const unknown = await call(deleteRoute.POST, { path: "/api/company/delete", cookie: ctx.roger.owner, body: { password: "Motdepasse1", confirmName: "Roger Doks", reasons: ["n_importe_quoi"] } });
  assert.equal(unknown.status, 400);
  assert.equal(await prisma.accountDeletion.count(), 0);
  assert.ok(await prisma.company.findUnique({ where: { id: ctx.roger.companyId } }));
});

test("suppression : toutes les données de l'entreprise disparaissent, l'autre est intacte", async () => {
  const before = await prisma.auditLog.count({ where: { companyId: ctx.other.companyId } });
  const r = await call(deleteRoute.POST, { path: "/api/company/delete", cookie: ctx.roger.owner, body: { password: "Motdepasse1", confirmName: "  roger   DOKS ", reasons: ["too_complex", "other", "too_complex"], otherReason: "Je préfère mon cahier" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));

  // Le départ est consigné pour le créateur de la plateforme (raisons + résumé d'activité)
  const dep = await prisma.accountDeletion.findFirstOrThrow({ where: { companyId: ctx.roger.companyId } });
  assert.deepEqual(dep.reasons, ["too_complex", "other"]);
  assert.equal(dep.otherReason, "Je préfère mon cahier");
  assert.equal(dep.tradeName, "Roger Doks");
  assert.equal(dep.email, "roger@doks.bj");
  assert.ok(dep.centersCount >= 1 && dep.usersCount >= 2);

  // Plus aucune ligne liée à l'entreprise, dans aucune table
  const id = ctx.roger.companyId;
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'companyId' AND table_name <> 'account_deletions'`;
  for (const { table_name } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "${table_name}" WHERE "companyId" = $1`, id);
    assert.equal(Number(n), 0, `${table_name} contient encore des données`);
  }
  assert.equal(await prisma.company.count({ where: { id } }), 0);
  assert.equal(await prisma.user.count({ where: { email: { in: ["roger@doks.bj", "caisse.roger@doks.bj"] } } }), 0);
  // Pas d'orphelins : chaque stock, mouvement, vente… appartient à un centre existant
  const [{ orphans }] = await prisma.$queryRaw<Array<{ orphans: bigint }>>`
    SELECT (SELECT COUNT(*) FROM "stocks" s WHERE NOT EXISTS (SELECT 1 FROM "centers" c WHERE c."id" = s."centerId"))
         + (SELECT COUNT(*) FROM "stock_movements" m WHERE NOT EXISTS (SELECT 1 FROM "centers" c WHERE c."id" = m."centerId"))
         + (SELECT COUNT(*) FROM "batches" b WHERE b."centerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "centers" c WHERE c."id" = b."centerId"))
         + (SELECT COUNT(*) FROM "auth_sessions" a WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."userId")) AS orphans`;
  assert.equal(Number(orphans), 0);

  // L'autre entreprise : rien n'a bougé, son journal d'audit reste intègre
  assert.equal(await prisma.auditLog.count({ where: { companyId: ctx.other.companyId } }), before);
  assert.equal((await verifyAuditChain(ctx.other.companyId)).isValid, true);
  assert.equal(await prisma.sale.count({ where: { companyId: ctx.other.companyId } }), 1);

  // L'ancienne session ne sert plus à rien
  const me = await call(meRoute.GET, { path: "/api/auth/me", cookie: ctx.roger.owner });
  assert.equal(me.status, 401);

  // Le logo n'est plus servi (retour à l'icône par défaut)
  const icon = await raw(id, "icon-192.png");
  assert.equal(icon.status, 302);
});

test("le journal d'audit reste protégé hors suppression de compte", async () => {
  await assert.rejects(prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "companyId" = ${ctx.other.companyId}`);
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      // Déclarer une AUTRE entreprise ne permet pas d'effacer celle-ci
      await tx.$executeRaw`SELECT set_config('fishcore.purge_company', 'xxx', true)`;
      await tx.$executeRaw`DELETE FROM "audit_logs" WHERE "companyId" = ${ctx.other.companyId}`;
    })
  );
});

test("réinscription immédiate avec le même e-mail", async () => {
  const reg = await call(registerRoute.POST, {
    path: "/api/auth/register",
    body: { tradeName: "Roger Doks", ownerName: "Roger", phone: "97000000", email: "roger@doks.bj", password: "Motdepasse2", businessType: "HARDWARE" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.notEqual(reg.json.data.companyId, ctx.roger.companyId);
  const cookie = await login("roger@doks.bj", "Motdepasse2");
  const me = await call(meRoute.GET, { path: "/api/auth/me", cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.company.tradeName, "Roger Doks");
  assert.equal(me.json.data.company.logoUrl, null);
  // Nouveau départ : numérotation et catalogue repartent de zéro
  assert.equal(await prisma.product.count({ where: { companyId: reg.json.data.companyId } }), 0);
});

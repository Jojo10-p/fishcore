#!/usr/bin/env node
// Lien de réinitialisation du mot de passe d'un compte (assistance plateforme).
// Usage : node scripts/reset-link.mjs adresse@email.bj
//   (DIRECT_URL ou DATABASE_URL de la base de production, NEXT_PUBLIC_APP_URL pour l'adresse du lien)
// À utiliser après avoir vérifié l'identité du demandeur (appel, pièce, IFU…).
import crypto from "node:crypto";
import pg from "pg";
import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Usage : node scripts/reset-link.mjs adresse@email.bj");
  process.exit(1);
}
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL (ou DATABASE_URL) manquant");
  process.exit(1);
}
const local = /localhost|127\.0\.0\.1/.test(url);
const client = new pg.Client({
  connectionString: url.replace(/[?&](sslmode|pgbouncer)=[^&]*/g, ""),
  ssl: local ? false : process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : { rejectUnauthorized: false },
});
await client.connect();
try {
  const { rows } = await client.query(`SELECT u."id", u."firstName", u."isActive", c."tradeName" FROM "users" u LEFT JOIN "companies" c ON c."id" = u."companyId" WHERE u."email" = $1`, [email]);
  if (!rows[0]) throw new Error(`Aucun compte pour ${email}`);
  if (!rows[0].isActive) throw new Error("Ce compte est désactivé");
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  await client.query("BEGIN");
  await client.query(`UPDATE "password_reset_tokens" SET "usedAt" = NOW() WHERE "userId" = $1 AND "usedAt" IS NULL`, [rows[0].id]);
  await client.query(
    `INSERT INTO "password_reset_tokens" ("id", "userId", "tokenHash", "expiresAt") VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')`,
    [crypto.randomUUID().replaceAll("-", ""), rows[0].id, hash]
  );
  await client.query("COMMIT");
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  console.log(`${rows[0].firstName} — ${rows[0].tradeName ?? "plateforme"}`);
  console.log(`${base}/reinitialiser/${token}`);
  console.log("Valable 24 h, une seule fois.");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

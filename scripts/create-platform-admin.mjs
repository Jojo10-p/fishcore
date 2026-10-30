#!/usr/bin/env node
// Crée le compte administrateur de la plateforme (l'éditeur de fishcore) et
// affiche un lien pour choisir son mot de passe (24 h, usage unique).
// Usage : node scripts/create-platform-admin.mjs adresse@email.bj "Prénom" "Nom"
//   (DIRECT_URL ou DATABASE_URL de la base visée, NEXT_PUBLIC_APP_URL pour l'adresse du lien)
import crypto from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });

const [email, firstName = "Administrateur", lastName = "Plateforme"] = process.argv.slice(2).map((a) => a.trim());
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Usage : node scripts/create-platform-admin.mjs adresse@email.bj "Prénom" "Nom"');
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
  await client.query("BEGIN");
  const lower = email.toLowerCase();
  const { rows } = await client.query(`SELECT "id", "role", "companyId" FROM "users" WHERE "email" = $1`, [lower]);
  let userId;
  if (rows[0]) {
    if (rows[0].companyId || rows[0].role !== "PLATFORM_ADMIN") throw new Error("Cette adresse appartient déjà au compte d'une entreprise : utilisez une autre adresse.");
    userId = rows[0].id;
    console.log("Compte administrateur existant : nouveau lien de mot de passe.");
  } else {
    userId = crypto.randomUUID().replaceAll("-", "");
    // Mot de passe aléatoire inutilisable : le vrai est choisi via le lien
    const hash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12);
    await client.query(
      `INSERT INTO "users" ("id", "email", "passwordHash", "firstName", "lastName", "role", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'PLATFORM_ADMIN', true, NOW(), NOW())`,
      [userId, lower, hash, firstName, lastName]
    );
    console.log(`Compte administrateur créé : ${lower}`);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  await client.query(`UPDATE "password_reset_tokens" SET "usedAt" = NOW() WHERE "userId" = $1 AND "usedAt" IS NULL`, [userId]);
  await client.query(
    `INSERT INTO "password_reset_tokens" ("id", "userId", "tokenHash", "expiresAt", "createdAt") VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours', NOW())`,
    [crypto.randomUUID().replaceAll("-", ""), userId, crypto.createHash("sha256").update(token).digest("hex")]
  );
  await client.query("COMMIT");
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  console.log("Choisissez votre mot de passe ici (24 h, une seule fois) :");
  console.log(`${base}/reinitialiser/${token}`);
  console.log(`Puis connectez-vous : ${base}/login → espace plateforme ${base}/plateforme`);
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

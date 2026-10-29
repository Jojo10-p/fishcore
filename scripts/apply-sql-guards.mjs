#!/usr/bin/env node
// ─────────────────────────────────────────────
// Rejoue les garde-fous SQL (prisma/sql/integrity-guards.sql) :
// journal d'audit non modifiable, stock jamais négatif, une session ouverte
// par caisse, etc. Le fichier est idempotent : on peut le rejouer à chaque
// déploiement, il remet en place ce qu'une migration aurait pu retirer.
// Utilise DIRECT_URL (connexion directe), sinon DATABASE_URL.
// ─────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("[garde-fous] DIRECT_URL ou DATABASE_URL requis");
  process.exit(1);
}

const parsed = new URL(url);
const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) || parsed.searchParams.get("sslmode") === "disable";
for (const p of ["sslmode", "sslrootcert", "pgbouncer", "connection_limit"]) parsed.searchParams.delete(p);
const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "sql", "integrity-guards.sql"), "utf8");
const client = new pg.Client({
  connectionString: parsed.toString(),
  ssl: local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("SET client_min_messages TO WARNING");
  await client.query(sql);
  console.log("[garde-fous] appliqués");
} catch (e) {
  console.error("[garde-fous] échec :", e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

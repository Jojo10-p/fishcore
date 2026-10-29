import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ─────────────────────────────────────────────
// Connexion à la base (Prisma 7 + pilote pg)
// ─────────────────────────────────────────────
// DATABASE_URL : pooler Supabase en mode transaction (port 6543) — adapté aux
// fonctions serverless de Vercel, qui ouvrent beaucoup de connexions courtes.
// Le pilote pg n'utilise pas de requêtes préparées nommées : compatible pgbouncer.
//
// SSL : Supabase chiffre toujours la connexion. Son certificat n'est pas signé
// par une autorité connue de Node : on chiffre sans vérifier l'autorité (comme
// « sslmode=require » de libpq), sauf si DATABASE_CA_CERT fournit le certificat
// racine de Supabase (Paramètres du projet → Database → SSL), auquel cas la
// vérification est complète.

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export function pgConfig(connectionString: string) {
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.searchParams.get("sslmode") === "disable";
  // Le SSL est réglé ci-dessous : on retire les paramètres d'URL qui l'écraseraient
  for (const p of ["sslmode", "sslrootcert", "pgbouncer", "connection_limit"]) url.searchParams.delete(p);
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  return {
    connectionString: url.toString(),
    ssl: local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    // Par instance : Vercel multiplie les instances, le pooler Supabase mutualise
    max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 5 : 10)),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("[CONFIG] DATABASE_URL n'est pas défini");
  return new PrismaClient({
    adapter: new PrismaPg(pgConfig(connectionString)),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function client(): PrismaClient {
  // Une seule instance par processus (rechargements à chaud, instances Vercel réutilisées)
  return (globalForPrisma.prisma ??= createPrismaClient());
}

/**
 * Client créé à la première requête, pas au chargement du module : la
 * compilation (next build) ne dépend pas de la base de données.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});

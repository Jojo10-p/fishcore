import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // DATABASE_SCHEMA permet d'héberger les tables dans un schéma dédié (ex. « aurane » sur une base partagée).
  const schema = process.env.DATABASE_SCHEMA || undefined;
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: Number(process.env.DATABASE_POOL_SIZE ?? 5) }, schema ? { schema } : undefined);
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

export const db = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** Nom de table qualifié par le schéma, pour les requêtes SQL brutes. */
import { Prisma } from "@/generated/prisma/client";
const SCHEMA = (process.env.DATABASE_SCHEMA || "public").replace(/[^a-zA-Z0-9_]/g, "");
export const tbl = (name: string) => Prisma.raw(`"${SCHEMA}"."${name.replace(/[^a-zA-Z0-9_]/g, "")}"`);

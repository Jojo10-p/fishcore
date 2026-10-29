/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Outils partagés des tests d'intégration.
 * Importer ce module AVANT toute route : il prépare l'environnement.
 */
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

export const DB_URL = process.env.TEST_DATABASE_URL;
if (!DB_URL) {
  console.error("TEST_DATABASE_URL non défini — tests d'intégration ignorés.");
  process.exit(0);
}
process.env.DATABASE_URL = DB_URL;
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-0123";
process.env.INSTALL_LINK_SECRET ??= "test-install-secret-test-install-secret-01";

export const { prisma } = await import("@/lib/prisma");
const loginRoute = await import("@/app/api/auth/login/route");

const BASE = "http://localhost:3000";
export const PASSWORD = "Motdepasse1";
export type Json = Record<string, any>;

export async function call(
  handler: (req: NextRequest, ctx?: any) => Promise<Response>,
  opts: { path: string; method?: string; cookie?: string; body?: unknown; params?: Record<string, string> }
): Promise<{ status: number; json: Json }> {
  const req = new NextRequest(`${BASE}${opts.path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(opts.cookie ? { cookie: `fishcore-session=${opts.cookie}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, opts.params ? { params: Promise.resolve(opts.params) } : undefined);
  return { status: res.status, json: (await res.json()) as Json };
}

export async function login(email: string): Promise<string> {
  const req = new NextRequest(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const res = await loginRoute.POST(req);
  assert.equal(res.status, 200, `connexion ${email}`);
  const cookie = (res as any).cookies.get("fishcore-session")?.value;
  assert.ok(cookie);
  return cookie;
}

let key = 0;
export const idem = () => `test_${Date.now()}_${key++}`;

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`ALTER TABLE "audit_logs" DISABLE TRIGGER USER`);
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
  await prisma.$executeRawUnsafe(`ALTER TABLE "audit_logs" ENABLE TRIGGER USER`);
}

export async function passwordHash() {
  return bcrypt.hash(PASSWORD, 4);
}

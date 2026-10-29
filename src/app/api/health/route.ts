import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/health — Surveillance (Vercel, UptimeRobot…) : l'application et la base répondent-elles ?
// Ne renvoie aucune donnée métier.
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { ok: true, database: "ok", latencyMs: Date.now() - started, region: process.env.VERCEL_REGION ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ ok: false, database: "injoignable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

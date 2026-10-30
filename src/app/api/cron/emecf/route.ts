import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processPending } from "@/lib/emecf/normalize";

// GET /api/cron/emecf — Tâche planifiée (Vercel Cron) : reprend les factures en
// attente de normalisation de toutes les entreprises. Protégée par CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 401 });
  }
  const companies = await prisma.emecfDocument.findMany({
    where: { status: { in: ["PENDING", "SUBMITTED", "FAILED"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    distinct: ["companyId"],
    select: { companyId: true },
    take: 50,
  });
  let processed = 0;
  let normalized = 0;
  for (const { companyId } of companies) {
    const r = await processPending(companyId, 20).catch(() => ({ processed: 0, normalized: 0 }));
    processed += r.processed;
    normalized += r.normalized;
  }
  return NextResponse.json({ success: true, data: { companies: companies.length, processed, normalized } });
}

export const maxDuration = 60;

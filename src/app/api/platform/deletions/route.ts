import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform";

// GET /api/platform/deletions — Comptes supprimés et raisons des départs
export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin(req);
    const rows = await prisma.accountDeletion.findMany({ orderBy: { deletedAt: "desc" }, take: 500 });
    const byReason = rows.reduce<Record<string, number>>((acc, r) => {
      for (const code of r.reasons) acc[code] = (acc[code] ?? 0) + 1;
      return acc;
    }, {});
    return NextResponse.json({ success: true, data: { rows, byReason, total: rows.length } });
  } catch (error) {
    return handleApiError(error, "PLATFORM");
  }
}

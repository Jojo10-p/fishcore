import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COMPANY_NAME } from "@/lib/app-config";

export const dynamic = "force-dynamic";

// GET /api/public/boutiques — les boutiques GJH, pour « choisir ma boutique » avant
// de taper le code donné par le patron (nom seulement, rien de sensible).
export async function GET() {
  const centers = await prisma.center.findMany({
    where: { status: "ACTIVE", company: { tradeName: COMPANY_NAME } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ success: true, data: centers });
}

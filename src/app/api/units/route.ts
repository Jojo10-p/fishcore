import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  handleApiError,
  isUniqueViolation,
  parseBody,
  readJson,
  requireCompany,
  requirePermission,
} from "@/lib/auth";

const unitSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(40),
  symbol: z.string().trim().min(1, "Symbole requis").max(12),
  kind: z.enum(["COUNT", "WEIGHT", "VOLUME", "LENGTH", "AREA", "PACKAGING"]).default("COUNT"),
  allowsDecimal: z.boolean().default(false),
});

// GET /api/units — Unités de mesure de l'entreprise (+ unités globales)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:view");
    const companyId = requireCompany(user);
    const units = await prisma.unit.findMany({
      where: { OR: [{ companyId }, { companyId: null }] },
      select: { id: true, name: true, symbol: true, isBaseUnit: true, kind: true, allowsDecimal: true },
      orderBy: [{ isBaseUnit: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ success: true, data: units });
  } catch (error) {
    return handleApiError(error, "UNITS");
  }
}

// POST /api/units — Ajouter une unité propre à l'entreprise (ex. « brouette », « tine »)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:create");
    const companyId = requireCompany(user);
    const data = parseBody(unitSchema, await readJson(req));
    const unit = await prisma.unit.create({ data: { companyId, ...data } });
    return NextResponse.json({ success: true, data: unit }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: false, error: "Une unité avec ce symbole existe déjà" }, { status: 409 });
    }
    return handleApiError(error, "UNITS");
  }
}

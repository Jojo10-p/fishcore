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

// GET /api/categories — Catégories (rayons, familles) de l'entreprise
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:view");
    const companyId = requireCompany(user);
    const categories = await prisma.category.findMany({
      where: { companyId },
      select: { id: true, name: true, sortOrder: true, _count: { select: { products: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ success: true, data: categories });
  } catch (error) {
    return handleApiError(error, "CATEGORIES");
  }
}

// POST /api/categories — Ajouter une catégorie
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:create");
    const companyId = requireCompany(user);
    const { name } = parseBody(z.object({ name: z.string().trim().min(1, "Nom requis").max(60) }), await readJson(req));
    const last = await prisma.category.aggregate({ where: { companyId }, _max: { sortOrder: true } });
    const category = await prisma.category.create({
      data: { companyId, name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    return NextResponse.json({ success: true, data: category }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: false, error: "Cette catégorie existe déjà" }, { status: 409 });
    }
    return handleApiError(error, "CATEGORIES");
  }
}

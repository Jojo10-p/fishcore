import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, requireCompany } from "@/lib/auth";

// GET /api/product-suggestions — liste de noms d'articles proposés à l'ajout de stock
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    requireCompany(user);
    const list = await prisma.productSuggestion.findMany({
      select: { id: true, name: true, liters: true, unitsPerCarton: true, category: true },
      orderBy: { name: "asc" },
      take: 2000,
    });
    return NextResponse.json({ success: true, data: list.map((s) => ({ ...s, liters: s.liters ? Number(s.liters) : null })) });
  } catch (error) {
    return handleApiError(error, "PRODUCTS");
  }
}

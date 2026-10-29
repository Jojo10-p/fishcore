import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCompany,
  requirePermission,
} from "@/lib/auth";

const supplierSchema = z.object({
  name: z.string().trim().min(2, "Nom du fournisseur requis"),
  phone: z.string().trim().optional(),
  email: z.string().trim().toLowerCase().email("Email invalide").optional().or(z.literal("")),
  address: z.string().trim().optional(),
  taxId: z.string().trim().optional(),
});

// GET /api/suppliers — Fournisseurs actifs de l'entreprise
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "supplier:view");
    const companyId = requireCompany(user);
    const suppliers = await prisma.supplier.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, phone: true, email: true, address: true, taxId: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ success: true, data: suppliers });
  } catch (error) {
    return handleApiError(error, "SUPPLIERS");
  }
}

// POST /api/suppliers — Créer un fournisseur
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "supplier:create");
    const companyId = requireCompany(user);
    const data = parseBody(supplierSchema, await readJson(req));
    const supplier = await prisma.supplier.create({
      data: { companyId, ...data, email: data.email || null },
    });
    return NextResponse.json({ success: true, data: supplier }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "SUPPLIERS");
  }
}

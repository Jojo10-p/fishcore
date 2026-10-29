import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
import { hasPermission } from "@/lib/rbac";

const supplierSchema = z.object({
  name: z.string().trim().min(2, "Nom du fournisseur requis"),
  phone: z.string().trim().optional(),
  email: z.string().trim().toLowerCase().email("Email invalide").optional().or(z.literal("")),
  address: z.string().trim().optional(),
  taxId: z.string().trim().optional(),
  paymentTermDays: z.coerce.number().int().min(0).max(365).optional(),
});

// GET /api/suppliers — Fournisseurs actifs, avec leur dette (si droit « achats »)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "supplier:view");
    const companyId = requireCompany(user);
    const suppliers = await prisma.supplier.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, phone: true, email: true, address: true, taxId: true, paymentTermDays: true },
      orderBy: { name: "asc" },
    });

    if (!hasPermission(user.role, "purchase:view")) return NextResponse.json({ success: true, data: suppliers });

    // Dette = factures non soldées ; en retard = échéance dépassée
    const now = new Date();
    const debts = await prisma.$queryRaw<Array<{ supplierId: string; debt: Prisma.Decimal; overdue: Prisma.Decimal; nextDue: Date | null }>>`
      SELECT "supplierId",
             SUM("totalAmount" - "paidAmount") AS "debt",
             SUM(CASE WHEN "dueDate" < ${now} THEN "totalAmount" - "paidAmount" ELSE 0 END) AS "overdue",
             MIN("dueDate") AS "nextDue"
        FROM "purchases"
       WHERE "companyId" = ${companyId} AND "paidAmount" < "totalAmount"
       GROUP BY "supplierId"`;
    const bySupplier = new Map(debts.map((d) => [d.supplierId, d]));

    return NextResponse.json({
      success: true,
      data: suppliers
        .map((s) => {
          const d = bySupplier.get(s.id);
          return { ...s, debt: d ? d.debt.toString() : "0", overdue: d ? d.overdue.toString() : "0", nextDue: d?.nextDue ?? null };
        })
        .sort((a, b) => Number(b.debt) - Number(a.debt) || a.name.localeCompare(b.name)),
    });
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

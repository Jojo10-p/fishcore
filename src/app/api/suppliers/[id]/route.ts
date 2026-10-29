import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCompany,
  requirePermission,
} from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

// GET /api/suppliers/[id] — Factures (achats) et paiements du fournisseur
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "purchase:view");
    const companyId = requireCompany(user);
    const { id } = await params;

    const supplier = await prisma.supplier.findFirst({
      where: { id, companyId },
      select: { id: true, name: true, phone: true, email: true, address: true, taxId: true, paymentTermDays: true },
    });
    if (!supplier) throw new ApiError(404, "Fournisseur introuvable");

    const [purchases, payments] = await Promise.all([
      prisma.purchase.findMany({
        where: { supplierId: id, companyId },
        select: {
          id: true,
          reference: true,
          totalAmount: true,
          paidAmount: true,
          dueDate: true,
          createdAt: true,
          center: { select: { name: true } },
          receipts: { select: { id: true, receivedAt: true, reference: true } },
        },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      }),
      prisma.supplierPayment.findMany({
        where: { supplierId: id, companyId },
        select: { id: true, amount: true, method: true, reference: true, createdAt: true, allocations: true, notes: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const debt = purchases.reduce((s, p) => s + Number(p.totalAmount) - Number(p.paidAmount), 0);
    return NextResponse.json({ success: true, data: { ...supplier, debt, purchases, payments } });
  } catch (error) {
    return handleApiError(error, "SUPPLIERS");
  }
}

const updateSchema = z
  .object({
    name: z.string().trim().min(2).optional(),
    phone: z.string().trim().optional(),
    email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
    address: z.string().trim().optional(),
    taxId: z.string().trim().optional(),
    paymentTermDays: z.coerce.number().int().min(0).max(365).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "Aucune modification");

// PATCH /api/suppliers/[id] — Modifier la fiche fournisseur
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "supplier:edit");
    const companyId = requireCompany(user);
    const { id } = await params;
    const data = parseBody(updateSchema, await readJson(req));
    const updated = await prisma.supplier.updateMany({ where: { id, companyId }, data });
    if (updated.count === 0) throw new ApiError(404, "Fournisseur introuvable");
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "SUPPLIERS");
  }
}

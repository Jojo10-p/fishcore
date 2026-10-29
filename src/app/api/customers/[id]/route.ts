import { NextRequest, NextResponse } from "next/server";
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
import { customerUpdateSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

// GET /api/customers/[id] — Fiche client : achats (factures) et devis
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "customer:view");
    const companyId = requireCompany(user);
    const { id } = await params;

    const customer = await prisma.customer.findFirst({
      where: { id, companyId },
      select: { id: true, name: true, phone: true, email: true, address: true, taxId: true, createdAt: true },
    });
    if (!customer) throw new ApiError(404, "Client introuvable");

    const [sales, quotes] = await Promise.all([
      prisma.sale.findMany({
        where: { companyId, customerId: id },
        select: { id: true, saleNumber: true, createdAt: true, totalAmount: true, status: true, deliveryStatus: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.quote.findMany({
        where: { companyId, customerId: id },
        select: { id: true, number: true, createdAt: true, totalAmount: true, status: true, validUntil: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);

    return NextResponse.json({ success: true, data: { ...customer, sales, quotes } });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

// PATCH /api/customers/[id] — Modifier la fiche
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "customer:edit");
    const companyId = requireCompany(user);
    const { id } = await params;
    const data = parseBody(customerUpdateSchema, await readJson(req));
    const updated = await prisma.customer.updateMany({
      where: { id, companyId },
      data: { ...data, ...(data.email !== undefined ? { email: data.email || null } : {}) },
    });
    if (updated.count === 0) throw new ApiError(404, "Client introuvable");
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

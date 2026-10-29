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

const customerSchema = z.object({
  name: z.string().trim().min(2, "Nom du client requis").max(100),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().toLowerCase().email("Email invalide").optional().or(z.literal("")),
  address: z.string().trim().max(200).optional(),
});

// GET /api/customers?search=… — Clients de l'entreprise (ventes à crédit, factures)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);
    const search = req.nextUrl.searchParams.get("search")?.trim();
    const customers = await prisma.customer.findMany({
      where: {
        companyId,
        isActive: true,
        ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }] } : {}),
      },
      select: { id: true, name: true, phone: true, email: true, address: true },
      orderBy: { name: "asc" },
      take: 50,
    });
    return NextResponse.json({ success: true, data: customers });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

// POST /api/customers — Enregistrer un client
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);
    const data = parseBody(customerSchema, await readJson(req));
    const customer = await prisma.customer.create({
      data: { companyId, ...data, email: data.email || null },
      select: { id: true, name: true, phone: true, email: true, address: true },
    });
    return NextResponse.json({ success: true, data: customer }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

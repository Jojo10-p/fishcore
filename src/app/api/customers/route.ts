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
import { hasPermission } from "@/lib/rbac";
import { customerBalances } from "@/lib/finance";

const customerSchema = z.object({
  name: z.string().trim().min(2, "Nom du client requis").max(100),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().toLowerCase().email("Email invalide").optional().or(z.literal("")),
  address: z.string().trim().max(200).optional(),
  creditLimit: z.coerce.number().min(0).nullable().optional(),
});

// GET /api/customers?search=…&withBalance=true — Clients (et leur encours de crédit)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!hasPermission(user.role, "customer:view")) await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const search = sp.get("search")?.trim();
    const withBalance = sp.get("withBalance") === "true" && hasPermission(user.role, "customer:view");

    const customers = await prisma.customer.findMany({
      where: {
        companyId,
        isActive: true,
        ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }] } : {}),
      },
      select: { id: true, name: true, phone: true, email: true, address: true, creditLimit: true, createdAt: true },
      orderBy: { name: "asc" },
      take: withBalance ? 500 : 50,
    });

    if (!withBalance) return NextResponse.json({ success: true, data: customers });

    const balances = await prisma.$transaction((tx) => customerBalances(tx, companyId, customers.map((c) => c.id)));
    const data = customers
      .map((c) => {
        const b = balances.get(c.id);
        return {
          ...c,
          balance: b?.balance.toString() ?? "0",
          creditSales: b?.creditSales.toString() ?? "0",
          payments: b?.payments.toString() ?? "0",
          lastCreditAt: b?.lastCreditAt ?? null,
        };
      })
      .sort((a, b) => Number(b.balance) - Number(a.balance) || a.name.localeCompare(b.name));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

// POST /api/customers — Enregistrer un client (le plafond de crédit est réservé aux responsables)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    // Le caissier crée un client depuis la caisse ; un responsable depuis la fiche clients
    if (!hasPermission(user.role, "customer:edit")) await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);
    const { creditLimit, ...data } = parseBody(customerSchema, await readJson(req));
    if (creditLimit !== undefined && creditLimit !== null) await requirePermission(user, "customer:edit");
    const customer = await prisma.customer.create({
      data: { companyId, ...data, email: data.email || null, creditLimit: creditLimit ?? null },
      select: { id: true, name: true, phone: true, email: true, address: true, creditLimit: true },
    });
    return NextResponse.json({ success: true, data: customer }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

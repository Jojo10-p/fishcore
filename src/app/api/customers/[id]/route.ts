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
import { customerBalances } from "@/lib/finance";

type Params = { params: Promise<{ id: string }> };

// GET /api/customers/[id] — Relevé de compte : ventes à crédit, annulations, règlements
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "customer:view");
    const companyId = requireCompany(user);
    const { id } = await params;

    const customer = await prisma.customer.findFirst({
      where: { id, companyId },
      select: { id: true, name: true, phone: true, email: true, address: true, creditLimit: true, createdAt: true },
    });
    if (!customer) throw new ApiError(404, "Client introuvable");

    const [credits, refunds, payments, balances] = await Promise.all([
      prisma.payment.findMany({
        where: { method: "CREDIT", sale: { customerId: id, companyId } },
        select: { amount: true, createdAt: true, sale: { select: { id: true, saleNumber: true, status: true } } },
      }),
      prisma.refund.findMany({
        where: { method: "CREDIT", sale: { customerId: id, companyId } },
        select: { amount: true, createdAt: true, reason: true, sale: { select: { id: true, saleNumber: true } } },
      }),
      prisma.customerPayment.findMany({
        where: { customerId: id, companyId },
        select: { id: true, amount: true, method: true, reference: true, createdAt: true, notes: true },
      }),
      prisma.$transaction((tx) => customerBalances(tx, companyId, [id])),
    ]);

    // Relevé chronologique avec solde progressif
    const entries = [
      ...credits.map((c) => ({ date: c.createdAt, kind: "SALE" as const, label: `Vente ${c.sale.saleNumber}`, saleId: c.sale.id, debit: Number(c.amount), credit: 0 })),
      ...refunds.map((r) => ({ date: r.createdAt, kind: "REFUND" as const, label: `Annulation ${r.sale.saleNumber}`, saleId: r.sale.id, debit: 0, credit: Number(r.amount) })),
      ...payments.map((p) => ({
        date: p.createdAt,
        kind: "PAYMENT" as const,
        label: `Règlement ${p.method === "CASH" ? "espèces" : p.method === "MOBILE_MONEY" ? "mobile money" : p.method.toLowerCase()}${p.reference ? ` (${p.reference})` : ""}`,
        saleId: null,
        debit: 0,
        credit: Number(p.amount),
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
    let running = 0;
    const statement = entries.map((e) => {
      running = Math.round((running + e.debit - e.credit) * 100) / 100;
      return { ...e, balance: running };
    });

    return NextResponse.json({
      success: true,
      data: { ...customer, balance: balances.get(id)?.balance.toString() ?? "0", statement },
    });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z.string().trim().max(30).optional(),
    address: z.string().trim().max(200).optional(),
    creditLimit: z.coerce.number().min(0).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, "Aucune modification");

// PATCH /api/customers/[id] — Modifier la fiche (dont le plafond de crédit)
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "customer:edit");
    const companyId = requireCompany(user);
    const { id } = await params;
    const data = parseBody(updateSchema, await readJson(req));
    const updated = await prisma.customer.updateMany({ where: { id, companyId }, data });
    if (updated.count === 0) throw new ApiError(404, "Client introuvable");
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

import { NextRequest, NextResponse } from "next/server";
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
import { customerSchema } from "@/lib/validations";

const customerSelect = { id: true, name: true, phone: true, email: true, address: true, taxId: true, createdAt: true } as const;

// GET /api/customers?search=…&withStats=true — Répertoire clients
// (withStats : nombre d'achats, montant total, dernier achat — pour l'écran Clients)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    // La caisse et les devis recherchent un client sans avoir accès à l'écran Clients
    if (!hasPermission(user.role, "customer:view")) await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const search = sp.get("search")?.trim();
    const withStats = sp.get("withStats") === "true" && hasPermission(user.role, "customer:view");

    const customers = await prisma.customer.findMany({
      where: {
        companyId,
        isActive: true,
        ...(search
          ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }, { taxId: { contains: search } }] }
          : {}),
      },
      select: customerSelect,
      orderBy: { name: "asc" },
      take: withStats ? 500 : 30,
    });
    if (!withStats || customers.length === 0) return NextResponse.json({ success: true, data: customers });

    const stats = await prisma.sale.groupBy({
      by: ["customerId"],
      where: { companyId, customerId: { in: customers.map((c) => c.id) }, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { totalAmount: true },
      _max: { createdAt: true },
    });
    const byId = new Map(stats.map((s) => [s.customerId, s]));
    const data = customers.map((c) => {
      const st = byId.get(c.id);
      return {
        ...c,
        salesCount: st?._count._all ?? 0,
        salesTotal: st?._sum.totalAmount?.toString() ?? "0",
        lastPurchaseAt: st?._max.createdAt ?? null,
      };
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

// POST /api/customers — Enregistrer un client (depuis la caisse, un devis ou l'écran Clients)
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!hasPermission(user.role, "customer:edit")) await requirePermission(user, "sale:create");
    const companyId = requireCompany(user);
    const data = parseBody(customerSchema, await readJson(req));
    const customer = await prisma.customer.create({
      data: { companyId, ...data, email: data.email || null },
      select: customerSelect,
    });
    return NextResponse.json({ success: true, data: customer }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "CUSTOMERS");
  }
}

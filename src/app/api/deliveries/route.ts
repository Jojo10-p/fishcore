import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, handleApiError, requireCompany, requirePermission, resolveCenterScope } from "@/lib/auth";

// GET /api/deliveries?centerId=…&search=… — Factures à servir et derniers retraits
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "sale:deliver");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const centerScope = await resolveCenterScope(user, sp.get("centerId"));
    const search = sp.get("search")?.trim();

    const centerFilter: Prisma.SaleWhereInput = centerScope
      ? { centerId: centerScope }
      : user.role === "COMPANY_OWNER"
        ? {}
        : { centerId: { in: user.centerIds } };

    const [pending, recent] = await Promise.all([
      prisma.sale.findMany({
        where: {
          companyId,
          ...centerFilter,
          status: { not: "CANCELLED" },
          deliveryStatus: { in: ["PENDING", "PARTIAL"] },
          ...(search
            ? { OR: [{ saleNumber: { contains: search, mode: "insensitive" } }, { customer: { name: { contains: search, mode: "insensitive" } } }] }
            : {}),
        },
        select: {
          id: true,
          saleNumber: true,
          createdAt: true,
          totalAmount: true,
          deliveryStatus: true,
          customer: { select: { name: true, phone: true } },
          _count: { select: { lines: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
      prisma.delivery.findMany({
        where: { companyId, sale: centerFilter },
        select: { id: true, number: true, createdAt: true, deliveredById: true, sale: { select: { id: true, saleNumber: true, customer: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    // Facture scannée qui n'est plus à servir : dire pourquoi (déjà servie, annulée)
    const exact =
      search && !pending.some((p) => p.saleNumber.toLowerCase() === search.toLowerCase())
        ? await prisma.sale.findFirst({
            where: { companyId, saleNumber: { equals: search, mode: "insensitive" } },
            select: { id: true, saleNumber: true, status: true, deliveryStatus: true, centerId: true },
          })
        : null;

    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(recent.map((d) => d.deliveredById))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

    return NextResponse.json({
      success: true,
      data: { pending, exact, recent: recent.map((d) => ({ ...d, deliveredBy: nameOf.get(d.deliveredById) ?? "" })) },
    });
  } catch (error) {
    return handleApiError(error, "DELIVERY");
  }
}

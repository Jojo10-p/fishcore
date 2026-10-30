import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { inventoryCreateSchema } from "@/lib/validations";
import { nextCompanyNumber } from "@/lib/stock-ops";
import { emptySummary, inventorySummaries } from "@/lib/inventory";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  isUniqueViolation,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
  resolveCenterScope,
} from "@/lib/auth";

const D = Prisma.Decimal;

// GET /api/inventories?centerId=&status= — Inventaires (les plus récents d'abord)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:view");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const centerScope = await resolveCenterScope(user, sp.get("centerId"));
    const status = sp.get("status");

    const inventories = await prisma.inventory.findMany({
      where: {
        companyId,
        ...(centerScope ? { centerId: centerScope } : {}),
        ...(status === "IN_PROGRESS" || status === "VALIDATED" || status === "CANCELLED" ? { status } : {}),
      },
      include: { center: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const summaries = await inventorySummaries(inventories.map((i) => i.id));
    return NextResponse.json({
      success: true,
      data: inventories.map((i) => ({ ...i, summary: summaries.get(i.id) ?? emptySummary })),
    });
  } catch (error) {
    return handleApiError(error, "INVENTORIES");
  }
}

// POST /api/inventories — Ouvre un inventaire : la liste des articles à compter et
// leur stock théorique sont figés ; le stock ne change qu'à la validation.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "inventory:start");
    const companyId = requireCompany(user);
    const data = parseBody(inventoryCreateSchema, await readJson(req));
    await requireCenterAccess(user, data.centerId);

    const categoryFilter = data.categoryIds && data.categoryIds.length > 0 ? { categoryId: { in: data.categoryIds } } : {};
    // Articles actifs du périmètre + tout article encore en stock dans ce centre
    const products = await prisma.product.findMany({
      where: {
        companyId,
        ...categoryFilter,
        OR: [{ isActive: true }, { stocks: { some: { centerId: data.centerId, quantity: { not: 0 } } } }],
      },
      select: { id: true, stocks: { where: { centerId: data.centerId }, select: { quantity: true, avgCost: true } } },
    });
    if (products.length === 0) throw new ApiError(400, "Aucun article à inventorier dans ce périmètre", "EMPTY_INVENTORY");

    const inventory = await prisma.$transaction(async (tx) => {
      const open = await tx.inventory.findFirst({
        where: { centerId: data.centerId, status: "IN_PROGRESS" },
        select: { number: true },
      });
      if (open) {
        throw new ApiError(409, `L'inventaire ${open.number} est déjà en cours dans ce centre : terminez-le ou annulez-le`, "INVENTORY_IN_PROGRESS");
      }
      const number = await nextCompanyNumber(tx, companyId, "inventory");
      const created = await tx.inventory.create({
        data: {
          companyId,
          number,
          centerId: data.centerId,
          label: data.label || null,
          notes: data.notes || null,
          startedById: user.id,
          lines: {
            create: products.map((p) => ({
              productId: p.id,
              theoreticalQty: p.stocks[0]?.quantity ?? new D(0),
              unitCost: p.stocks[0]?.avgCost ?? new D(0),
            })),
          },
        },
      });
      await writeAuditLog(
        {
          eventType: "INVENTORY_STARTED",
          companyId,
          centerId: data.centerId,
          userId: user.id,
          referenceType: "Inventory",
          referenceId: created.id,
          result: "SUCCESS",
          newValues: { number, label: data.label ?? null, articles: products.length, categoryIds: data.categoryIds ?? [] },
          ipAddress: user.ipAddress,
          userAgent: user.userAgent,
        },
        tx
      );
      return created;
    }).catch((e) => {
      // Deux ouvertures simultanées : l'index unique tranche
      if (isUniqueViolation(e)) throw new ApiError(409, "Un inventaire est déjà en cours dans ce centre", "INVENTORY_IN_PROGRESS");
      throw e;
    });

    return NextResponse.json({ success: true, data: inventory }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "INVENTORIES");
  }
}

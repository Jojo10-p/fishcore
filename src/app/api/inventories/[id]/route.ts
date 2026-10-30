import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inventoryCountSchema } from "@/lib/validations";
import { emptySummary, inventorySummaries } from "@/lib/inventory";
import { docCompanySelect } from "@/lib/documents";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";

const D = Prisma.Decimal;
type Ctx = { params: Promise<{ id: string }> };

async function loadInventory(id: string, companyId: string) {
  const inventory = await prisma.inventory.findFirst({
    where: { id, companyId },
    include: { center: { select: { id: true, name: true, code: true, address: true, city: true, phone: true } } },
  });
  if (!inventory) throw new ApiError(404, "Inventaire introuvable");
  return inventory;
}

// GET /api/inventories/[id] — Fiche d'inventaire avec toutes ses lignes
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:view");
    const companyId = requireCompany(user);
    const { id } = await params;
    const inventory = await loadInventory(id, companyId);
    await requireCenterAccess(user, inventory.centerId);

    const [lines, users, summaries, company] = await Promise.all([
      prisma.inventoryLine.findMany({
        where: { inventoryId: id },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              internalCode: true,
              barcode: true,
              trackBatches: true,
              category: { select: { id: true, name: true } },
              baseUnit: { select: { symbol: true, allowsDecimal: true } },
            },
          },
        },
        orderBy: [{ product: { name: "asc" } }],
      }),
      prisma.user.findMany({
        where: { companyId, id: { in: [inventory.startedById, inventory.validatedById, inventory.cancelledById].filter((x): x is string => !!x) } },
        select: { id: true, firstName: true, lastName: true },
      }),
      inventorySummaries([id]),
      prisma.company.findUnique({ where: { id: companyId }, select: docCompanySelect }),
    ]);
    const name = (uid: string | null) => {
      const u = users.find((x) => x.id === uid);
      return u ? `${u.firstName} ${u.lastName}`.trim() : null;
    };
    return NextResponse.json({
      success: true,
      data: {
        ...inventory,
        startedBy: name(inventory.startedById),
        validatedBy: name(inventory.validatedById),
        cancelledBy: name(inventory.cancelledById),
        summary: summaries.get(id) ?? emptySummary,
        company,
        lines,
      },
    });
  } catch (error) {
    return handleApiError(error, "INVENTORIES");
  }
}

// PATCH /api/inventories/[id] — Saisie des quantités comptées.
// Le stock théorique est relu au moment du comptage : l'écart ne compte pas
// les ventes faites avant (déjà parties du rayon) ni après (appliquées à la validation).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "inventory:start");
    const companyId = requireCompany(user);
    const { id } = await params;
    const { lines } = parseBody(inventoryCountSchema, await readJson(req));
    const inventory = await loadInventory(id, companyId);
    await requireCenterAccess(user, inventory.centerId);

    const productIds = [...new Set(lines.map((l) => l.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true, name: true, baseUnit: { select: { allowsDecimal: true, symbol: true } } },
    });
    if (products.length !== productIds.length) throw new ApiError(400, "Article inconnu dans la saisie");
    for (const l of lines) {
      const p = products.find((x) => x.id === l.productId)!;
      if (l.countedQty !== null && !p.baseUnit.allowsDecimal && !Number.isInteger(l.countedQty)) {
        throw new ApiError(400, `« ${p.name} » se compte en nombre entier (${p.baseUnit.symbol})`, "INTEGER_QUANTITY");
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "inventories" WHERE "id" = ${id} FOR UPDATE`;
      if (locked?.status !== "IN_PROGRESS") throw new ApiError(409, "Cet inventaire est clos : il ne peut plus être modifié", "INVENTORY_CLOSED");

      const stocks = await tx.stock.findMany({
        where: { centerId: inventory.centerId, productId: { in: productIds } },
        select: { productId: true, quantity: true, avgCost: true },
      });
      const now = new Date();
      for (const l of lines) {
        const s = stocks.find((x) => x.productId === l.productId);
        const theoretical = s ? new D(s.quantity) : new D(0);
        const counted = l.countedQty === null ? null : new D(l.countedQty);
        const values = {
          theoreticalQty: theoretical,
          countedQty: counted,
          discrepancy: counted ? counted.sub(theoretical) : null,
          unitCost: s ? new D(s.avgCost) : new D(0),
          discrepancyReason: l.reason || null,
          countedAt: counted ? now : null,
          countedById: counted ? user.id : null,
        };
        // Un article trouvé en rayon mais absent de la liste est ajouté
        await tx.inventoryLine.upsert({
          where: { inventoryId_productId: { inventoryId: id, productId: l.productId } },
          create: { inventoryId: id, productId: l.productId, ...values },
          update: values,
        });
      }
      await tx.inventory.update({ where: { id }, data: { updatedAt: now } });
      return tx.inventoryLine.findMany({
        where: { inventoryId: id, productId: { in: productIds } },
        select: { productId: true, theoreticalQty: true, countedQty: true, discrepancy: true, unitCost: true, discrepancyReason: true, countedAt: true },
      });
    });

    const summaries = await inventorySummaries([id]);
    return NextResponse.json({ success: true, data: { lines: updated, summary: summaries.get(id) ?? emptySummary } });
  } catch (error) {
    return handleApiError(error, "INVENTORIES");
  }
}

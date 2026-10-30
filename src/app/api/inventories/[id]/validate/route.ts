import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { inventoryValidateSchema } from "@/lib/validations";
import { applyStockChange } from "@/lib/stock-ops";
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

// POST /api/inventories/[id]/validate — Applique les écarts au stock (définitif).
//   { uncounted: "keep" | "zero" } : sort des articles non comptés.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "inventory:validate");
    const companyId = requireCompany(user);
    const { id } = await params;
    const { uncounted } = parseBody(inventoryValidateSchema, await readJson(req));

    const inventory = await prisma.inventory.findFirst({ where: { id, companyId }, select: { id: true, centerId: true, number: true } });
    if (!inventory) throw new ApiError(404, "Inventaire introuvable");
    await requireCenterAccess(user, inventory.centerId);

    const result = await prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status" FROM "inventories" WHERE "id" = ${id} FOR UPDATE`;
        if (locked?.status !== "IN_PROGRESS") throw new ApiError(409, "Cet inventaire est déjà clos", "INVENTORY_CLOSED");

        const lines = await tx.inventoryLine.findMany({
          where: { inventoryId: id },
          include: { product: { select: { id: true, name: true, baseUnitId: true, trackBatches: true } } },
        });
        const counted = lines.filter((l) => l.countedQty !== null);
        if (counted.length === 0 && uncounted === "keep") {
          throw new ApiError(400, "Aucun article compté : saisissez au moins une quantité", "NOTHING_COUNTED");
        }

        const now = new Date();
        let adjusted = 0;
        let gapValue = new D(0);
        const clamped: string[] = [];

        for (const line of lines) {
          let gap: Prisma.Decimal;
          if (line.countedQty === null) {
            if (uncounted !== "zero") continue;
            // Non compté et « mettre à zéro » : tout le stock restant sort
            const s = await tx.stock.findUnique({
              where: { centerId_productId: { centerId: inventory.centerId, productId: line.productId } },
              select: { quantity: true, avgCost: true },
            });
            const current = s ? new D(s.quantity) : new D(0);
            gap = current.negated();
            await tx.inventoryLine.update({
              where: { id: line.id },
              data: { theoreticalQty: current, countedQty: 0, discrepancy: gap, unitCost: s?.avgCost ?? 0, countedAt: now, countedById: user.id, discrepancyReason: "Non compté — mis à zéro" },
            });
          } else {
            gap = new D(line.discrepancy ?? 0);
          }
          if (gap.isZero()) continue;

          // Ne jamais descendre sous la part réservée (ni sous zéro)
          const s = await tx.stock.findUnique({
            where: { centerId_productId: { centerId: inventory.centerId, productId: line.productId } },
            select: { quantity: true, reservedQty: true },
          });
          const current = s ? new D(s.quantity) : new D(0);
          const floor = s ? new D(s.reservedQty) : new D(0);
          let delta = gap;
          if (current.add(delta).lt(floor)) {
            delta = floor.sub(current);
            clamped.push(line.product.name);
          }
          if (delta.isZero()) continue;

          const { avgCost } = await applyStockChange(tx, {
            centerId: inventory.centerId,
            productId: line.productId,
            productName: line.product.name,
            unitId: line.product.baseUnitId,
            trackBatches: line.product.trackBatches,
            delta,
            type: "INVENTORY_ADJUST",
            referenceType: "Inventory",
            referenceId: id,
            notes: `Inventaire ${inventory.number}${line.discrepancyReason ? ` — ${line.discrepancyReason}` : ""}`,
            userId: user.id,
            batchMode: "shrinkage",
            newLotNumber: inventory.number,
          });
          adjusted++;
          gapValue = gapValue.add(delta.mul(avgCost));
        }

        const done = await tx.inventory.update({
          where: { id },
          data: { status: "VALIDATED", validatedAt: now, validatedById: user.id },
        });
        await writeAuditLog(
          {
            eventType: "INVENTORY_VALIDATED",
            companyId,
            centerId: inventory.centerId,
            userId: user.id,
            referenceType: "Inventory",
            referenceId: id,
            result: "SUCCESS",
            newValues: {
              number: inventory.number,
              counted: counted.length,
              lines: lines.length,
              adjusted,
              gapValue: gapValue.toDecimalPlaces(0).toString(),
              uncounted,
              clamped,
            },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
        return { inventory: done, adjusted, gapValue: gapValue.toDecimalPlaces(0).toString(), clamped };
      },
      { timeout: 60_000, maxWait: 10_000 }
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, "INVENTORIES");
  }
}

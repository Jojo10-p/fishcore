import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { transferCreateSchema } from "@/lib/validations";
import { applyStockChange, nextCompanyNumber } from "@/lib/stock-ops";
import {
  ApiError,
  getCurrentUser,
  handleApiError,
  hasCompanyWideAccess,
  parseBody,
  readJson,
  requireCenterAccess,
  requireCompany,
  requirePermission,
} from "@/lib/auth";

const D = Prisma.Decimal;

// GET /api/transfers?centerId=&status= — Transferts au départ OU à destination du centre
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:view");
    const companyId = requireCompany(user);
    const sp = req.nextUrl.searchParams;
    const centerId = sp.get("centerId");
    const status = sp.get("status");
    if (centerId) await requireCenterAccess(user, centerId);

    const visible = hasCompanyWideAccess(user) ? undefined : { in: user.centerIds };
    const centerWhere: Prisma.StockTransferWhereInput = centerId
      ? { OR: [{ fromCenterId: centerId }, { toCenterId: centerId }] }
      : visible
        ? { OR: [{ fromCenterId: visible }, { toCenterId: visible }] }
        : {};

    const transfers = await prisma.stockTransfer.findMany({
      where: {
        companyId,
        ...centerWhere,
        ...(status === "IN_TRANSIT" || status === "RECEIVED" || status === "CANCELLED" ? { status } : {}),
      },
      include: {
        fromCenter: { select: { id: true, name: true, code: true } },
        toCenter: { select: { id: true, name: true, code: true } },
        lines: { select: { quantity: true, receivedQty: true, unitCost: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const data = transfers.map(({ lines, ...t }) => ({
      ...t,
      lineCount: lines.length,
      value: lines.reduce((s, l) => s.add(new D(l.quantity).mul(l.unitCost)), new D(0)).toDecimalPlaces(0).toString(),
      missingValue: lines
        .reduce((s, l) => (l.receivedQty === null ? s : s.add(new D(l.quantity).sub(l.receivedQty).mul(l.unitCost))), new D(0))
        .toDecimalPlaces(0)
        .toString(),
    }));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, "TRANSFERS");
  }
}

// POST /api/transfers — Expédition : la marchandise quitte le centre d'origine
// tout de suite (en transit) et n'entre à destination qu'à la réception.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "stock:transfer");
    const companyId = requireCompany(user);
    const data = parseBody(transferCreateSchema, await readJson(req));
    await requireCenterAccess(user, data.fromCenterId);

    // La destination peut être n'importe quel centre actif de l'entreprise
    const to = await prisma.center.findFirst({ where: { id: data.toCenterId, companyId }, select: { id: true, name: true, status: true } });
    if (!to) throw new ApiError(404, "Centre de destination introuvable");
    if (to.status !== "ACTIVE") throw new ApiError(400, `Le centre « ${to.name} » n'est pas actif`, "CENTER_INACTIVE");

    const productIds = data.lines.map((l) => l.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true, name: true, baseUnitId: true, trackBatches: true, baseUnit: { select: { allowsDecimal: true, symbol: true } } },
    });
    if (products.length !== productIds.length) throw new ApiError(400, "Article inconnu dans le transfert");
    for (const l of data.lines) {
      const p = products.find((x) => x.id === l.productId)!;
      if (!p.baseUnit.allowsDecimal && !Number.isInteger(l.quantity)) {
        throw new ApiError(400, `« ${p.name} » se transfère en nombre entier (${p.baseUnit.symbol})`, "INTEGER_QUANTITY");
      }
    }

    const transfer = await prisma.$transaction(
      async (tx) => {
        const number = await nextCompanyNumber(tx, companyId, "transfer");
        const created = await tx.stockTransfer.create({
          data: {
            companyId,
            number,
            fromCenterId: data.fromCenterId,
            toCenterId: data.toCenterId,
            notes: data.notes || null,
            createdById: user.id,
            lines: {
              create: data.lines.map((l) => {
                const p = products.find((x) => x.id === l.productId)!;
                return { productId: l.productId, quantity: l.quantity, unitId: p.baseUnitId };
              }),
            },
          },
          include: { lines: true },
        });

        let value = new D(0);
        for (const line of created.lines) {
          const p = products.find((x) => x.id === line.productId)!;
          const out = await applyStockChange(tx, {
            centerId: data.fromCenterId,
            productId: p.id,
            productName: p.name,
            unitId: p.baseUnitId,
            trackBatches: p.trackBatches,
            delta: new D(line.quantity).negated(),
            type: "TRANSFER_OUT",
            referenceType: "StockTransfer",
            referenceId: created.id,
            notes: `Transfert ${number} vers ${to.name}`,
            userId: user.id,
            batchMode: "fefo",
          });
          value = value.add(new D(line.quantity).mul(out.avgCost));
          await tx.stockTransferLine.update({
            where: { id: line.id },
            data: {
              unitCost: out.avgCost.toDecimalPlaces(4),
              batches: out.batchesOut.length > 0 ? (out.batchesOut as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            },
          });
        }

        await writeAuditLog(
          {
            eventType: "STOCK_TRANSFERRED",
            companyId,
            centerId: data.fromCenterId,
            userId: user.id,
            referenceType: "StockTransfer",
            referenceId: created.id,
            result: "SUCCESS",
            newValues: { number, toCenterId: data.toCenterId, lines: data.lines.length, value: value.toDecimalPlaces(0).toString() },
            ipAddress: user.ipAddress,
            userAgent: user.userAgent,
          },
          tx
        );
        return created;
      },
      { timeout: 60_000, maxWait: 10_000 }
    );

    return NextResponse.json({ success: true, data: transfer }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "TRANSFERS");
  }
}

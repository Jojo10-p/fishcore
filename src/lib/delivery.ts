import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/auth";

// ─────────────────────────────────────────────
// Retrait de marchandise au magasin
// ─────────────────────────────────────────────
// Le client paie à la caisse, puis se fait servir au magasin sur présentation
// de sa facture, en une ou plusieurs fois (ex. 50 sacs de ciment enlevés en
// trois voyages). Le stock est déjà sorti à la vente ; ici on trace la remise
// physique pour qu'une même facture ne serve jamais deux fois.

type Db = Prisma.TransactionClient;
const D = Prisma.Decimal;

export type DeliveryRequest = { saleLineId: string; quantity: number }[];

export function deliveryStatusOf(lines: Array<{ quantity: Prisma.Decimal; deliveredQuantity: Prisma.Decimal }>) {
  const delivered = lines.filter((l) => new D(l.deliveredQuantity).gte(l.quantity)).length;
  if (delivered === lines.length) return "DELIVERED" as const;
  return lines.some((l) => new D(l.deliveredQuantity).gt(0)) ? ("PARTIAL" as const) : ("PENDING" as const);
}

/**
 * Enregistre une remise de marchandise. La vente est verrouillée : deux
 * magasiniers qui servent la même facture en même temps ne peuvent pas
 * remettre ensemble plus que ce qui a été payé.
 */
export async function recordDelivery(
  tx: Db,
  params: { companyId: string; saleId: string; userId: string; request: DeliveryRequest; notes?: string }
) {
  const { companyId, saleId, request } = params;
  const [sale] = await tx.$queryRaw<{ id: string; status: string; saleNumber: string; centerId: string }[]>`
    SELECT "id", "status", "saleNumber", "centerId" FROM "sales" WHERE "id" = ${saleId} AND "companyId" = ${companyId} FOR UPDATE`;
  if (!sale) throw new ApiError(404, "Facture introuvable");
  if (sale.status === "CANCELLED") throw new ApiError(409, `La facture ${sale.saleNumber} est annulée : ne rien remettre`, "SALE_CANCELLED");
  const pendingCancel = await tx.cancellation.count({ where: { saleId, status: "PENDING" } });
  if (pendingCancel > 0) {
    throw new ApiError(409, `Une annulation de la facture ${sale.saleNumber} est en attente : attendre la décision du responsable`, "CANCELLATION_PENDING");
  }

  const lines = await tx.saleLine.findMany({
    where: { saleId },
    select: { id: true, quantity: true, deliveredQuantity: true, product: { select: { name: true } } },
  });
  const byId = new Map(lines.map((l) => [l.id, l]));
  const wanted = new Map<string, Prisma.Decimal>();
  for (const r of request) {
    const line = byId.get(r.saleLineId);
    if (!line) throw new ApiError(400, "Article absent de cette facture", "UNKNOWN_LINE");
    wanted.set(r.saleLineId, (wanted.get(r.saleLineId) ?? new D(0)).add(r.quantity));
  }

  for (const [lineId, qty] of wanted) {
    const line = byId.get(lineId)!;
    const left = new D(line.quantity).sub(line.deliveredQuantity);
    if (new D(line.quantity).isInteger() && !qty.isInteger()) {
      throw new ApiError(400, `« ${line.product.name} » : quantité entière attendue`, "INTEGER_QUANTITY");
    }
    if (qty.gt(left)) {
      throw new ApiError(
        409,
        left.lte(0)
          ? `« ${line.product.name} » a déjà été entièrement remis`
          : `« ${line.product.name} » : reste ${left.toString()} à remettre, pas ${qty.toString()}`,
        "OVER_DELIVERY"
      );
    }
    await tx.saleLine.update({ where: { id: lineId }, data: { deliveredQuantity: { increment: qty } } });
  }

  const after = await tx.saleLine.findMany({ where: { saleId }, select: { quantity: true, deliveredQuantity: true } });
  const deliveryStatus = deliveryStatusOf(after);
  await tx.sale.update({ where: { id: saleId }, data: { deliveryStatus } });

  const number = (await tx.delivery.count({ where: { saleId } })) + 1;
  const delivery = await tx.delivery.create({
    data: {
      companyId,
      saleId,
      deliveredById: params.userId,
      number,
      notes: params.notes || null,
      lines: { create: [...wanted].map(([saleLineId, quantity]) => ({ saleLineId, quantity })) },
    },
    select: { id: true, number: true, createdAt: true },
  });
  return { delivery, deliveryStatus, sale };
}

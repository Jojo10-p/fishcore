import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/auth";

// ─────────────────────────────────────────────
// Règles de calcul d'une vente (prix, unités, paiements)
// ─────────────────────────────────────────────

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

type SaleLineInput = {
  productId: string;
  quantity: number;
  unitId?: string;
  unitPrice: number;
  discount?: number;
};

/**
 * Calcule les lignes avec les prix de la base et convertit les quantités
 * dans l'unité de base du produit (celle du stock).
 */
export async function priceLines(companyId: string, lines: SaleLineInput[], createdOffline: boolean) {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, companyId, isActive: true },
    select: {
      id: true,
      name: true,
      sellingPrice: true,
      baseUnitId: true,
      unitConversions: { select: { fromUnitId: true, toUnitId: true, factor: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const baseQtyByProduct = new Map<string, Decimal>();
  const baseUnitByProduct = new Map<string, string>();
  const productNames = new Map<string, string>();
  let subtotal = new D(0);
  let discountAmount = new D(0);

  const priced = lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw new ApiError(400, "Produit introuvable ou inactif", "UNKNOWN_PRODUCT");
    productNames.set(product.id, product.name);
    baseUnitByProduct.set(product.id, product.baseUnitId);

    // Conversion d'unité : uniquement si elle est définie explicitement (cahier §8.2)
    let factor = new D(1);
    const unitId = line.unitId ?? product.baseUnitId;
    if (unitId !== product.baseUnitId) {
      const conv = product.unitConversions.find(
        (c) => c.fromUnitId === unitId && c.toUnitId === product.baseUnitId
      );
      if (!conv) {
        throw new ApiError(400, `Aucune conversion définie pour cette unité sur « ${product.name} »`, "NO_CONVERSION");
      }
      factor = new D(conv.factor);
    }

    // Prix de l'unité vendue = prix de base × facteur
    const unitPrice = new D(product.sellingPrice).mul(factor).toDecimalPlaces(2);
    const clientPrice = new D(line.unitPrice);
    if (createdOffline && !clientPrice.equals(unitPrice)) {
      // Le prix a changé pendant la période hors connexion : décision humaine requise
      throw new ApiError(
        409,
        `Le prix de « ${product.name} » a changé depuis la vente hors connexion`,
        "PRICE_MISMATCH"
      );
    }

    const qty = new D(line.quantity);
    const discount = new D(line.discount ?? 0);
    if (discount.gt(unitPrice)) {
      throw new ApiError(400, `Remise supérieure au prix sur « ${product.name} »`, "INVALID_DISCOUNT");
    }
    const gross = unitPrice.mul(qty).toDecimalPlaces(2);
    const lineDiscount = discount.mul(qty).toDecimalPlaces(2);
    subtotal = subtotal.add(gross);
    discountAmount = discountAmount.add(lineDiscount);

    const baseQty = qty.mul(factor);
    baseQtyByProduct.set(product.id, (baseQtyByProduct.get(product.id) ?? new D(0)).add(baseQty));

    return {
      productId: product.id,
      quantity: qty,
      unitId,
      unitPrice,
      discount,
      lineTotal: gross.sub(lineDiscount),
    };
  });

  return {
    lines: priced,
    subtotal,
    discountAmount,
    totalAmount: subtotal.sub(discountAmount),
    baseQtyByProduct,
    baseUnitByProduct,
    productNames,
  };
}

type PaymentInput = { method: Prisma.PaymentCreateInput["method"]; amount: number; reference?: string };

/**
 * Vérifie que les paiements couvrent exactement le total.
 * Un excédent n'est accepté que s'il peut être rendu sur les espèces :
 * les montants enregistrés sont alors nets de la monnaie rendue.
 */
export function settlePayments(payments: PaymentInput[], total: Decimal) {
  const paid = payments.reduce((s, p) => s.add(p.amount), new D(0));
  if (paid.lt(total)) {
    throw new ApiError(400, `Montant payé insuffisant (manque ${total.sub(paid).toString()})`, "UNDERPAID");
  }

  let change = paid.sub(total);
  const cash = payments.filter((p) => p.method === "CASH").reduce((s, p) => s.add(p.amount), new D(0));
  if (change.gt(cash)) {
    throw new ApiError(400, "Le trop-perçu ne peut être rendu que sur un paiement en espèces", "OVERPAID");
  }

  return payments
    .map((p) => {
      let amount = new D(p.amount);
      let notes: string | undefined;
      if (p.method === "CASH" && change.gt(0)) {
        const given = amount;
        const deducted = Prisma.Decimal.min(change, amount);
        amount = amount.sub(deducted);
        change = change.sub(deducted);
        notes = `Reçu ${given.toString()}, rendu ${deducted.toString()}`;
      }
      return { method: p.method, amount, reference: p.reference, notes };
    })
    .filter((p) => p.amount.gt(0));
}

import { BusinessType, Prisma } from "@prisma/client";
import { ApiError } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business-profiles";

type Tx = Prisma.TransactionClient;

// ─────────────────────────────────────────────
// Catalogue : préréglages métier, conditionnements, codes-barres
// ─────────────────────────────────────────────

/** Crée les unités et catégories proposées par le profil métier (sans doublon). */
export async function seedCompanyCatalog(tx: Tx, companyId: string, businessType: BusinessType) {
  const profile = getBusinessProfile(businessType);
  await tx.unit.createMany({
    data: profile.units.map((u) => ({
      companyId,
      name: u.name,
      symbol: u.symbol,
      kind: u.kind,
      allowsDecimal: u.allowsDecimal,
      isBaseUnit: u.symbol === profile.defaultUnit,
    })),
    skipDuplicates: true,
  });
  await tx.category.createMany({
    data: profile.categories.map((name, i) => ({ companyId, name, sortOrder: i })),
    skipDuplicates: true,
  });
}

/**
 * Vérifie qu'un code-barres n'est utilisé par aucun autre produit ni
 * conditionnement de l'entreprise (une douchette doit trouver UN seul article).
 */
export async function assertBarcodeFree(tx: Tx, companyId: string, barcode: string, exceptProductId?: string) {
  const [product, packaging] = await Promise.all([
    tx.product.findFirst({
      where: { companyId, barcode, ...(exceptProductId ? { id: { not: exceptProductId } } : {}) },
      select: { name: true },
    }),
    tx.unitConversion.findFirst({
      where: { barcode, product: { companyId }, ...(exceptProductId ? { productId: { not: exceptProductId } } : {}) },
      select: { product: { select: { name: true } } },
    }),
  ]);
  const owner = product?.name ?? packaging?.product.name;
  if (owner) throw new ApiError(409, `Le code-barres ${barcode} est déjà utilisé par « ${owner} »`, "BARCODE_TAKEN");
}

/** Une référence article (ex. « S08 ») désigne un seul article : elle se tape à la caisse. */
export async function assertReferenceFree(tx: Tx, companyId: string, internalCode: string, exceptProductId?: string) {
  const other = await tx.product.findFirst({
    where: {
      companyId,
      internalCode: { equals: internalCode, mode: "insensitive" },
      ...(exceptProductId ? { id: { not: exceptProductId } } : {}),
    },
    select: { name: true },
  });
  if (other) throw new ApiError(409, `La référence ${internalCode} est déjà utilisée par « ${other.name} »`, "REFERENCE_TAKEN");
}

export interface PackagingInput {
  unitId: string;
  factor: number;
  sellingPrice?: number | null;
  barcode?: string | null;
}

/**
 * Remplace les conditionnements vendables d'un produit.
 * Ex. quincaillerie : 1 boîte = 100 vis ; supermarché : 1 pack = 6 bouteilles (prix propre).
 */
export async function replacePackagings(
  tx: Tx,
  params: { companyId: string; productId: string; baseUnitId: string; packagings: PackagingInput[]; productBarcode?: string | null }
) {
  const { companyId, productId, baseUnitId, packagings, productBarcode } = params;
  const unitIds = packagings.map((p) => p.unitId);
  if (new Set(unitIds).size !== unitIds.length) throw new ApiError(400, "Un même conditionnement est déclaré deux fois");
  if (unitIds.includes(baseUnitId)) throw new ApiError(400, "Le conditionnement doit être différent de l'unité de base");

  if (unitIds.length) {
    const units = await tx.unit.count({ where: { id: { in: unitIds }, OR: [{ companyId }, { companyId: null }] } });
    if (units !== unitIds.length) throw new ApiError(400, "Unité de conditionnement invalide");
  }

  const barcodes = packagings.map((p) => p.barcode).filter((b): b is string => !!b);
  if (new Set(barcodes).size !== barcodes.length || (productBarcode && barcodes.includes(productBarcode))) {
    throw new ApiError(400, "Chaque code-barres doit être unique");
  }
  for (const b of barcodes) await assertBarcodeFree(tx, companyId, b, productId);

  await tx.unitConversion.deleteMany({ where: { productId } });
  if (packagings.length) {
    await tx.unitConversion.createMany({
      data: packagings.map((p) => ({
        productId,
        fromUnitId: p.unitId,
        toUnitId: baseUnitId,
        factor: p.factor,
        sellingPrice: p.sellingPrice ?? null,
        barcode: p.barcode || null,
      })),
    });
  }
}

/** Sélection Prisma commune pour exposer un produit au client (et au mode hors ligne). */
export const productClientSelect = {
  id: true,
  name: true,
  internalCode: true,
  barcode: true,
  brand: true,
  description: true,
  attributes: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  purchasePrice: true,
  sellingPrice: true,
  stockAlertQty: true,
  taxRate: true,
  trackBatches: true,
  requiresExpiry: true,
  requiresPrescription: true,
  isActive: true,
  baseUnitId: true,
  baseUnit: { select: { id: true, name: true, symbol: true, allowsDecimal: true } },
  unitConversions: {
    select: {
      fromUnitId: true,
      factor: true,
      sellingPrice: true,
      barcode: true,
      fromUnit: { select: { name: true, symbol: true, allowsDecimal: true } },
    },
  },
} satisfies Prisma.ProductSelect;

export type ProductForClient = Prisma.ProductGetPayload<{ select: typeof productClientSelect }>;

/** Format compact pour IndexedDB (nombres, pas de Decimal). */
export function toOfflineProduct(p: ProductForClient) {
  return {
    id: p.id,
    name: p.name,
    internalCode: p.internalCode ?? undefined,
    barcode: p.barcode ?? undefined,
    brand: p.brand ?? undefined,
    categoryName: p.category?.name,
    attributes: (p.attributes as Record<string, string> | null) ?? undefined,
    sellingPrice: Number(p.sellingPrice),
    purchasePrice: Number(p.purchasePrice),
    taxRate: Number(p.taxRate),
    baseUnitId: p.baseUnitId,
    baseUnitSymbol: p.baseUnit.symbol,
    allowsDecimal: p.baseUnit.allowsDecimal,
    trackBatches: p.trackBatches,
    requiresPrescription: p.requiresPrescription,
    stockAlertQty: Number(p.stockAlertQty),
    isActive: p.isActive,
    packagings: p.unitConversions.map((c) => ({
      unitId: c.fromUnitId,
      name: c.fromUnit.name,
      symbol: c.fromUnit.symbol,
      factor: Number(c.factor),
      sellingPrice: c.sellingPrice !== null ? Number(c.sellingPrice) : Number(p.sellingPrice) * Number(c.factor),
      barcode: c.barcode ?? undefined,
    })),
  };
}
export type OfflineProductPayload = ReturnType<typeof toOfflineProduct>;

import { hasPermission } from "@/lib/rbac";
import { NextRequest, NextResponse } from "next/server";
import { LOW_STOCK_THRESHOLD } from "@/lib/app-config";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
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
import { getBusinessProfile } from "@/lib/business-profiles";
import { scheduleStockAlerts } from "@/lib/stock-alerts";

// ─────────────────────────────────────────────
// POST /api/products/import — Reprise du catalogue d'un autre logiciel
// ─────────────────────────────────────────────
// - Un article est retrouvé par sa référence (sinon par sa désignation exacte).
// - Nouveaux articles : créés avec le prix de vente indiqué.
// - Articles existants : prix mis à jour seulement si demandé (historisé).
// - Stock : le stock du centre choisi est AMENÉ à la quantité indiquée
//   (mouvement « ajustement d'inventaire », visible et justifié).
// - dryRun : tout est calculé puis annulé, pour montrer le résultat avant d'importer.
// Tout ou rien : une seule transaction.

// Import d'un gros catalogue : jusqu'à 2 minutes (limite des fonctions Vercel)
export const maxDuration = 120;

const D = Prisma.Decimal;
const num = z.number().finite().min(0).max(1e10);
const schema = z.object({
  centerId: z.string().optional(),
  updateExisting: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  defaultUnitId: z.string().optional(),
  rows: z
    .array(
      z.object({
        line: z.number().int().optional(),
        reference: z.string().trim().max(40).optional(),
        name: z.string().trim().min(1).max(150),
        sellingPrice: num.optional(),
        purchasePrice: num.optional(),
        stock: num.optional(),
        unit: z.string().trim().max(40).optional(),
        category: z.string().trim().max(60).optional(),
        barcode: z.string().trim().max(40).optional(),
      })
    )
    .min(1, "Aucun article à importer")
    .max(3000, "3 000 articles au plus par import"),
});

class DryRunRollback extends Error {}

interface Report {
  created: number;
  updated: number;
  unchanged: number;
  stockSet: number;
  skipped: Array<{ line?: number; name: string; reason: string }>;
  warnings: Array<{ line?: number; name: string; message: string }>;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    await requirePermission(user, "product:create");
    const companyId = requireCompany(user);
    const data = parseBody(schema, await readJson(req));
    const withStock = data.rows.some((r) => r.stock !== undefined);
    if (withStock) {
      if (!data.centerId) throw new ApiError(400, "Choisissez le centre (magasin) dont le stock est importé");
      await requirePermission(user, "stock:adjust");
      await requireCenterAccess(user, data.centerId);
    }
    if (data.updateExisting) await requirePermission(user, "product:edit");

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { businessType: true, vatEnabled: true, defaultTaxRate: true },
    });
    const profile = getBusinessProfile(company.businessType);
    const units = await prisma.unit.findMany({ where: { OR: [{ companyId }, { companyId: null }] }, select: { id: true, symbol: true, name: true } });
    const unitByKey = new Map<string, string>();
    for (const u of units) {
      unitByKey.set(u.symbol.toLowerCase(), u.id);
      unitByKey.set(u.name.toLowerCase(), u.id);
    }
    const defaultUnitId =
      (data.defaultUnitId && units.some((u) => u.id === data.defaultUnitId) ? data.defaultUnitId : undefined) ??
      unitByKey.get(profile.defaultUnit.toLowerCase());
    if (!defaultUnitId) throw new ApiError(400, "Unité par défaut introuvable");

    const report: Report = { created: 0, updated: 0, unchanged: 0, stockSet: 0, skipped: [], warnings: [] };

    try {
      await prisma.$transaction(
        async (tx) => {
          const existing = await tx.product.findMany({
            where: { companyId },
            select: { id: true, name: true, internalCode: true, barcode: true, sellingPrice: true, purchasePrice: true, trackBatches: true },
          });
          const byRef = new Map(existing.filter((p) => p.internalCode).map((p) => [p.internalCode!.toLowerCase(), p]));
          const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
          const barcodes = new Set(existing.map((p) => p.barcode).filter(Boolean) as string[]);
          const packBarcodes = await tx.unitConversion.findMany({ where: { product: { companyId }, barcode: { not: null } }, select: { barcode: true } });
          for (const b of packBarcodes) barcodes.add(b.barcode!);

          const categories = new Map(
            (await tx.category.findMany({ where: { companyId }, select: { id: true, name: true } })).map((c) => [c.name.toLowerCase(), c.id])
          );
          const categoryId = async (name?: string) => {
            if (!name) return undefined;
            const key = name.toLowerCase();
            if (!categories.has(key)) {
              const c = await tx.category.create({ data: { companyId, name }, select: { id: true } });
              categories.set(key, c.id);
            }
            return categories.get(key);
          };

          const stockTargets: Array<{ productId: string; qty: Prisma.Decimal; cost?: number; row: (typeof data.rows)[number] }> = [];

          for (const row of data.rows) {
            const found = (row.reference && byRef.get(row.reference.toLowerCase())) || (!row.reference ? byName.get(row.name.toLowerCase()) : undefined);
            let barcode = row.barcode;
            if (barcode && barcodes.has(barcode) && found?.barcode !== barcode) {
              report.warnings.push({ line: row.line, name: row.name, message: `code-barres ${barcode} déjà utilisé : ignoré` });
              barcode = undefined;
            }

            let productId: string;
            let trackBatches = false;
            if (!found) {
              if (row.sellingPrice === undefined) {
                report.skipped.push({ line: row.line, name: row.name, reason: "prix de vente manquant" });
                continue;
              }
              let unitId = defaultUnitId;
              if (row.unit) {
                const u = unitByKey.get(row.unit.toLowerCase());
                if (u) unitId = u;
                else report.warnings.push({ line: row.line, name: row.name, message: `unité « ${row.unit} » inconnue : unité par défaut utilisée` });
              }
              const purchasePrice = row.purchasePrice ?? 0;
              const created = await tx.product.create({
                data: {
                  companyId,
                  name: row.name,
                  internalCode: row.reference || null,
                  barcode: barcode || null,
                  categoryId: await categoryId(row.category),
                  baseUnitId: unitId,
                  purchasePrice,
                  sellingPrice: row.sellingPrice,
                  stockAlertQty: LOW_STOCK_THRESHOLD,
                  trackBatches: profile.productDefaults.trackBatches || profile.productDefaults.requiresExpiry,
                  requiresExpiry: profile.productDefaults.requiresExpiry,
                  requiresPrescription: profile.productDefaults.requiresPrescription,
                  taxRate: company.vatEnabled ? company.defaultTaxRate : 0,
                },
                select: { id: true, trackBatches: true },
              });
              await tx.productPriceHistory.create({
                data: { productId: created.id, purchasePrice, sellingPrice: row.sellingPrice, changedById: user.id },
              });
              if (row.reference) byRef.set(row.reference.toLowerCase(), { ...created, name: row.name, internalCode: row.reference, barcode: barcode ?? null, sellingPrice: new D(row.sellingPrice), purchasePrice: new D(purchasePrice) });
              if (barcode) barcodes.add(barcode);
              productId = created.id;
              trackBatches = created.trackBatches;
              report.created++;
            } else {
              productId = found.id;
              trackBatches = found.trackBatches;
              // Changer un prix existant : direction et gérant seulement
              const priceChange =
                data.updateExisting &&
                hasPermission(user.role, "product:price") &&
                ((row.sellingPrice !== undefined && !new D(row.sellingPrice).equals(found.sellingPrice)) ||
                  (row.purchasePrice !== undefined && !new D(row.purchasePrice).equals(found.purchasePrice)));
              const extra = data.updateExisting && (row.category || (barcode && !found.barcode));
              if (priceChange || extra) {
                const sellingPrice = row.sellingPrice ?? Number(found.sellingPrice);
                const purchasePrice = row.purchasePrice ?? Number(found.purchasePrice);
                await tx.product.update({
                  where: { id: found.id },
                  data: {
                    sellingPrice,
                    purchasePrice,
                    ...(row.category ? { categoryId: await categoryId(row.category) } : {}),
                    ...(barcode && !found.barcode ? { barcode } : {}),
                  },
                });
                if (priceChange) {
                  await tx.productPriceHistory.create({ data: { productId: found.id, purchasePrice, sellingPrice, changedById: user.id } });
                  await writeAuditLog(
                    {
                      eventType: "PRICE_CHANGED",
                      companyId,
                      userId: user.id,
                      referenceType: "Product",
                      referenceId: found.id,
                      result: "SUCCESS",
                      reason: "Import de la liste d'articles",
                      oldValues: { sellingPrice: found.sellingPrice.toString(), purchasePrice: found.purchasePrice.toString() },
                      newValues: { sellingPrice: String(sellingPrice), purchasePrice: String(purchasePrice) },
                    },
                    tx
                  );
                }
                report.updated++;
              } else {
                report.unchanged++;
              }
            }

            if (row.stock !== undefined && data.centerId) {
              if (trackBatches) {
                report.warnings.push({ line: row.line, name: row.name, message: "article suivi par lot : saisir son stock par une réception (n° de lot, péremption)" });
              } else {
                stockTargets.push({ productId, qty: new D(row.stock), cost: row.purchasePrice, row });
              }
            }
          }

          // Stock du centre : amené à la quantité importée (ordre fixe des verrous)
          stockTargets.sort((a, b) => a.productId.localeCompare(b.productId));
          for (const t of stockTargets) {
            const stock = await tx.stock.upsert({
              where: { centerId_productId: { centerId: data.centerId!, productId: t.productId } },
              create: { centerId: data.centerId!, productId: t.productId, quantity: 0, avgCost: t.cost ?? 0 },
              update: {},
              select: { id: true },
            });
            const [locked] = await tx.$queryRaw<{ quantity: Prisma.Decimal; reservedQty: Prisma.Decimal; avgCost: Prisma.Decimal }[]>`
              SELECT "quantity", "reservedQty", "avgCost" FROM "stocks" WHERE "id" = ${stock.id} FOR UPDATE`;
            const delta = t.qty.sub(locked.quantity);
            if (delta.isZero()) continue;
            if (t.qty.lt(locked.reservedQty)) {
              report.warnings.push({ line: t.row.line, name: t.row.name, message: `stock non modifié : ${locked.reservedQty.toString()} réservés aux caisses hors ligne` });
              continue;
            }
            await tx.stock.update({
              where: { id: stock.id },
              data: {
                quantity: t.qty,
                // Coût moyen inconnu jusqu'ici : on prend le prix d'achat importé
                ...(new D(locked.avgCost).isZero() && t.cost ? { avgCost: t.cost } : {}),
                version: { increment: 1 },
              },
            });
            await tx.stockMovement.create({
              data: {
                stockId: stock.id,
                type: "INVENTORY_ADJUST",
                quantity: delta,
                referenceType: "Import",
                notes: "Stock repris à l'import du catalogue",
                performedById: user.id,
                centerId: data.centerId!,
              },
            });
            report.stockSet++;
          }

          await writeAuditLog(
            {
              eventType: "PRICE_CHANGED",
              companyId,
              userId: user.id,
              referenceType: "Import",
              result: "SUCCESS",
              reason: `Import du catalogue : ${report.created} créé(s), ${report.updated} mis à jour`,
              newValues: { created: report.created, updated: report.updated, skipped: report.skipped.length },
              ipAddress: user.ipAddress,
              userAgent: user.userAgent,
            },
            tx
          );
          if (report.stockSet > 0) {
            await writeAuditLog(
              {
                eventType: "STOCK_ADJUSTED",
                companyId,
                centerId: data.centerId,
                userId: user.id,
                referenceType: "Import",
                result: "SUCCESS",
                reason: `Stock repris à l'import : ${report.stockSet} article(s)`,
                newValues: { articles: report.stockSet },
                ipAddress: user.ipAddress,
                userAgent: user.userAgent,
              },
              tx
            );
          }
          if (data.dryRun) throw new DryRunRollback();
        },
        { timeout: 110_000, maxWait: 10_000 }
      );
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }

    if (!data.dryRun) scheduleStockAlerts(companyId);
    return NextResponse.json({ success: true, data: { ...report, dryRun: data.dryRun } }, { status: data.dryRun ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, "PRODUCTS");
  }
}

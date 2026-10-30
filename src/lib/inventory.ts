import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const D = Prisma.Decimal;

export interface InventorySummary {
  lineCount: number;
  countedCount: number;
  /** Somme des écarts valorisés au CMP (négatif = manquant). */
  gapValue: string;
  shortageValue: string;
  surplusValue: string;
}

/** Résumé chiffré de plusieurs inventaires (une requête). */
export async function inventorySummaries(ids: string[]): Promise<Map<string, InventorySummary>> {
  const map = new Map<string, InventorySummary>();
  if (ids.length === 0) return map;
  const rows = await prisma.$queryRaw<
    Array<{ inventoryId: string; lines: bigint; counted: bigint; gap: Prisma.Decimal | null; shortage: Prisma.Decimal | null; surplus: Prisma.Decimal | null }>
  >`
    SELECT "inventoryId",
           COUNT(*) AS lines,
           COUNT("countedQty") AS counted,
           SUM(COALESCE("discrepancy", 0) * "unitCost") AS gap,
           SUM(LEAST(COALESCE("discrepancy", 0), 0) * "unitCost") AS shortage,
           SUM(GREATEST(COALESCE("discrepancy", 0), 0) * "unitCost") AS surplus
      FROM "inventory_lines"
     WHERE "inventoryId" IN (${Prisma.join(ids)})
     GROUP BY "inventoryId"`;
  for (const r of rows) {
    map.set(r.inventoryId, {
      lineCount: Number(r.lines),
      countedCount: Number(r.counted),
      gapValue: new D(r.gap ?? 0).toDecimalPlaces(0).toString(),
      shortageValue: new D(r.shortage ?? 0).toDecimalPlaces(0).toString(),
      surplusValue: new D(r.surplus ?? 0).toDecimalPlaces(0).toString(),
    });
  }
  return map;
}

export const emptySummary: InventorySummary = { lineCount: 0, countedCount: 0, gapValue: "0", shortageValue: "0", surplusValue: "0" };

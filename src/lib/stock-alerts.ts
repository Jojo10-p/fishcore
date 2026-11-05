import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LOW_STOCK_THRESHOLD } from "@/lib/app-config";
import { managerDevices, sendPush, type PushPayload } from "@/lib/push";

// ─────────────────────────────────────────────
// Alertes de stock → notifications sur le téléphone du gérant et du patron
// ─────────────────────────────────────────────
// Pour chaque article de chaque boutique :
//  • « Moitié vendue » : une seule fois quand le stock descend à la moitié de ce
//    qu'il y avait juste après le dernier ajout. Simple information, elle disparaît seule.
//  • « Presque épuisé » : dès que le stock descend à 7 (seuil fixe), puis à CHAQUE
//    nouvelle baisse (6, 5, 4…) tant que du stock n'a pas été rajouté. Elle reste
//    affichée jusqu'à « Bien reçu ».
// Un ajout de stock (réception, transfert, inventaire, annulation de vente)
// remet le suivi à zéro à partir du nouveau niveau.

const D = Prisma.Decimal;

export interface StockEvent {
  kind: "low" | "half";
  companyId: string;
  centerId: string;
  productId: string;
  productName: string;
  unit: string;
  centerName: string;
  quantity: number;
  refQty: number;
  /** Dernier fournisseur de cet article (pour le recommander). */
  supplier?: { name: string; phone: string | null } | null;
}

interface Row {
  centerId: string;
  productId: string;
  quantity: Prisma.Decimal;
  productName: string;
  unit: string;
  centerName: string;
  watchId: string | null;
  lastQty: Prisma.Decimal | null;
  refQty: Prisma.Decimal | null;
  halfNotifiedAt: Date | null;
  lowNotifiedQty: Prisma.Decimal | null;
}

/** Compare le stock au dernier état connu et renvoie les notifications à envoyer. */
export async function syncStockWatches(companyId: string): Promise<StockEvent[]> {
  const threshold = new D(LOW_STOCK_THRESHOLD);
  return prisma.$transaction(async (tx) => {
    // Une seule vérification à la fois par entreprise (deux ventes simultanées)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"stock-watch:" + companyId}))`;
    const rows = await tx.$queryRaw<Row[]>`
      SELECT s."centerId", s."productId", s."quantity", p."name" AS "productName", u."symbol" AS unit, c."name" AS "centerName",
             w."id" AS "watchId", w."lastQty", w."refQty", w."halfNotifiedAt", w."lowNotifiedQty"
        FROM "stocks" s
        JOIN "products" p ON p."id" = s."productId"
        JOIN "units" u ON u."id" = p."baseUnitId"
        JOIN "centers" c ON c."id" = s."centerId"
        LEFT JOIN "stock_watches" w ON w."centerId" = s."centerId" AND w."productId" = s."productId"
       WHERE p."companyId" = ${companyId} AND p."isActive" = TRUE`;

    const events: StockEvent[] = [];
    for (const r of rows) {
      const q = new D(r.quantity);
      const base = { companyId, centerId: r.centerId, productId: r.productId, productName: r.productName, unit: r.unit, centerName: r.centerName };
      if (!r.watchId) {
        // Premier passage : on enregistre le niveau actuel, sans notifier
        await tx.stockWatch.create({ data: { companyId, centerId: r.centerId, productId: r.productId, lastQty: q, refQty: q } });
        continue;
      }
      const last = new D(r.lastQty!);
      if (q.equals(last)) continue;
      if (q.greaterThan(last)) {
        // Du stock a été rajouté : nouveau point de départ
        await tx.stockWatch.update({ where: { id: r.watchId }, data: { lastQty: q, refQty: q, halfNotifiedAt: null, lowNotifiedQty: null } });
        continue;
      }
      // Le stock a baissé
      const ref = new D(r.refQty!);
      const data: Prisma.StockWatchUpdateInput = { lastQty: q };
      if (q.lessThanOrEqualTo(threshold)) {
        if (r.lowNotifiedQty === null || q.lessThan(r.lowNotifiedQty)) {
          events.push({ kind: "low", ...base, quantity: Number(q), refQty: Number(ref) });
          data.lowNotifiedQty = q;
        }
        if (!r.halfNotifiedAt) data.halfNotifiedAt = new Date(); // l'alerte « presque épuisé » suffit
      } else if (!r.halfNotifiedAt && ref.greaterThan(0) && q.lessThanOrEqualTo(ref.dividedBy(2))) {
        events.push({ kind: "half", ...base, quantity: Number(q), refQty: Number(ref) });
        data.halfNotifiedAt = new Date();
      }
      await tx.stockWatch.update({ where: { id: r.watchId }, data });
    }
    return events;
  });
}

const PLURALS: Record<string, string> = { bidon: "bidons", seau: "seaux", "fût": "fûts", fut: "futs", carton: "cartons", bouteille: "bouteilles", sachet: "sachets", boite: "boites", "boîte": "boîtes" };
const n = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const unitLabel = (unit: string, q: number) => (Math.abs(q) > 1 ? (PLURALS[unit.toLowerCase()] ?? unit) : unit);

/** Texte de la notification. */
export function stockNotification(e: StockEvent, multiCenter = false): PushPayload {
  const where = multiCenter ? ` (${e.centerName})` : "";
  const from = e.supplier ? ` Acheté chez ${e.supplier.name}${e.supplier.phone ? ` : contactez-le au ${e.supplier.phone}` : ""}.` : "";
  if (e.kind === "half") {
    return {
      title: "Moitié du stock vendue",
      body: `${e.productName}${where} : il reste ${n(e.quantity)} ${unitLabel(e.unit, e.quantity)} sur ${n(e.refQty)}.`,
      tag: `half-${e.centerId}-${e.productId}`,
      url: "/stock",
      requireAck: false,
    };
  }
  if (e.quantity <= 0) {
    return {
      title: "Rupture de stock",
      body: `${e.productName}${where} est épuisé.${from || " Pensez à recommander."}`,
      tag: `low-${e.centerId}-${e.productId}`,
      url: "/stock?alerte=1",
      requireAck: true,
    };
  }
  return {
    title: "Stock presque épuisé",
    body: `Plus que ${n(e.quantity)} ${unitLabel(e.unit, e.quantity)} de ${e.productName}${where}.${from}`,
    tag: `low-${e.centerId}-${e.productId}`,
    url: "/stock?alerte=1",
    requireAck: true,
  };
}

/** Envoie les notifications au(x) gérant(s) de la boutique et au patron. */
export async function notifyStockEvents(events: StockEvent[]): Promise<void> {
  if (!events.length) return;
  const companyId = events[0].companyId;
  const centers = await prisma.center.count({ where: { companyId } });
  for (const e of events) {
    if (e.kind === "low" && e.supplier === undefined) e.supplier = await lastSupplier(e.productId, e.centerId);
    const devices = await managerDevices(companyId, e.centerId);
    await sendPush(devices, stockNotification(e, centers > 1));
  }
}

/** Fournisseur du dernier arrivage validé de cet article dans cette boutique. */
async function lastSupplier(productId: string, centerId: string): Promise<{ name: string; phone: string | null } | null> {
  const row = await prisma.goodsReceiptLine.findFirst({
    where: { productId, receipt: { centerId, validatedAt: { not: null }, supplierId: { not: null } } },
    orderBy: { receipt: { validatedAt: "desc" } },
    select: { receipt: { select: { supplier: { select: { name: true, phone: true } } } } },
  });
  return row?.receipt.supplier ?? null;
}

const pending = new Set<Promise<void>>();

/**
 * À appeler après toute opération qui change le stock : la vérification tourne
 * après l'envoi de la réponse (la caisse n'attend pas les notifications).
 */
export function scheduleStockAlerts(companyId: string | null | undefined): void {
  if (!companyId) return;
  const job = async () => {
    try {
      await notifyStockEvents(await syncStockWatches(companyId));
    } catch (e) {
      console.error("[stock-alerts]", e);
    }
  };
  try {
    after(job);
  } catch {
    // Hors requête (tests, scripts) : exécution directe, attendable avec waitForStockAlerts()
    const p = job().finally(() => pending.delete(p));
    pending.add(p);
  }
}

/** Tests : attend la fin des vérifications lancées hors requête. */
export async function waitForStockAlerts(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

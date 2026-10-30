import { Prisma, type EmecfDocType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/data-crypto";
import {
  EmecfError,
  finalizeInvoice,
  getStatus,
  submitInvoice,
  type EmecfInvoiceRequest,
  type EmecfInvoiceResponse,
  type EmecfMode,
} from "@/lib/emecf/client";

// ─────────────────────────────────────────────
// Normalisation des factures (e-MECeF)
// ─────────────────────────────────────────────
// Chaque vente d'une entreprise abonnée reçoit un document FV ; une vente
// normalisée puis annulée reçoit un avoir FA. Le traitement est reprenable :
//   PENDING ──POST──▶ SUBMITTED (uid enregistré) ──PUT confirm──▶ NORMALIZED
// Une coupure entre deux étapes ne crée ni doublon ni facture perdue : l'uid est
// enregistré dès sa réception, et une demande restée en attente à la DGI sans
// trace chez nous (envoi interrompu) est annulée avant tout nouvel envoi.

export const TAX_GROUPS: Record<string, { label: string; rate: number }> = {
  A: { label: "Exonéré", rate: 0 },
  B: { label: "Taxable — TVA 18 %", rate: 18 },
  C: { label: "Exportation de produits taxables", rate: 0 },
  D: { label: "TVA — régime d'exception", rate: 18 },
  E: { label: "Régime fiscal TPS", rate: 0 },
  F: { label: "Réservé", rate: 0 },
};

const PAYMENT_NAMES: Record<string, string> = {
  CASH: "ESPECES",
  MOBILE_MONEY: "MOBILEMONEY",
  CARD: "CARTEBANCAIRE",
  TRANSFER: "VIREMENT",
  MIXED: "AUTRE",
  CREDIT: "CREDIT",
};

/** Bail : un document en cours de traitement n'est pas repris par une autre requête avant ce délai. */
const LEASE_MS = 60_000;
/** Attente avant nouvel essai après une panne réseau (croissante, plafonnée). */
const backoffMs = (attempts: number) => Math.min(30 * 60_000, 30_000 * 2 ** Math.min(attempts, 6));

export const emecfDocumentSelect = {
  id: true,
  type: true,
  status: true,
  mode: true,
  total: true,
  totals: true,
  codeMecefDgi: true,
  qrCode: true,
  counters: true,
  nim: true,
  dgiDateTime: true,
  lastError: true,
  attempts: true,
  normalizedAt: true,
} satisfies Prisma.EmecfDocumentSelect;

export type EmecfDocumentView = Prisma.EmecfDocumentGetPayload<{ select: typeof emecfDocumentSelect }>;

/** Code MECeF/DGI sans tirets (24 caractères) : référence d'un avoir. */
export const compactCode = (code: string) => code.replace(/[^A-Za-z0-9]/g, "");

const int = (v: Prisma.Decimal | number | string) => Math.round(Number(v));

type SaleForEmecf = Prisma.SaleGetPayload<{
  include: {
    lines: { include: { product: { select: { name: true; internalCode: true; emecfTaxGroup: true } } } };
    payments: true;
    customer: { select: { name: true; phone: true; taxId: true; address: true } };
    cashier: { select: { id: true; firstName: true; lastName: true } };
  };
}>;

/** Prépare la facture telle que la DGI l'attend (montants entiers, TTC). */
export function buildInvoiceRequest(
  sale: SaleForEmecf,
  company: { taxId: string; emecfDefaultTaxGroup: string; emecfAib: string | null },
  type: EmecfDocType,
  reference?: string
): EmecfInvoiceRequest {
  const items = sale.lines.map((l) => {
    const qty = Number(l.quantity);
    const unit = Number(l.unitPrice);
    const net = unit - Number(l.discount);
    const taxGroup = l.product.emecfTaxGroup ?? company.emecfDefaultTaxGroup;
    const code = l.product.internalCode ?? undefined;
    const name = l.product.name.slice(0, 120);
    if (Number.isInteger(net)) {
      return {
        ...(code ? { code } : {}),
        name,
        price: net,
        quantity: qty,
        taxGroup,
        ...(Number(l.discount) > 0 && Number.isInteger(unit) ? { originalPrice: unit, priceModification: `Remise ${int(l.discount)} par unité` } : {}),
      };
    }
    // Prix unitaire non entier : la ligne est envoyée pour son montant total
    return { ...(code ? { code } : {}), name: `${name} (${qty} × ${net})`.slice(0, 120), price: int(l.lineTotal), quantity: 1, taxGroup };
  });

  const total = int(sale.totalAmount);
  // Paiements : la monnaie rendue est retirée des espèces pour que la somme égale le total
  const pays = sale.payments.map((p) => ({ name: PAYMENT_NAMES[p.method] ?? "AUTRE", amount: int(p.amount) }));
  let excess = pays.reduce((s, p) => s + p.amount, 0) - total;
  for (const p of [...pays.filter((x) => x.name === "ESPECES"), ...pays.filter((x) => x.name !== "ESPECES").reverse()]) {
    if (excess <= 0) break;
    const cut = Math.min(excess, p.amount);
    p.amount -= cut;
    excess -= cut;
  }
  const payment = pays.filter((p) => p.amount > 0);

  const c = sale.customer;
  const client = c ? { ...(c.taxId ? { ifu: c.taxId } : {}), name: c.name, ...(c.phone ? { contact: c.phone } : {}), ...(c.address ? { address: c.address } : {}) } : undefined;

  return {
    ifu: company.taxId,
    type,
    ...(company.emecfAib === "A" || company.emecfAib === "B" ? { aib: company.emecfAib } : {}),
    ...(reference ? { reference } : {}),
    items,
    ...(client ? { client } : {}),
    operator: { id: sale.cashier.id.slice(0, 30), name: `${sale.cashier.firstName} ${sale.cashier.lastName}`.trim() || "Caisse" },
    ...(payment.length ? { payment } : {}),
  };
}

/** Écart toléré entre notre total et celui de la DGI (arrondis ligne par ligne). */
const tolerance = (lines: number) => Math.max(1, lines);

interface CompanyEmecf {
  id: string;
  taxId: string | null;
  emecfEnabled: boolean;
  emecfMode: string;
  emecfTokenEnc: string | null;
  emecfDefaultTaxGroup: string;
  emecfAib: string | null;
}

const companyEmecfSelect = {
  id: true,
  taxId: true,
  emecfEnabled: true,
  emecfMode: true,
  emecfTokenEnc: true,
  emecfDefaultTaxGroup: true,
  emecfAib: true,
} satisfies Prisma.CompanySelect;

function credentials(company: CompanyEmecf): { mode: EmecfMode; token: string; ifu: string } {
  if (!company.emecfTokenEnc) throw new EmecfError("auth", "Jeton e-MCF non renseigné (Paramètres → Facture normalisée)");
  if (!company.taxId || !/^\d{13}$/.test(company.taxId)) throw new EmecfError("rejected", "IFU de l'entreprise manquant ou invalide (13 chiffres)");
  return { mode: company.emecfMode === "production" ? "production" : "test", token: decryptSecret(company.emecfTokenEnc), ifu: company.taxId };
}

/** Crée le document à normaliser s'il n'existe pas (entreprise abonnée seulement). */
export async function ensureDocument(saleId: string, type: EmecfDocType): Promise<string | null> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { companyId: true } });
  if (!sale) return null;
  const company = await prisma.company.findUnique({ where: { id: sale.companyId }, select: { emecfEnabled: true, emecfMode: true } });
  if (!company?.emecfEnabled) return null;
  const doc = await prisma.emecfDocument.upsert({
    where: { saleId_type: { saleId, type } },
    create: { companyId: sale.companyId, saleId, type, mode: company.emecfMode },
    update: {},
    select: { id: true },
  });
  return doc.id;
}

/**
 * Annule à la DGI les demandes en attente qui ne correspondent à aucun de nos
 * documents « SUBMITTED » (envoi interrompu avant l'enregistrement de l'uid).
 */
async function reconcilePending(companyId: string, mode: EmecfMode, token: string): Promise<number> {
  const status = await getStatus(mode, token);
  const pending = status.pendingRequestsList ?? [];
  if (pending.length === 0) return 0;
  const known = new Set(
    (await prisma.emecfDocument.findMany({ where: { companyId, status: "SUBMITTED", uid: { in: pending.map((p) => p.uid) } }, select: { uid: true } })).map((d) => d.uid)
  );
  let cancelled = 0;
  for (const p of pending) {
    if (known.has(p.uid)) continue;
    await finalizeInvoice(mode, token, p.uid, "cancel").catch(() => undefined);
    cancelled++;
  }
  return cancelled;
}

function totalsOf(r: EmecfInvoiceResponse) {
  const pick = ["ta", "tb", "tc", "td", "taa", "tab", "tac", "tad", "tae", "taf", "hab", "had", "vab", "vad", "aib", "ts", "total"] as const;
  return Object.fromEntries(pick.filter((k) => r[k] !== undefined && r[k] !== null).map((k) => [k, r[k]]));
}

/**
 * Traite un document : envoi, contrôle du total, confirmation. Ne lève pas :
 * renvoie l'état final. Sûr en concurrence (bail en base) et après coupure.
 */
export async function processDocument(docId: string): Promise<EmecfDocumentView | null> {
  // 1. Prise du bail : un seul traitement à la fois par document
  const now = new Date();
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "emecf_documents"
       SET "attempts" = "attempts" + 1, "nextAttemptAt" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = NOW()
     WHERE "id" = ${docId} AND "status" IN ('PENDING', 'SUBMITTED', 'FAILED')
       AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
 RETURNING "id"`;
  if (claimed.length === 0) return prisma.emecfDocument.findUnique({ where: { id: docId }, select: emecfDocumentSelect });

  const doc = await prisma.emecfDocument.findUniqueOrThrow({ where: { id: docId } });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: doc.companyId }, select: companyEmecfSelect });
  const save = (data: Prisma.EmecfDocumentUpdateInput) => prisma.emecfDocument.update({ where: { id: docId }, data, select: emecfDocumentSelect });

  try {
    const { mode, token, ifu } = credentials(company);
    let uid = doc.status === "SUBMITTED" ? doc.uid : null;
    let total = doc.total;

    if (!uid) {
      const sale = await prisma.sale.findUniqueOrThrow({
        where: { id: doc.saleId },
        include: {
          lines: { orderBy: { id: "asc" }, include: { product: { select: { name: true, internalCode: true, emecfTaxGroup: true } } } },
          payments: true,
          customer: { select: { name: true, phone: true, taxId: true, address: true } },
          cashier: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      let reference: string | undefined;
      if (doc.type === "FA") {
        const fv = await prisma.emecfDocument.findUnique({ where: { saleId_type: { saleId: doc.saleId, type: "FV" } }, select: { status: true, codeMecefDgi: true } });
        if (fv?.status !== "NORMALIZED" || !fv.codeMecefDgi) throw new EmecfError("rejected", "La facture d'origine n'est pas normalisée : l'avoir attend");
        reference = compactCode(fv.codeMecefDgi);
      }
      // Un essai précédent a pu être interrompu après l'envoi : on nettoie d'abord
      if (doc.attempts > 0) await reconcilePending(company.id, mode, token);

      const body = buildInvoiceRequest(sale, { taxId: ifu, emecfDefaultTaxGroup: company.emecfDefaultTaxGroup, emecfAib: company.emecfAib }, doc.type, reference);
      const res = await submitInvoice(mode, token, body);
      if (!res.uid) throw new EmecfError("rejected", res.errorDesc || "La DGI n'a pas renvoyé d'identifiant de transaction");
      uid = res.uid;
      total = typeof res.total === "number" ? res.total : null;
      await save({ status: "SUBMITTED", uid, total, totals: totalsOf(res) as Prisma.InputJsonValue, mode, lastError: null });

      // Contrôle : la DGI doit retrouver notre total (sinon on annule, rien n'est émis)
      const expected = int(sale.totalAmount) + (typeof res.aib === "number" ? res.aib : 0);
      if (total === null || Math.abs(total - expected) > tolerance(sale.lines.length)) {
        await finalizeInvoice(mode, token, uid, "cancel").catch(() => undefined);
        return save({
          status: "FAILED",
          uid: null,
          nextAttemptAt: null,
          lastError: `Total DGI (${total ?? "?"}) différent du total de la facture (${expected}) : vérifiez les groupes de taxe`,
        });
      }
    }

    // 2. Confirmation : éléments de sécurité à imprimer
    const sec = await finalizeInvoice(mode, token, uid, "confirm");
    if (!sec.codeMECeFDGI || !sec.qrCode) throw new EmecfError("rejected", sec.errorDesc || "La DGI n'a pas renvoyé le code MECeF/DGI");
    return save({
      status: "NORMALIZED",
      codeMecefDgi: sec.codeMECeFDGI,
      qrCode: sec.qrCode,
      counters: sec.counters ?? null,
      nim: sec.nim ?? null,
      dgiDateTime: sec.dateTime ?? null,
      normalizedAt: new Date(),
      nextAttemptAt: null,
      lastError: null,
    });
  } catch (e) {
    const err = e instanceof EmecfError ? e : new EmecfError("server", (e as Error).message);
    const current = await prisma.emecfDocument.findUniqueOrThrow({ where: { id: docId }, select: { status: true, attempts: true } });
    // uid perdu ou expiré côté DGI : on repart d'un nouvel envoi
    const uidGone = current.status === "SUBMITTED" && err.kind === "rejected";
    if (err.retryable) {
      return save({ lastError: err.message, nextAttemptAt: new Date(Date.now() + backoffMs(current.attempts)) });
    }
    return save({
      status: uidGone ? "PENDING" : "FAILED",
      ...(uidGone ? { uid: null } : {}),
      lastError: err.message,
      // Jeton ou données à corriger : nouvel essai manuel (ou au prochain réglage)
      nextAttemptAt: uidGone ? null : new Date(Date.now() + 6 * 3600_000),
    });
  }
}

/** Normalise une vente juste après son enregistrement (délai borné : la vente n'attend jamais la DGI). */
export async function normalizeSale(saleId: string, maxWaitMs = 12_000): Promise<EmecfDocumentView | null> {
  const docId = await ensureDocument(saleId, "FV");
  if (!docId) return null;
  const work = processDocument(docId);
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), maxWaitMs));
  const res = await Promise.race([work, timeout]);
  return res ?? prisma.emecfDocument.findUnique({ where: { id: docId }, select: emecfDocumentSelect });
}

/**
 * Annulation d'une vente : avoir FA si la facture est normalisée ; si elle n'a
 * jamais été émise, son document est simplement retiré (rien n'existe à la DGI).
 */
export async function onSaleCancelled(saleId: string): Promise<EmecfDocumentView | null> {
  const fv = await prisma.emecfDocument.findUnique({ where: { saleId_type: { saleId, type: "FV" } } });
  if (!fv) return null;
  if (fv.status === "NORMALIZED") {
    const docId = await ensureDocument(saleId, "FA");
    return docId ? processDocument(docId) : null;
  }
  if (fv.status === "SUBMITTED" && fv.uid) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: fv.companyId }, select: companyEmecfSelect });
    try {
      const { mode, token } = credentials(company);
      await finalizeInvoice(mode, token, fv.uid, "cancel");
    } catch {
      /* la DGI annule d'elle-même les demandes non confirmées */
    }
  }
  await prisma.emecfDocument.delete({ where: { id: fv.id } });
  return null;
}

/** Reprend les documents en attente d'une entreprise (les plus anciens d'abord). */
export async function processPending(companyId: string, limit = 5): Promise<{ processed: number; normalized: number }> {
  const due = await prisma.emecfDocument.findMany({
    where: {
      companyId,
      status: { in: ["PENDING", "SUBMITTED", "FAILED"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      sale: { status: { not: "CANCELLED" } },
    },
    orderBy: [{ type: "desc" }, { createdAt: "asc" }], // FV avant FA
    take: limit,
    select: { id: true },
  });
  // Avoirs des ventes annulées (FV normalisée)
  const credits = await prisma.emecfDocument.findMany({
    where: { companyId, type: "FA", status: { in: ["PENDING", "SUBMITTED", "FAILED"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    take: limit,
    select: { id: true },
  });
  let normalized = 0;
  const ids = [...new Set([...due, ...credits].map((d) => d.id))].slice(0, limit);
  for (const id of ids) {
    const r = await processDocument(id);
    if (r?.status === "NORMALIZED") normalized++;
  }
  return { processed: ids.length, normalized };
}

/** Vérifie un jeton auprès de la DGI (IFU, NIM, validité). */
export async function checkToken(mode: EmecfMode, token: string) {
  return getStatus(mode, token);
}

// Reprise « au fil de l'eau » : déclenchée par l'activité des caisses, au plus
// une fois par minute et par entreprise (par instance du serveur).
const lastSweep = new Map<string, number>();
export async function sweepIfDue(companyId: string): Promise<void> {
  const now = Date.now();
  if (now - (lastSweep.get(companyId) ?? 0) < 60_000) return;
  lastSweep.set(companyId, now);
  const due = await prisma.emecfDocument.count({
    where: { companyId, status: { in: ["PENDING", "SUBMITTED", "FAILED"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
  });
  if (due > 0) await processPending(companyId, 5);
}

import crypto from "crypto";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getJwtSecret } from "@/lib/secrets";

// ─────────────────────────────────────────────
// Facture normalisée e-MECeF (DGI Bénin, API « e-MCF »)
// ─────────────────────────────────────────────
// À chaque vente : 1) POST /invoice (la DGI calcule les taxes et renvoie un uid),
// 2) PUT /invoice/{uid}/confirm (la DGI renvoie le code MECeF/DGI, le QR code,
// les compteurs et le NIM, imprimés sur la facture). Annulation d'une vente
// déjà normalisée : facture d'avoir (FA) qui reprend le code de la facture d'origine.
//
// Rien n'est bloquant : si la DGI ne répond pas, la vente est enregistrée
// et la facture normalisée part plus tard (relance automatique ou bouton).
// Le jeton DGI est chiffré en base (AES-256-GCM) et jamais renvoyé au navigateur.

export const MECEF_URLS = {
  TEST: process.env.MECEF_TEST_URL ?? "https://developper.impots.bj/sygmef-emcf/api",
  PROD: process.env.MECEF_PROD_URL ?? "https://sygmef.impots.bj/emcf/api",
} as const;

export type MecefMode = keyof typeof MECEF_URLS;

/** Groupes de taxe e-MECeF (prix TTC, la DGI calcule la taxe). */
export const TAX_GROUPS: Record<string, string> = {
  A: "A — Exonéré",
  B: "B — Taxable TVA 18 %",
  C: "C — Exportation",
  D: "D — TVA régime d'exception 18 %",
  E: "E — Régime TPS (petite entreprise)",
  F: "F — Réservé",
};

const PAYMENT_NAMES: Record<string, string> = {
  CASH: "ESPECES",
  MOBILE_MONEY: "MOBILEMONEY",
  CARD: "CARTEBANCAIRE",
  TRANSFER: "VIREMENT",
  CHEQUE: "CHEQUES",
  CREDIT: "CREDIT",
};

const TIMEOUT_MS = 12_000;
const LOCK_MS = 60_000;
const MAX_AUTO_ATTEMPTS = 20;

// ── Chiffrement du jeton ─────────────────────
function tokenKey(): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(getJwtSecret()), Buffer.alloc(0), Buffer.from("fishcore-mecef-token"), 32));
}

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decryptToken(value: string): string | null {
  try {
    const [v, iv, tag, enc] = value.split(".");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── Appels à la DGI ──────────────────────────
export class MecefError extends Error {
  constructor(
    message: string,
    /** Refus de la DGI (données à corriger) — à la différence d'une panne réseau */
    public readonly rejected = false,
    /** Code d'erreur applicatif de la DGI (ex. « 1 » : trop de factures en attente) */
    public readonly code?: string
  ) {
    super(message);
  }
}

interface Conn {
  baseUrl: string;
  token: string;
}

async function dgi<T>(conn: Conn, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${conn.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new MecefError("Serveur de la DGI injoignable");
  }
  const json = (await res.json().catch(() => null)) as (T & { errorCode?: string | number | null; errorDesc?: string | null }) | null;
  if (res.status === 401 || res.status === 403) throw new MecefError("Jeton DGI refusé ou expiré", true);
  if (!res.ok) {
    const desc = json?.errorDesc ?? `Erreur ${res.status} du serveur de la DGI`;
    // 4xx : la DGI refuse les données ; 5xx : panne, on réessaiera
    throw new MecefError(desc, res.status >= 400 && res.status < 500);
  }
  if (!json) throw new MecefError("Réponse illisible du serveur de la DGI");
  if (json.errorCode && String(json.errorCode) !== "0") {
    const code = String(json.errorCode);
    // Code 1 : trop de factures en attente chez la DGI — ce n'est pas un refus des données
    throw new MecefError(`${json.errorDesc ?? "Refus de la DGI"} (code ${code})`, code !== "1", code);
  }
  return json;
}

async function connection(companyId: string): Promise<(Conn & { ifu: string; mode: MecefMode; taxGroup: string }) | null> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { mecefEnabled: true, mecefMode: true, mecefTokenEnc: true, taxId: true, mecefTaxGroup: true },
  });
  if (!c?.mecefEnabled || !c.mecefTokenEnc || !c.taxId) return null;
  const token = decryptToken(c.mecefTokenEnc);
  if (!token) return null;
  const mode: MecefMode = c.mecefMode === "PROD" ? "PROD" : "TEST";
  return { baseUrl: MECEF_URLS[mode], token, ifu: c.taxId.trim(), mode, taxGroup: c.mecefTaxGroup };
}

export async function mecefActive(companyId: string): Promise<boolean> {
  return (await connection(companyId)) !== null;
}

export interface MecefStatus {
  status?: boolean;
  version?: string;
  ifu?: string;
  nim?: string;
  tokenValid?: string;
  serverDateTime?: string;
  pendingRequestsCount?: number;
  pendingRequestsList?: Array<{ date: string; uid: string }>;
}

/** Test de connexion (réglages) : jeton valide, IFU et NIM reconnus. */
export async function checkConnection(params: { mode: MecefMode; token: string }): Promise<MecefStatus> {
  return dgi<MecefStatus>({ baseUrl: MECEF_URLS[params.mode], token: params.token }, "GET", "/invoice");
}

// ── Construction de la facture ───────────────
interface SecurityElements {
  dateTime?: string;
  qrCode?: string;
  codeMECeFDGI?: string;
  counters?: string;
  nim?: string;
}

async function buildRequest(saleId: string, kind: "FV" | "FA", ifu: string, defaultGroup: string, reference?: string) {
  const sale = await prisma.sale.findUniqueOrThrow({
    where: { id: saleId },
    include: {
      lines: { include: { product: { select: { name: true, internalCode: true, mecefTaxGroup: true } } } },
      payments: true,
      customer: { select: { name: true, phone: true, taxId: true, address: true } },
      cashier: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  const unitIds = sale.lines.map((l) => l.unitId).filter((u): u is string => !!u);
  const units = new Map((await prisma.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, symbol: true } })).map((u) => [u.id, u.symbol]));

  const items = sale.lines.map((l) => {
    const qty = Number(l.quantity);
    const net = Number(l.unitPrice) - Number(l.discount);
    // La DGI attend un prix unitaire entier (F CFA) : si une remise donne des
    // centimes, la ligne part en « 1 × montant de la ligne »
    const whole = Number.isInteger(net) && Math.abs(net * qty - Number(l.lineTotal)) < 0.5;
    const sym = l.unitId ? units.get(l.unitId) : undefined;
    const name = `${l.product.name}${sym && /[½¼]/.test(sym) ? ` (${sym})` : ""}`.slice(0, 120);
    return {
      ...(l.product.internalCode ? { code: l.product.internalCode } : {}),
      name: whole ? name : `${name} × ${qty.toLocaleString("fr-FR")}`,
      price: whole ? net : Math.round(Number(l.lineTotal)),
      quantity: whole ? qty : 1,
      taxGroup: l.product.mecefTaxGroup ?? defaultGroup,
    };
  });

  const payment = sale.payments
    .filter((p) => Number(p.amount) > 0)
    .map((p) => ({ name: PAYMENT_NAMES[p.method] ?? "AUTRE", amount: Math.round(Number(p.amount)) }));

  const clientName = sale.customer?.name ?? sale.customerName ?? undefined;
  const client =
    clientName || sale.customer?.taxId
      ? {
          ...(sale.customer?.taxId ? { ifu: sale.customer.taxId.trim() } : {}),
          ...(clientName ? { name: clientName } : {}),
          ...(sale.customer?.phone ? { contact: sale.customer.phone } : {}),
          ...(sale.customer?.address ? { address: sale.customer.address } : {}),
        }
      : undefined;

  return {
    sale,
    body: {
      ifu,
      type: kind,
      items,
      ...(client ? { client } : {}),
      operator: { id: sale.cashier.id.slice(-10), name: `${sale.cashier.firstName} ${sale.cashier.lastName}`.trim() },
      ...(payment.length ? { payment } : {}),
      ...(reference ? { reference } : {}),
    },
  };
}

/** Annule chez la DGI les demandes restées en attente depuis plus de 2 minutes (aucune n'a été confirmée). */
async function cancelStalePending(conn: Conn) {
  const status = await dgi<MecefStatus>(conn, "GET", "/invoice");
  const ours = new Set(
    (await prisma.mecefInvoice.findMany({ where: { status: { not: "DONE" }, lockedAt: { gte: new Date(Date.now() - 120_000) } }, select: { uid: true } }))
      .map((r) => r.uid)
      .filter(Boolean)
  );
  for (const p of status.pendingRequestsList ?? []) {
    if (ours.has(p.uid)) continue; // envoi en cours en ce moment même
    await dgi(conn, "PUT", `/invoice/${encodeURIComponent(p.uid)}/cancel`).catch(() => undefined);
    await prisma.mecefInvoice.updateMany({ where: { uid: p.uid, status: { not: "DONE" } }, data: { uid: null } });
  }
}

// ── Émission (idempotente, un seul envoi à la fois) ──
export interface MecefResult {
  status: "DONE" | "PENDING" | "ERROR" | "OFF";
  codeMecef?: string | null;
  qrCode?: string | null;
  counters?: string | null;
  nim?: string | null;
  dgiDateTime?: string | null;
  error?: string | null;
}

const view = (r: { status: string; codeMecef: string | null; qrCode: string | null; counters: string | null; nim: string | null; dgiDateTime: string | null; lastError: string | null }): MecefResult => ({
  status: r.status as MecefResult["status"],
  codeMecef: r.codeMecef,
  qrCode: r.qrCode,
  counters: r.counters,
  nim: r.nim,
  dgiDateTime: r.dgiDateTime,
  error: r.lastError,
});

async function emit(params: { companyId: string; saleId: string; kind: "FV" | "FA"; cancellationId?: string; force?: boolean }): Promise<MecefResult> {
  const conn = await connection(params.companyId);
  if (!conn) return { status: "OFF" };

  let reference: string | undefined;
  if (params.kind === "FA") {
    const original = await prisma.mecefInvoice.findUnique({ where: { saleId_kind: { saleId: params.saleId, kind: "FV" } } });
    // Facture d'origine jamais normalisée : rien à annuler auprès de la DGI
    if (original?.status !== "DONE" || !original.codeMecef) return { status: "OFF" };
    reference = original.codeMecef.replace(/-/g, "");
  }

  const row = await prisma.mecefInvoice.upsert({
    where: { saleId_kind: { saleId: params.saleId, kind: params.kind } },
    create: { companyId: params.companyId, saleId: params.saleId, kind: params.kind, cancellationId: params.cancellationId, mode: conn.mode },
    update: {},
  });
  if (row.status === "DONE") return view(row);
  if (row.status === "ERROR" && !params.force) return view(row);

  // Verrou : un seul envoi de cette facture à la fois (deux onglets, relance…)
  const lock = await prisma.mecefInvoice.updateMany({
    where: { id: row.id, status: { not: "DONE" }, OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - LOCK_MS) } }] },
    data: { lockedAt: new Date(), attempts: { increment: 1 } },
  });
  if (lock.count === 0) return view(row);

  try {
    let uid = row.uid;
    let totals: unknown = row.totals;
    let sec: SecurityElements | null = null;

    // Demande déjà créée chez la DGI mais pas confirmée (coupure) : on la confirme
    if (uid) {
      try {
        sec = await dgi<SecurityElements>(conn, "PUT", `/invoice/${encodeURIComponent(uid)}/confirm`);
      } catch (e) {
        if (!(e instanceof MecefError) || !e.rejected) throw e;
        uid = null; // expirée côté DGI : on recrée la facture
      }
    }
    if (!sec) {
      const { body } = await buildRequest(params.saleId, params.kind, conn.ifu, conn.taxGroup, reference);
      let created: { uid?: string; total?: number };
      try {
        created = await dgi<{ uid?: string; total?: number }>(conn, "POST", "/invoice", body);
      } catch (e) {
        if (!(e instanceof MecefError) || e.code !== "1") throw e;
        // Trop de factures en attente (créées puis jamais confirmées après une coupure) :
        // on annule les plus anciennes chez la DGI puis on renvoie une fois
        await cancelStalePending(conn);
        created = await dgi<{ uid?: string; total?: number }>(conn, "POST", "/invoice", body);
      }
      if (!created.uid) throw new MecefError("La DGI n'a pas renvoyé d'identifiant de facture");
      uid = created.uid;
      totals = created;
      await prisma.mecefInvoice.update({ where: { id: row.id }, data: { uid, totals: created as object } });
      sec = await dgi<SecurityElements>(conn, "PUT", `/invoice/${encodeURIComponent(uid)}/confirm`);
    }
    if (!sec.codeMECeFDGI) throw new MecefError("La DGI n'a pas renvoyé de code MECeF");

    const done = await prisma.mecefInvoice.update({
      where: { id: row.id },
      data: {
        status: "DONE",
        lockedAt: null,
        lastError: null,
        uid,
        totals: (totals ?? undefined) as object | undefined,
        codeMecef: sec.codeMECeFDGI,
        qrCode: sec.qrCode ?? null,
        counters: sec.counters ?? null,
        nim: sec.nim ?? null,
        dgiDateTime: sec.dateTime ?? null,
      },
    });
    return view(done);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    const rejected = e instanceof MecefError && e.rejected;
    const failed = await prisma.mecefInvoice.update({
      where: { id: row.id },
      data: { status: rejected ? "ERROR" : "PENDING", lockedAt: null, lastError: message.slice(0, 500) },
    });
    if (!(e instanceof MecefError)) console.error("[mecef]", e);
    return view(failed);
  }
}

/** Facture normalisée d'une vente. Sans réglage e-MECeF : { status: "OFF" }. */
export async function emitSale(companyId: string, saleId: string, force = false): Promise<MecefResult> {
  const res = await emit({ companyId, saleId, kind: "FV", force });
  // Vente annulée pendant que sa facture attendait la DGI : l'avoir suit aussitôt
  if (res.status === "DONE") {
    const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { status: true } });
    if (sale?.status === "CANCELLED") await emit({ companyId, saleId, kind: "FA" });
  }
  return res;
}

/** Avoir (FA) à l'annulation d'une vente déjà normalisée. */
export function emitCreditNote(companyId: string, saleId: string, cancellationId?: string, force = false): Promise<MecefResult> {
  return emit({ companyId, saleId, kind: "FA", cancellationId, force });
}

/** Relance des factures restées en attente (coupure internet, DGI indisponible). */
export async function retryPending(companyId: string, limit = 5): Promise<number> {
  if (!(await mecefActive(companyId))) return 0;
  const rows = await prisma.mecefInvoice.findMany({
    where: { companyId, status: "PENDING", attempts: { lt: MAX_AUTO_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { saleId: true, kind: true, cancellationId: true },
  });
  let done = 0;
  for (const r of rows) {
    const res = await emit({ companyId, saleId: r.saleId, kind: r.kind as "FV" | "FA", cancellationId: r.cancellationId ?? undefined });
    if (res.status === "DONE") done++;
    else if (res.status === "PENDING") break; // DGI toujours injoignable : inutile d'insister
  }
  return done;
}

/** Données e-MECeF d'une vente pour la facture imprimée. */
export async function saleMecef(saleId: string) {
  const rows = await prisma.mecefInvoice.findMany({ where: { saleId } });
  const fv = rows.find((r) => r.kind === "FV");
  const fa = rows.find((r) => r.kind === "FA");
  return {
    invoice: fv ? { ...view(fv), mode: fv.mode } : null,
    creditNote: fa ? { ...view(fa), mode: fa.mode } : null,
  };
}

// ── Travail en arrière-plan (après la réponse) ──
const pending = new Set<Promise<unknown>>();

/** Après la réponse : normalise une vente (ex. vente arrivée d'une caisse hors connexion) et relance les factures en attente. */
export function scheduleMecef(companyId: string, saleId?: string): void {
  const job = async () => {
    try {
      if (!(await mecefActive(companyId))) return;
      if (saleId) await emitSale(companyId, saleId);
      await retryPending(companyId);
    } catch (e) {
      console.error("[mecef]", e);
    }
  };
  try {
    after(job);
  } catch {
    const p = job().finally(() => pending.delete(p));
    pending.add(p);
  }
}

/** Tests : attend la fin des envois lancés hors requête. */
export async function waitForMecef(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

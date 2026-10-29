import { prisma } from "@/lib/prisma";
import { AuditEventType, Prisma } from "@prisma/client";
import crypto from "crypto";

// ─────────────────────────────────────────────
// Journal d'audit chaîné (cahier des charges §17)
// ─────────────────────────────────────────────
// Chaque entrée contient le hash de l'entrée précédente de la même entreprise.
// Toute modification ou suppression d'une ligne casse la chaîne et est
// détectée par verifyAuditChain().
//
// Règles :
// - Les écritures d'une même entreprise sont sérialisées par un verrou
//   consultatif PostgreSQL (pg_advisory_xact_lock) → pas de « fourche » de chaîne
//   quand deux opérations arrivent en même temps.
// - L'horodatage serveur est strictement croissant par entreprise, et c'est
//   EXACTEMENT la même valeur qui est hashée et enregistrée.
// - Passer `tx` pour écrire dans la transaction de l'opération métier :
//   si le journal échoue, l'opération est annulée (traçabilité garantie).

type Tx = Prisma.TransactionClient;

export interface AuditLogParams {
  eventType: AuditEventType;
  companyId?: string | null;
  centerId?: string | null;
  userId?: string | null;
  referenceType?: string;
  referenceId?: string;
  result?: "SUCCESS" | "FAILED" | "DENIED";
  reason?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  sessionId?: string;
  deviceTimestamp?: Date;
}

const GENESIS = "GENESIS";

/**
 * Sérialisation canonique : clés triées récursivement.
 * Indispensable car PostgreSQL (jsonb) réordonne les clés des objets :
 * sans tri, le hash recalculé à la vérification ne correspondrait jamais.
 */
export function canonicalJson(value: unknown): string {
  // Normalise d'abord (Decimal → string, Date → ISO, undefined supprimé)
  const normalized = value === undefined ? null : JSON.parse(JSON.stringify(value));
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sort((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sort(normalized));
}

interface HashableFields {
  eventType: string;
  companyId: string | null;
  centerId: string | null;
  userId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  result: string | null;
  reason: string | null;
  oldValues: unknown;
  newValues: unknown;
  serverTimestamp: Date;
}

export function computeAuditHash(fields: HashableFields, previousHash: string): string {
  const content = canonicalJson({
    v: 2,
    eventType: fields.eventType,
    companyId: fields.companyId,
    centerId: fields.centerId,
    userId: fields.userId,
    referenceType: fields.referenceType,
    referenceId: fields.referenceId,
    result: fields.result,
    reason: fields.reason,
    oldValues: fields.oldValues ?? null,
    newValues: fields.newValues ?? null,
    serverTimestamp: fields.serverTimestamp.toISOString(),
    previousHash,
  });
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function appendInTx(tx: Tx, params: AuditLogParams): Promise<void> {
  const companyId = params.companyId ?? null;

  // Sérialise les écritures de la chaîne de cette entreprise
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"audit:" + (companyId ?? "platform")}))`;

  const lastLog = await tx.auditLog.findFirst({
    where: { companyId },
    orderBy: [{ serverTimestamp: "desc" }, { id: "desc" }],
    select: { hash: true, serverTimestamp: true },
  });

  const previousHash = lastLog?.hash ?? GENESIS;

  // Horodatage strictement croissant (protège l'ordre de la chaîne)
  let serverTimestamp = new Date();
  if (lastLog && serverTimestamp <= lastLog.serverTimestamp) {
    serverTimestamp = new Date(lastLog.serverTimestamp.getTime() + 1);
  }

  const fields: HashableFields = {
    eventType: params.eventType,
    companyId,
    centerId: params.centerId ?? null,
    userId: params.userId ?? null,
    referenceType: params.referenceType ?? null,
    referenceId: params.referenceId ?? null,
    result: params.result ?? null,
    reason: params.reason ?? null,
    oldValues: params.oldValues ?? null,
    newValues: params.newValues ?? null,
    serverTimestamp,
  };

  const hash = computeAuditHash(fields, previousHash);
  const toJson = (v?: Record<string, unknown>) =>
    v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

  await tx.auditLog.create({
    data: {
      eventType: params.eventType,
      companyId,
      centerId: params.centerId ?? null,
      userId: params.userId ?? null,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      result: params.result,
      reason: params.reason,
      oldValues: toJson(params.oldValues),
      newValues: toJson(params.newValues),
      metadata: toJson(params.metadata),
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      deviceId: params.deviceId,
      sessionId: params.sessionId,
      deviceTimestamp: params.deviceTimestamp,
      serverTimestamp,
      previousHash,
      hash,
    },
  });
}

/**
 * Enregistre un événement dans le journal d'audit.
 *
 * - Avec `tx` : écrit dans la transaction appelante. Une erreur fait échouer
 *   l'opération métier (aucune opération sensible sans trace).
 * - Sans `tx` : écrit dans sa propre transaction ; une erreur est journalisée
 *   en console mais ne bloque pas l'appelant (ex. tentative de connexion échouée).
 */
export async function writeAuditLog(params: AuditLogParams, tx?: Tx): Promise<void> {
  if (tx) {
    await appendInTx(tx, params);
    return;
  }
  try {
    await prisma.$transaction((t) => appendInTx(t, params));
  } catch (error) {
    console.error("[AUDIT] Échec enregistrement journal:", error);
  }
}

/**
 * Vérifie l'intégrité de la chaîne de hachage du journal d'audit
 * pour une entreprise donnée.
 */
export async function verifyAuditChain(companyId: string): Promise<{
  isValid: boolean;
  corruptedAt?: string;
  totalChecked: number;
}> {
  const logs = await prisma.auditLog.findMany({
    where: { companyId },
    orderBy: [{ serverTimestamp: "asc" }, { id: "asc" }],
    select: {
      id: true,
      eventType: true,
      companyId: true,
      centerId: true,
      userId: true,
      referenceType: true,
      referenceId: true,
      result: true,
      reason: true,
      oldValues: true,
      newValues: true,
      serverTimestamp: true,
      previousHash: true,
      hash: true,
    },
  });

  let previousHash = GENESIS;
  for (const log of logs) {
    if (log.previousHash !== previousHash) {
      return { isValid: false, corruptedAt: log.id, totalChecked: logs.length };
    }
    const expected = computeAuditHash(
      {
        eventType: log.eventType,
        companyId: log.companyId,
        centerId: log.centerId,
        userId: log.userId,
        referenceType: log.referenceType,
        referenceId: log.referenceId,
        result: log.result,
        reason: log.reason,
        oldValues: log.oldValues,
        newValues: log.newValues,
        serverTimestamp: log.serverTimestamp,
      },
      previousHash
    );
    if (expected !== log.hash) {
      return { isValid: false, corruptedAt: log.id, totalChecked: logs.length };
    }
    previousHash = log.hash;
  }

  return { isValid: true, totalChecked: logs.length };
}

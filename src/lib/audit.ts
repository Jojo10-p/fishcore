import { prisma } from "@/lib/prisma";
import { AuditEventType } from "@prisma/client";
import crypto from "crypto";

interface AuditLogParams {
  eventType: AuditEventType;
  companyId?: string;
  centerId?: string;
  userId?: string;
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

/**
 * Enregistre un événement dans le journal d'audit.
 * Calcule un hash chaîné pour détecter toute altération ultérieure.
 */
export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  try {
    // Récupérer le dernier log pour chaîner les hashs
    const lastLog = await prisma.auditLog.findFirst({
      where: { companyId: params.companyId },
      orderBy: { serverTimestamp: "desc" },
      select: { hash: true, id: true },
    });

    const previousHash = lastLog?.hash ?? "GENESIS";

    // Construire le contenu à hasher
    const hashContent = JSON.stringify({
      eventType: params.eventType,
      companyId: params.companyId,
      userId: params.userId,
      referenceId: params.referenceId,
      result: params.result,
      serverTimestamp: new Date().toISOString(),
      previousHash,
    });

    const hash = crypto
      .createHash("sha256")
      .update(hashContent)
      .digest("hex");

    await prisma.auditLog.create({
      data: {
        ...params,
        serverTimestamp: new Date(),
        previousHash,
        hash,
      },
    });
  } catch (error) {
    // Ne jamais laisser un échec de log bloquer une opération métier
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
    orderBy: { serverTimestamp: "asc" },
    select: {
      id: true,
      eventType: true,
      userId: true,
      referenceId: true,
      result: true,
      serverTimestamp: true,
      previousHash: true,
      hash: true,
    },
  });

  let previousHash = "GENESIS";
  for (const log of logs) {
    const hashContent = JSON.stringify({
      eventType: log.eventType,
      companyId,
      userId: log.userId,
      referenceId: log.referenceId,
      result: log.result,
      serverTimestamp: log.serverTimestamp.toISOString(),
      previousHash,
    });

    const expectedHash = crypto
      .createHash("sha256")
      .update(hashContent)
      .digest("hex");

    if (expectedHash !== log.hash) {
      return { isValid: false, corruptedAt: log.id, totalChecked: logs.length };
    }

    previousHash = log.hash ?? previousHash;
  }

  return { isValid: true, totalChecked: logs.length };
}

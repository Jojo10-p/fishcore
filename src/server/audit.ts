import "server-only";
import { db } from "@/lib/db";
import { requestMeta } from "./request";

export async function audit(params: { actorId?: string | null; action: string; entity: string; entityId?: string | null; metadata?: Record<string, unknown> }) {
  try {
    const meta = await requestMeta();
    await db.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        metadata: (params.metadata ?? undefined) as never,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  } catch (e) {
    console.error("[audit] échec d'écriture", e);
  }
}

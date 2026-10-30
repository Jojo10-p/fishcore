import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, hasCompanyWideAccess, type AuthUser } from "@/lib/auth";
import type { BatchSnapshot } from "@/lib/stock-ops";

/** Transfert de l'entreprise visible par l'utilisateur (centre d'origine OU de destination). */
export async function loadTransferFor(user: AuthUser, id: string, companyId: string) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id, companyId },
    include: {
      fromCenter: { select: { id: true, name: true, code: true, address: true, city: true, phone: true } },
      toCenter: { select: { id: true, name: true, code: true, address: true, city: true, phone: true } },
    },
  });
  if (!transfer) throw new ApiError(404, "Transfert introuvable");
  if (!hasCompanyWideAccess(user) && !user.centerIds.includes(transfer.fromCenterId) && !user.centerIds.includes(transfer.toCenterId)) {
    throw new ApiError(403, "Vous n'avez pas accès à ce transfert", "FORBIDDEN");
  }
  return transfer;
}

export function canActOnCenter(user: AuthUser, centerId: string): boolean {
  return hasCompanyWideAccess(user) || user.centerIds.includes(centerId);
}

export function batchesOf(json: Prisma.JsonValue | null): BatchSnapshot[] {
  return Array.isArray(json) ? (json as unknown as BatchSnapshot[]) : [];
}

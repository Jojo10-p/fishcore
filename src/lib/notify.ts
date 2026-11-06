import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPush } from "@/lib/push";

// ─────────────────────────────────────────────
// Cloche de la direction : ce que font la caisse et le magasin
// ─────────────────────────────────────────────
// Ajout de stock, nouveau prix, demande d'annulation, caisse fermée… :
// une ligne par destinataire (patron + gérants de la boutique), gardée pour
// toujours dans l'historique, et une notification sur leur téléphone.

export type NotifyType =
  | "STOCK_ADDED"
  | "PRICE_CHANGED"
  | "PRODUCT_CREATED"
  | "CANCEL_REQUESTED"
  | "CANCEL_DECIDED"
  | "CASH_CLOSED";

export interface NotifyInput {
  companyId: string;
  centerId?: string | null;
  /** Auteur de l'action : il ne se notifie pas lui-même. */
  actorId: string;
  type: NotifyType;
  title: string;
  message: string;
  /** Page à ouvrir au clic */
  link?: string;
  data?: Record<string, unknown>;
  /** Destinataires précis (sinon : patron + gérants de la boutique) */
  userIds?: string[];
}

/** Patron(s) de l'entreprise et gérants rattachés à la boutique, comptes actifs. */
export async function managerIds(companyId: string, centerId?: string | null): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      companyId,
      isActive: true,
      OR: [
        { role: "COMPANY_OWNER" },
        { role: "CENTER_MANAGER", ...(centerId ? { centers: { some: { centerId, isActive: true } } } : {}) },
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function deliver(n: NotifyInput): Promise<void> {
  const ids = (n.userIds ?? (await managerIds(n.companyId, n.centerId))).filter((id) => id !== n.actorId);
  if (!ids.length) return;
  await prisma.notification.createMany({
    data: ids.map((userId) => ({
      companyId: n.companyId,
      centerId: n.centerId ?? null,
      userId,
      type: n.type,
      title: n.title,
      message: n.message,
      data: { ...(n.data ?? {}), link: n.link ?? null, actorId: n.actorId } as Prisma.InputJsonValue,
    })),
  });
  const devices = await prisma.pushSubscription.findMany({
    where: { companyId: n.companyId, userId: { in: ids } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  await sendPush(devices, {
    title: n.title,
    body: n.message,
    tag: `${n.type}-${Date.now()}`,
    url: n.link ?? "/dashboard",
    requireAck: n.type === "CANCEL_REQUESTED",
  });
}

const pending = new Set<Promise<void>>();

/** Envoie après la réponse (l'action n'attend pas les notifications). */
export function notifyManagers(n: NotifyInput): void {
  const job = async () => {
    try {
      await deliver(n);
    } catch (e) {
      console.error("[notify]", e);
    }
  };
  try {
    after(job);
  } catch {
    const p = job().finally(() => pending.delete(p));
    pending.add(p);
  }
}

/** Tests : attend les envois lancés hors requête. */
export async function waitForNotifications(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

/** « Samson (Caissier) » */
export async function actorLabel(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, role: true } });
  if (!u) return "Quelqu'un";
  const roles: Record<string, string> = {
    COMPANY_OWNER: "Direction",
    CENTER_MANAGER: "Gérant",
    CASHIER: "Caissier",
    STOCK_MANAGER: "Magasinier",
    ACCOUNTANT: "Comptable",
    SALES_EMPLOYEE: "Vendeur",
  };
  return `${u.firstName} (${roles[u.role] ?? u.role})`;
}

import webpush from "web-push";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Notifications sur téléphone (Web Push : Android, ordinateur, iPhone avec l'app installée)
// ─────────────────────────────────────────────
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY : paire de clés (réglages Vercel, jamais dans le code)
//   VAPID_SUBJECT                       : contact de l'expéditeur (mailto:…)

/** Rôles qui reçoivent les alertes de stock : au-dessus de la caisse. */
export const PUSH_ROLES: UserRole[] = ["COMPANY_OWNER", "CENTER_MANAGER", "STOCK_MANAGER"];

export function pushConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Une notification du même tag remplace la précédente (et vibre à nouveau). */
  tag: string;
  url?: string;
  /** true : reste affichée avec le bouton « Bien reçu » ; false : simple information, disparaît seule. */
  requireAck: boolean;
}

interface Target {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Envoi réel (remplaçable dans les tests). */
export const pushTransport = {
  send: async (sub: Target, payload: string): Promise<void> => {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@gjh.bj", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
      TTL: 6 * 3600,
      urgency: "high",
      timeout: 10_000,
    });
  },
};

/** Envoie à une liste d'appareils ; un appareil désabonné (404/410) est retiré. Renvoie le nombre d'envois réussis. */
export async function sendPush(targets: Target[], payload: PushPayload): Promise<number> {
  if (!targets.length || !pushConfigured()) return 0;
  const data = JSON.stringify(payload);
  let ok = 0;
  await Promise.all(
    targets.map(async (t) => {
      try {
        await pushTransport.send(t, data);
        ok++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.deleteMany({ where: { id: t.id } });
        } else {
          console.error("[push]", status ?? "", (e as Error).message);
        }
      }
    })
  );
  return ok;
}

/** Appareils du patron (toutes les boutiques) et des gérants rattachés à cette boutique. */
export async function managerDevices(companyId: string, centerId: string): Promise<Target[]> {
  return prisma.pushSubscription.findMany({
    where: {
      companyId,
      user: {
        isActive: true,
        OR: [
          { role: "COMPANY_OWNER" },
          { role: { in: PUSH_ROLES.filter((r) => r !== "COMPANY_OWNER") }, centers: { some: { centerId, isActive: true } } },
        ],
      },
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
}

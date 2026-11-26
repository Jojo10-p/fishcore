"use client";

import Dexie from "dexie";
import { getOfflineDB, type TicketHeader } from "./db";
import { getDeviceId } from "./sales";
import { generateIdempotencyKey } from "@/lib/utils";

// ─────────────────────────────────────────────
// Ouvrir sa caisse sans Internet
// ─────────────────────────────────────────────
// Avec du réseau, l'appareil garde une « réserve » (voir /api/cash/standby) :
// des numéros de facture à son nom, les caisses du caissier et l'en-tête des
// tickets. Sans Internet, la caisse s'ouvre sur l'appareil avec cette réserve ;
// l'ouverture part dans la file d'envoi AVANT les ventes, et le serveur crée la
// session avec le même identifiant au retour du réseau.

export interface Standby {
  userId: string;
  deviceId: string;
  blocks: Array<{ prefix: string; first: number; last: number }>;
  registers: Array<{
    id: string;
    name: string;
    centerId: string;
    center: { id: string; name: string; address: string | null; city: string | null; phone: string | null };
    lastClosing: number;
  }>;
  company: TicketHeader["company"];
  cashier: { firstName: string; role: string };
  savedAt: string;
}

const key = (userId: string) => `gjh-standby:${userId}`;

export function getStandby(userId: string): Standby | null {
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? (JSON.parse(raw) as Standby) : null;
  } catch {
    return null;
  }
}

/** Avec du réseau : met à jour la réserve de l'appareil (sans effet hors ligne). */
export async function refreshStandby(userId: string): Promise<Standby | null> {
  try {
    const res = await fetch("/api/cash/standby", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: getDeviceId() }),
    });
    if (!res.ok) return getStandby(userId);
    const { data } = (await res.json()) as { data: Standby };
    if (data.userId !== userId) return getStandby(userId);
    localStorage.setItem(key(userId), JSON.stringify(data));
    return data;
  } catch {
    return getStandby(userId);
  }
}

/**
 * Ouvre la caisse sur l'appareil, sans Internet. Renvoie la session à utiliser
 * comme une session normale (ventes, tickets, numéros).
 */
export async function openSessionOffline(params: { userId: string; registerId: string; openingBalance: number }) {
  const standby = getStandby(params.userId);
  if (!standby) throw new Error("Cet appareil n'a pas encore de réserve pour travailler hors connexion. Ouvrez la caisse une fois avec Internet.");
  const register = standby.registers.find((r) => r.id === params.registerId);
  if (!register) throw new Error("Caisse inconnue sur cet appareil");
  const id = `off_${generateIdempotencyKey("s").replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 60);
  const openedAt = new Date().toISOString();
  const deviceId = getDeviceId();
  const header: TicketHeader = {
    company: standby.company,
    center: register.center,
    registerName: register.name,
    cashierFirstName: standby.cashier.firstName,
    cashierRole: standby.cashier.role,
  };
  const db = getOfflineDB();
  await Dexie.ignoreTransaction(() =>
    db.transaction("rw", db.numbering, db.syncQueue, async () => {
      await db.numbering.put({ sessionId: id, blocks: standby.blocks, used: [], header, updatedAt: openedAt });
      // L'ouverture passe dans la file AVANT toute vente de cette caisse
      await db.syncQueue.add({
        id: generateIdempotencyKey("op"),
        type: "cash_session",
        referenceId: id,
        payload: {
          action: "open",
          clientId: id,
          openedAt,
          cashRegisterId: register.id,
          openingBalance: params.openingBalance,
          deviceId,
          standbyDeviceId: standby.deviceId,
          isOnline: false,
        },
        status: "pending",
        createdAt: openedAt,
        attemptCount: 0,
      });
    })
  );
  // La réserve est utilisée : une nouvelle sera prise au retour du réseau
  try {
    localStorage.removeItem(key(params.userId));
  } catch {
    /* ignore */
  }
  return { id, cashRegisterId: register.id, registerName: register.name, centerId: register.centerId, openedAt };
}

/** L'ouverture de cette caisse attend-elle encore d'être envoyée au serveur ? */
export async function isOpeningPending(sessionId: string): Promise<boolean> {
  const db = getOfflineDB();
  const n = await Dexie.ignoreTransaction(() =>
    db.syncQueue
      .where("type")
      .equals("cash_session")
      .filter((op) => op.referenceId === sessionId && op.status !== "synced")
      .count()
  );
  return n > 0;
}

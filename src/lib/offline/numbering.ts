"use client";

import Dexie from "dexie";
import { getOfflineDB, type OfflineNumbering, type TicketHeader } from "./db";
import { generateSaleNumber } from "@/lib/utils";

// ─────────────────────────────────────────────
// Numéros de facture attribués par la caisse
// ─────────────────────────────────────────────
// La caisse garde d'avance des plages de numéros (voir src/lib/invoice-numbers.ts).
// À chaque vente : on lit le prochain numéro libre (peek), on le soumet au
// serveur ou à la file hors ligne, et on ne le marque utilisé (commit) que si
// la vente est enregistrée — une vente refusée ne consomme pas de numéro.

/** La caisse se réapprovisionne quand il reste moins de numéros que ceci. */
export const REFILL_BELOW = 100;

export interface NextNumber {
  seq: number;
  prefix: string;
  saleNumber: string;
}

function nextFree(row: OfflineNumbering | undefined): NextNumber | null {
  if (!row) return null;
  const used = new Set(row.used);
  for (const b of [...row.blocks].sort((x, y) => x.first - y.first)) {
    for (let n = b.first; n <= b.last; n++) {
      if (!used.has(n)) return { seq: n, prefix: b.prefix, saleNumber: generateSaleNumber(b.prefix, n) };
    }
  }
  return null;
}

export function remainingOf(row: OfflineNumbering | undefined): number {
  if (!row) return 0;
  const used = new Set(row.used);
  return row.blocks.reduce((s, b) => {
    let free = 0;
    for (let n = b.first; n <= b.last; n++) if (!used.has(n)) free++;
    return s + free;
  }, 0);
}

export async function peekNextNumber(sessionId: string): Promise<NextNumber | null> {
  return nextFree(await Dexie.ignoreTransaction(() => getOfflineDB().numbering.get(sessionId)));
}

/** Marque le numéro comme utilisé. À appeler dans la transaction qui enregistre la vente. */
export async function commitNumber(sessionId: string, seq: number) {
  const db = getOfflineDB();
  const row = await db.numbering.get(sessionId);
  if (!row) return;
  if (!row.used.includes(seq)) await db.numbering.update(sessionId, { used: [...row.used, seq], updatedAt: new Date().toISOString() });
}

export async function getNumbering(sessionId: string) {
  return Dexie.ignoreTransaction(() => getOfflineDB().numbering.get(sessionId));
}

export async function getTicketHeader(sessionId: string): Promise<TicketHeader | undefined> {
  return (await getNumbering(sessionId))?.header;
}

interface ServerNumbering {
  closed: boolean;
  blocks: Array<{ prefix: string; first: number; last: number }>;
  used: number[];
  header: TicketHeader;
}

/**
 * Avec connexion : met à jour plages, numéros utilisés et en-tête ; demande une
 * nouvelle plage si la réserve de numéros baisse. Sans connexion : ne fait rien.
 */
export async function refreshNumbering(sessionId: string): Promise<OfflineNumbering | undefined> {
  return Dexie.ignoreTransaction(() => doRefresh(sessionId));
}

async function doRefresh(sessionId: string): Promise<OfflineNumbering | undefined> {
  const db = getOfflineDB();
  const get = async () => {
    const res = await fetch(`/api/cash/sessions/${sessionId}/numbers`, { cache: "no-store" });
    if (!res.ok) throw new Error(`numérotation ${res.status}`);
    return ((await res.json()) as { data: ServerNumbering }).data;
  };
  try {
    let server = await get();
    if (server.closed) return db.numbering.get(sessionId);
    const merge = async (s: ServerNumbering) => {
      const local = await db.numbering.get(sessionId);
      // Numéros utilisés : ceux du serveur + ceux des ventes encore sur l'appareil
      const used = [...new Set([...(local?.used ?? []), ...s.used])];
      const row: OfflineNumbering = { sessionId, blocks: s.blocks, used, header: s.header, updatedAt: new Date().toISOString() };
      await db.numbering.put(row);
      return row;
    };
    let row = await merge(server);
    for (let i = 0; i < 3 && remainingOf(row) < REFILL_BELOW; i++) {
      const res = await fetch(`/api/cash/sessions/${sessionId}/numbers`, { method: "POST" });
      if (!res.ok || res.status === 200) break; // 200 : la caisse a déjà assez d'avance
      server = await get();
      row = await merge(server);
    }
    return row;
  } catch {
    return db.numbering.get(sessionId); // hors connexion : on garde ce qu'on a
  }
}

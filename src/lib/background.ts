import { after } from "next/server";

/**
 * Travail à faire après la réponse (reprise des factures en attente…). Ne fait
 * jamais échouer la requête : hors d'une requête Next.js (tests, scripts), il est
 * simplement ignoré.
 */
export function runAfter(task: () => Promise<unknown>): void {
  try {
    after(() => task().then(() => undefined).catch(() => undefined));
  } catch {
    /* hors requête : rien à planifier */
  }
}

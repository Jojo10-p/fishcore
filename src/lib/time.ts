// ─────────────────────────────────────────────
// Dates dans le fuseau horaire de l'entreprise
// ─────────────────────────────────────────────
// Une « journée » commence à minuit à Cotonou, pas à minuit UTC.

/** Décalage (ms) d'un fuseau horaire à un instant donné. */
export function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instant;
}

/** Début et fin d'une journée calendaire dans le fuseau de l'entreprise. */
export function dayBounds(dateStr: string, timeZone: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const startGuess = Date.UTC(y, m - 1, d);
  const start = startGuess - tzOffsetMs(startGuess, timeZone);
  const endGuess = Date.UTC(y, m - 1, d + 1);
  const end = endGuess - tzOffsetMs(endGuess, timeZone);
  return { start: new Date(start), end: new Date(end - 1) };
}

export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()); // AAAA-MM-JJ
}

/** Bornes d'une période [from, to] (dates AAAA-MM-JJ incluses) dans le fuseau donné. */
export function periodBounds(from: string, to: string, timeZone: string) {
  return { start: dayBounds(from, timeZone).start, end: dayBounds(to, timeZone).end };
}

/** Période précédente de même durée (pour la comparaison). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const t = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  const days = Math.round((t - f) / 86_400_000) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(f - days * 86_400_000), to: iso(f - 86_400_000) };
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

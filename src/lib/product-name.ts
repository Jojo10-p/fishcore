// ─────────────────────────────────────────────
// Nom d'un article = la marque / le produit + le format du bidon
// ─────────────────────────────────────────────
// « SHELL HELIX — 4 L » : la caisse et la page Stock regroupent les formats
// sous « SHELL HELIX » ; le ticket et la facture gardent le nom complet.

export const FORMAT_SEP = " — ";

/** « SHELL HELIX — 4 L » → « SHELL HELIX » */
export function familyOf(name: string): string {
  const i = name.indexOf(FORMAT_SEP);
  return (i >= 0 ? name.slice(0, i) : name).trim();
}

/** « SHELL HELIX — 4 L » → « 4 L » (vide sans format) */
export function formatOf(name: string): string {
  const i = name.indexOf(FORMAT_SEP);
  return i >= 0 ? name.slice(i + FORMAT_SEP.length).trim() : "";
}

/** 4 → « 4 L », 0.25 → « 0,25 L » */
export function litersLabel(l: number): string {
  return `${l.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} L`;
}

/** « SHELL HELIX » + 4 → « SHELL HELIX — 4 L » ; sans contenance : le nom seul */
export function composeName(family: string, liters?: number | null): string {
  const f = family.trim().replace(/\s+/g, " ");
  return liters && liters > 0 ? `${f}${FORMAT_SEP}${litersLabel(liters)}` : f;
}

/** Litres lus dans le format (« 4 L » → 4, « 0,25 L » → 0,25) */
export function formatLiters(name: string): number | null {
  const f = formatOf(name);
  const ml = f.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (ml) return Number(ml[1].replace(",", ".")) / 1000;
  const m = f.match(/(\d+(?:[.,]\d+)?)\s*L\b/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** Regroupe les articles par marque/produit, formats du plus petit au plus grand. */
export function groupByFamily<T extends { name: string }>(items: T[]): Array<{ family: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = familyOf(it.name);
    map.set(k, [...(map.get(k) ?? []), it]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "fr"))
    .map(([family, list]) => ({ family, items: list.sort((a, b) => (formatLiters(a.name) ?? 0) - (formatLiters(b.name) ?? 0)) }));
}

/** Formats de bidon proposés à l'ajout de stock */
export const COMMON_FORMATS = [0.25, 0.5, 1, 4, 5, 20, 25, 30, 208];

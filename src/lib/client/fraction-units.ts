import { apiGet, apiSend } from "@/lib/client/api";

// Vente au détail : ½ litre et ¼ litre peuvent avoir leur propre prix.
// Ce sont des conditionnements de 0,5 L et 0,25 L de l'article (stock compté en litres).

export const HALF = { name: "½ litre", symbol: "½ L", factor: 0.5 } as const;
export const QUARTER = { name: "¼ litre", symbol: "¼ L", factor: 0.25 } as const;

interface Unit {
  id: string;
  symbol: string;
}

/** Unités « ½ L » et « ¼ L » de l'entreprise (créées au besoin). */
export async function fractionUnits(known?: Unit[]): Promise<{ half: string; quarter: string }> {
  const units = known ?? (await apiGet<{ data: Unit[] }>("/api/units")).data;
  const get = async (u: typeof HALF | typeof QUARTER) =>
    units.find((x) => x.symbol === u.symbol)?.id ??
    (await apiSend<{ data: Unit }>("/api/units", { name: u.name, symbol: u.symbol, kind: "PACKAGING" })).data.id;
  return { half: await get(HALF), quarter: await get(QUARTER) };
}

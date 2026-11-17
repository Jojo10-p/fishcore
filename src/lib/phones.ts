/** Tous les numéros d'un fournisseur, le principal d'abord : « 97 00 00 00 / 61 11 11 11 ». */
export function phonesOf(s: { phone?: string | null; otherPhones?: string[] | null } | null | undefined): string[] {
  if (!s) return [];
  return [s.phone, ...(s.otherPhones ?? [])].map((p) => p?.trim()).filter((p): p is string => !!p);
}

export const phonesText = (s: Parameters<typeof phonesOf>[0]) => phonesOf(s).join(" / ");

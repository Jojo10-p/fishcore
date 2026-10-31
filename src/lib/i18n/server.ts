import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { LOCALES, STATIC_DICTIONARIES, type Dictionary, type DictKey, type Locale } from "./dictionaries";

export const LOCALE_COOKIE = "aur_locale";

export const getLocale = cache(async (): Promise<Locale> => {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return (LOCALES as readonly string[]).includes(c ?? "") ? (c as Locale) : "fr";
});

export const getDictionary = cache(async (locale?: Locale): Promise<Dictionary> => {
  const l = locale ?? (await getLocale());
  const base = STATIC_DICTIONARIES[l];
  try {
    const overrides = await db.translation.findMany({ where: { locale: l } });
    const dict = { ...base };
    for (const o of overrides) if (o.key in dict && o.value.trim()) dict[o.key as DictKey] = o.value;
    return dict;
  } catch {
    return base;
  }
});

export async function getI18n() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const t = (k: DictKey) => dict[k] ?? k;
  return { locale, dict, t };
}

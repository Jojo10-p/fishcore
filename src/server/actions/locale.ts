"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALES } from "@/lib/i18n/dictionaries";
import { LOCALE_COOKIE } from "@/lib/i18n/server";

export async function setLocaleAction(locale: string) {
  if (!(LOCALES as readonly string[]).includes(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

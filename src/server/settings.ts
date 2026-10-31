import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

export const DEFAULT_SETTINGS = {
  org: {
    name: "Aurane Finance",
    legalName: "",
    tagline: "Financement de projets",
    email: "contact@example.com",
    phone: "",
    address: "",
    hours: "Du lundi au vendredi, 9h – 18h",
    logoUrl: "",
    social: { linkedin: "", facebook: "", instagram: "", x: "" },
  },
  locale: { default: "fr", enabled: ["fr", "en"], currency: "EUR", numberLocale: "fr-FR" },
  compliance: {
    /** Tant que false : bandeau public + décisions désactivées dans le back-office. */
    licensed: false,
    regulator: "",
    licenseNumber: "",
    registrationNumber: "",
    legalNotice: "",
    privacyPolicy: "",
    terms: "",
  },
  about: { team: [] as { name: string; role: string }[] },
  simulator: { defaultAmount: 10000, defaultDuration: 36 },
  publicStats: { enabled: false, minApplications: 50 },
  security: { maxLoginAttempts: 5, lockMinutes: 15, sessionDays: 7 },
  seo: { title: "Aurane Finance — Financement de projets en ligne", description: "Simulez et demandez un financement en ligne. Conditions publiées, suivi de dossier en temps réel.", ogImage: "" },
};

export type Settings = typeof DEFAULT_SETTINGS;
export type SettingKey = keyof Settings;

function merge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== "object" || Array.isArray(override)) return (override as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

export const getSettings = cache(async (): Promise<Settings> => {
  try {
    const rows = await db.siteSetting.findMany();
    const result = { ...DEFAULT_SETTINGS } as Settings;
    for (const row of rows) {
      if (row.key in result) {
        (result as Record<string, unknown>)[row.key] = merge((DEFAULT_SETTINGS as Record<string, unknown>)[row.key], row.value);
      }
    }
    return result;
  } catch {
    return DEFAULT_SETTINGS;
  }
});

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (typeof v === "object" && v && "toNumber" in v) return (v as { toNumber(): number }).toNumber();
  return Number(v);
}

export function formatMoney(value: unknown, currency = "EUR", locale = "fr-FR", digits = 0) {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(toNumber(value));
}

export function formatNumber(value: unknown, locale = "fr-FR", digits = 0) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(toNumber(value));
}

export function formatDate(d: Date | string | null | undefined, locale = "fr-FR", withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

export function initials(first?: string | null, last?: string | null) {
  return `${(first ?? "").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase() || "?";
}

export function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

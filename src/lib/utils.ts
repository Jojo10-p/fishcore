import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formate un montant en devise locale (XOF par défaut) */
export function formatCurrency(
  amount: number | string,
  currency: string = "XOF",
  locale: string = "fr-BJ"
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

/** Formate une date en français */
export function formatDate(date: Date | string, withTime = false): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("fr-BJ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime && { hour: "2-digit", minute: "2-digit" }),
  }).format(d);
}

/** Génère un identifiant d'idempotence unique */
export function generateIdempotencyKey(prefix: string = "op"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Génère un numéro de vente formaté */
export function generateSaleNumber(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(6, "0")}`;
}

/** Tronque un texte */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

/** Délai asynchrone */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Libellé court d'une devise pour les champs de saisie : XOF → « F CFA ». */
export function currencyLabel(currency: string = "XOF"): string {
  if (currency === "XOF" || currency === "XAF") return "F CFA";
  return currency;
}

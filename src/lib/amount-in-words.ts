// ─────────────────────────────────────────────
// Montant en toutes lettres (factures, devis)
// « Arrêtée la présente facture à la somme de … francs CFA »
// Règles du français (orthographe traditionnelle) :
//  - vingt et un, trente et un… soixante et onze ; quatre-vingt-un (sans « et ») ;
//  - quatre-vingts et deux cents prennent un « s » seulement en fin de nombre ;
//  - mille est invariable et ne prend jamais « un » devant ;
//  - million et milliard sont des noms : « deux millions ».
// ─────────────────────────────────────────────

const UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

/** 0 à 99. `final` : le nombre termine l'expression (accord de « quatre-vingts »). */
function below100(n: number, final: boolean): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t];
    if (u === 1) return `${TENS[t]} et un`;
    return `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) {
    // 70–79 : soixante-dix, soixante et onze, soixante-douze…
    const r = n - 60;
    return r === 11 ? "soixante et onze" : `soixante-${below100(r, final)}`;
  }
  // 80–99 : quatre-vingts, quatre-vingt-un, quatre-vingt-dix…
  const r = n - 80;
  if (r === 0) return final ? "quatre-vingts" : "quatre-vingt";
  return `quatre-vingt-${below100(r, final)}`;
}

/** 0 à 999. */
function below1000(n: number, final: boolean): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h === 0) return below100(rest, final);
  const hundreds = h === 1 ? "cent" : `${UNITS[h]} cent${rest === 0 && final ? "s" : ""}`;
  return rest === 0 ? hundreds : `${hundreds} ${below100(rest, final)}`;
}

/** Entier positif en toutes lettres (jusqu'à 999 999 999 999). */
export function integerToFrenchWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "zéro";
  if (n > 999_999_999_999) throw new Error("Montant trop grand");

  const billions = Math.floor(n / 1_000_000_000);
  n %= 1_000_000_000;
  const millions = Math.floor(n / 1_000_000);
  n %= 1_000_000;
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (billions) parts.push(`${below1000(billions, true)} milliard${billions > 1 ? "s" : ""}`);
  if (millions) parts.push(`${below1000(millions, true)} million${millions > 1 ? "s" : ""}`);
  // « mille » invariable ; « quatre-vingt mille », « deux cent mille » (pas de s devant mille)
  if (thousands) parts.push(thousands === 1 ? "mille" : `${below1000(thousands, false)} mille`);
  if (rest) parts.push(below1000(rest, true));
  return parts.join(" ");
}

const CURRENCY_WORDS: Record<string, { one: string; many: string; cents?: string }> = {
  XOF: { one: "franc CFA", many: "francs CFA" },
  XAF: { one: "franc CFA", many: "francs CFA" },
  EUR: { one: "euro", many: "euros", cents: "centimes" },
  USD: { one: "dollar", many: "dollars", cents: "cents" },
  GHS: { one: "cedi", many: "cedis", cents: "pesewas" },
  NGN: { one: "naira", many: "nairas", cents: "kobos" },
};

/** « Cinq cent mille francs CFA » — majuscule initiale, centimes si la devise en a. */
export function amountInWords(amount: number, currency = "XOF"): string {
  const words = CURRENCY_WORDS[currency] ?? { one: currency, many: currency };
  const cents = words.cents ? Math.round((Math.abs(amount) * 100) % 100) : 0;
  const whole = words.cents ? Math.floor(Math.abs(amount)) : Math.round(Math.abs(amount));
  // « un million de francs », « deux millions d'euros »
  const base = integerToFrenchWords(whole);
  const needsDe = whole > 0 && whole % 1_000_000 === 0;
  const unit = whole > 1 ? words.many : words.one;
  const elided = /^[aeiouéh]/i.test(unit) ? `d'${unit}` : `de ${unit}`;
  let text = `${base} ${needsDe ? elided : unit}`;
  if (cents > 0) text += ` et ${integerToFrenchWords(cents)} ${words.cents}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

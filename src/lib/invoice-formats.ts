// ─────────────────────────────────────────────
// Formats de facture imprimée à la caisse
// ─────────────────────────────────────────────
// Les longueurs 210 / 297 / 3276 mm sont celles que propose le pilote des
// imprimantes thermiques XP-80C (« 80(72.1) x 210 mm », etc.) : 72,1 mm de
// largeur imprimable sur un rouleau de 80 mm.

export const INVOICE_FORMATS = [
  {
    value: "TICKET_80",
    label: "Ticket 80 mm détaillé",
    hint: "Rouleau continu (papier « 80(72.1) x 3276 mm ») : logo, en-tête complet, paiement, monnaie rendue, code-barres.",
  },
  {
    value: "TICKET_80_COMPACT",
    label: "Ticket 80 mm compact",
    hint: "Court, comme les anciens logiciels de caisse : n°, date, heure, IFU, articles, total à payer. Économise le papier.",
  },
  {
    value: "TICKET_80_210",
    label: "Ticket 80 × 210 mm",
    hint: "Imprimante réglée sur « 80(72.1) x 210 mm » : page fixe de 21 cm.",
  },
  {
    value: "TICKET_80_297",
    label: "Ticket 80 × 297 mm",
    hint: "Imprimante réglée sur « 80(72.1) x 297 mm » : page fixe de 29,7 cm (longueur d'une feuille A4).",
  },
  {
    value: "TICKET_58",
    label: "Ticket 58 mm",
    hint: "Petites imprimantes thermiques 58 mm (souvent Bluetooth, portables).",
  },
  { value: "A5", label: "Page A5 (demi-feuille)", hint: "Facture complète en plus petit : moitié d'une feuille A4, imprimante de bureau." },
  { value: "A4", label: "Page A4", hint: "Imprimante de bureau : facture complète avec en-tête, montant en lettres et cachet." },
] as const;

export type InvoiceFormat = (typeof INVOICE_FORMATS)[number]["value"];
export type TicketFormat = Extract<InvoiceFormat, `TICKET_${string}`>;
export const INVOICE_FORMAT_VALUES = INVOICE_FORMATS.map((f) => f.value) as [InvoiceFormat, ...InvoiceFormat[]];
export const TICKET_FORMATS = INVOICE_FORMATS.filter((f) => f.value.startsWith("TICKET")) as unknown as ReadonlyArray<{
  value: TicketFormat;
  label: string;
  hint: string;
}>;

export const isTicketFormat = (f: string | null | undefined): f is TicketFormat => !!f && f.startsWith("TICKET");
export const asTicketFormat = (f: string | null | undefined): TicketFormat => (isTicketFormat(f) && TICKET_FORMATS.some((x) => x.value === f) ? f : "TICKET_80");

/** Règles d'impression du ticket : sans marge ; longueur de page fixe pour 80 × 210 et 80 × 297. */
export function ticketPrintCss(format: TicketFormat): string {
  const size = format === "TICKET_80_210" ? "size: 80mm 210mm; " : format === "TICKET_80_297" ? "size: 80mm 297mm; " : "";
  return `@page { ${size}margin: 0; } @media print { html, body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;
}

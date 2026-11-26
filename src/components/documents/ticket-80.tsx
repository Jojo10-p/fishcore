"use client";

import { Barcode } from "@/components/documents/a4-document";
import type { TicketFormat } from "@/lib/invoice-formats";

// ─────────────────────────────────────────────
// Facture au format ticket 80 mm (XP-80C et équivalentes)
// ─────────────────────────────────────────────
// Un seul rendu pour toutes les impressions : à la caisse (en ligne ou non,
// à partir des données de l'appareil) et en réimpression (données du serveur).
// Le ticket d'une vente faite sans connexion est identique : même numéro
// définitif, même en-tête, mêmes mentions.

export interface TicketData {
  saleNumber: string;
  date: string; // ISO
  company: {
    tradeName: string;
    legalName: string | null;
    phone: string;
    address: string | null;
    city: string | null;
    taxId: string | null;
    tradeRegNumber: string | null;
    currency: string;
    invoiceNotes: string | null;
  };
  center: { name: string; address: string | null; city: string | null; phone: string | null };
  customer: { name: string; phone?: string | null; taxId?: string | null } | null;
  cashierFirstName: string;
  /** Rôle de la personne qui a encaissé (« Caissier : Samson »). */
  cashierRole?: string | null;
  /** Espèces : montant remis par le client et monnaie rendue. */
  tendered?: number | null;
  change?: number | null;
  lines: Array<{
    key: string;
    name: string;
    ref?: string | null;
    quantity: number;
    unitSymbol: string;
    unitPrice: number;
    discount: number; // par unité
    lineTotal: number;
    lots?: Array<{ lotNumber: string | null; expiresAt: string | null }>;
  }>;
  discountAmount: number;
  total: number;
  tax: number;
  payments: Array<{ method: string; amount: number; reference?: string | null; notes?: string | null }>;
  refunded?: number;
  cancelled?: boolean;
  /** Mention « à présenter au magasin » (retrait sur présentation de la facture). */
  pickupPending?: boolean;
}

export const ROLE_LABELS: Record<string, string> = {
  CASHIER: "Caissier",
  CENTER_MANAGER: "Gérant",
  COMPANY_OWNER: "Direction",
  STOCK_MANAGER: "Magasinier",
  ACCOUNTANT: "Comptable",
  SALES_EMPLOYEE: "Vendeur",
};
/**
 * Qui a encaissé, tel qu'imprimé sur la facture : « Direction » pour le super
 * administrateur, « Gérant » pour le gérant (sans leur nom), « Caissier : Samson »
 * pour les autres.
 */
export function sellerLabel(role: string | null | undefined, firstName: string): string {
  if (role === "COMPANY_OWNER") return "Direction";
  if (role === "CENTER_MANAGER") return "Gérant";
  return `${ROLE_LABELS[role ?? ""] ?? "Caissier"} : ${firstName}`;
}
/** Même chose en deux parties pour l'en-tête A4/A5 : [« Caissier », « Samson »] ou [« Vendu par », « Direction »]. */
export function sellerMeta(role: string | null | undefined, firstName: string): [string, string] {
  if (role === "COMPANY_OWNER") return ["Vendu par", "Direction"];
  if (role === "CENTER_MANAGER") return ["Vendu par", "Gérant"];
  return [ROLE_LABELS[role ?? ""] ?? "Caissier", firstName];
}

/** « 06/11/2026 à 13h51 » */
export const stamp = (d: Date) =>
  `${d.toLocaleDateString("fr-FR")} à ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;

const NAVY = "#0b1f4b";
const GOLD = "#c58b1c";

const METHODS: Record<string, string> = { CASH: "Espèces", MOBILE_MONEY: "Mobile money", CARD: "Carte", TRANSFER: "Virement", MIXED: "Mixte" };
// Montants sans symbole (colonnes étroites) : « 23 500 »
const n = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
const q = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 3 });

/** Styles d'impression : 72 mm imprimables sur un rouleau de 80 mm, sans marge. */
export const TICKET_PRINT_CSS =
  "@page { margin: 0; } @media print { html, body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }";

// Couleurs GJH à l'écran ; à l'impression (thermique ou sans couleur) tout reste
// lisible en noir : aucun texte blanc, les fonds colorés ne sont que décoratifs.
/** Facture au format choisi dans Paramètres (ticket détaillé, compact, 58 mm…). */
export function Ticket({ t, format = "TICKET_80" }: { t: TicketData; format?: TicketFormat }) {
  if (format === "TICKET_80_COMPACT") return <TicketCompact t={t} />;
  return <Ticket80 t={t} narrow={format === "TICKET_58"} />;
}

export function Ticket80({ t, narrow = false }: { t: TicketData; narrow?: boolean }) {
  const c = t.company;
  const date = new Date(t.date);
  const place = [t.center.address ?? c.address, t.center.city ?? c.city].filter(Boolean).join(", ");
  const who = sellerLabel(t.cashierRole, t.cashierFirstName);
  return (
    <div
      className={`mx-auto bg-white font-sans leading-tight text-black ${narrow ? "w-[48mm] px-[1mm] py-2 text-[10px]" : "w-[72mm] px-[2mm] py-3 text-[11.5px]"}`}
    >
      <header className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo couleur, aussi à l'impression (mis en cache hors ligne) */}
        <img src="/icons/gjh-logo.png" alt="" className={`mx-auto mb-1 w-auto object-contain ${narrow ? "h-[15mm]" : "h-[22mm]"}`} />
        <p className={`${narrow ? "text-[13px]" : "text-[17px]"} font-black uppercase tracking-wide`} style={{ color: NAVY }}>
          {c.tradeName}
        </p>
        {c.legalName && c.legalName !== c.tradeName && <p>{c.legalName}</p>}
        {t.center.name && t.center.name !== c.tradeName && <p className="font-semibold">{t.center.name}</p>}
        {place && <p>{place}</p>}
        <p>Tél. {t.center.phone ?? c.phone}</p>
        {c.taxId && <p className="font-semibold">IFU : {c.taxId}</p>}
        {c.tradeRegNumber && <p>RCCM : {c.tradeRegNumber}</p>}
      </header>

      <div className="mt-2 border-y-2 py-1.5" style={{ borderColor: GOLD }}>
        <p className="text-[13px] font-black" style={{ color: NAVY }}>
          FACTURE N° {t.saleNumber}
        </p>
        <p>Date : {stamp(date)}</p>
        <p>
          Client : <strong>{t.customer ? t.customer.name : "Client Prestige"}</strong>
          {t.customer?.phone && ` (${t.customer.phone})`}
        </p>
        {t.customer?.taxId && <p>IFU client : {t.customer.taxId}</p>}
        {t.cancelled && <p className="mt-1 text-center text-[13px] font-black text-red-700">*** FACTURE ANNULÉE ***</p>}
      </div>

      <table className="mt-1.5 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b-2" style={{ borderColor: NAVY, color: NAVY, background: "#fdf6e3" }}>
            <th className="px-1 py-1 text-left font-bold">Article</th>
            <th className="px-1 py-1 text-right font-bold">Qté</th>
            {!narrow && <th className="px-1 py-1 text-right font-bold">P.U.</th>}
            <th className="px-1 py-1 text-right font-bold">Montant</th>
          </tr>
        </thead>
        <tbody>
          {t.lines.map((l) => (
            <tr key={l.key} className="border-b border-gray-400 align-top">
              <td className="px-1 py-1">
                <span className="font-semibold uppercase">{l.name}</span>
                {narrow && (
                  <span className="block text-[9px]">
                    {q(l.quantity)} × {n(l.unitPrice)}
                  </span>
                )}
                {l.ref && <span className="block text-[9.5px]">Réf. {l.ref}</span>}
                {l.discount > 0 && (
                  <span className="block text-[9.5px]">
                    Remise {n(l.discount)} / {l.unitSymbol}
                  </span>
                )}
                {l.lots?.map((lot, k) => (
                  <span key={k} className="block text-[9.5px]">
                    Lot {lot.lotNumber ?? "—"}
                    {lot.expiresAt && ` exp. ${new Date(lot.expiresAt).toLocaleDateString("fr-FR")}`}
                  </span>
                ))}
              </td>
              <td className="px-1 py-1 text-right whitespace-nowrap">
                {q(l.quantity)}
                <span className="block text-[9.5px]">{l.unitSymbol}</span>
              </td>
              {!narrow && <td className="px-1 py-1 text-right whitespace-nowrap">{n(l.unitPrice)}</td>}
              <td className="px-1 py-1 text-right font-semibold whitespace-nowrap">{n(l.lineTotal)}</td>
            </tr>
          ))}
          {t.discountAmount > 0 && (
            <tr className="border-b border-gray-400">
              <td colSpan={narrow ? 2 : 3} className="px-1 py-0.5 font-semibold">
                Réduction
              </td>
              <td className="px-1 py-0.5 text-right">−{n(t.discountAmount)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-1 border-t-2 pt-1" style={{ borderColor: GOLD }}>
        <div className="flex items-baseline justify-between text-[15px] font-black" style={{ color: NAVY }}>
          <span>{t.discountAmount > 0 ? "NET À PAYER" : "TOTAL"}</span>
          <span>{n(t.total)}</span>
        </div>
        <p className="text-right text-[10px]">Montants en {c.currency === "XOF" || c.currency === "XAF" ? "francs CFA" : c.currency}</p>
      </div>

      {t.tax > 0 && (
        <div className="mt-1 text-[10.5px]">
          <div className="flex justify-between">
            <span>Total HT</span>
            <span>{n(t.total - t.tax)}</span>
          </div>
          <div className="flex justify-between">
            <span>TVA</span>
            <span>{n(t.tax)}</span>
          </div>
        </div>
      )}

      <div className="mt-1.5 space-y-0.5 text-[11.5px]">
        {t.payments.map((p, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span>
              Payé — {METHODS[p.method] ?? p.method}
              {p.reference && ` (${p.reference})`}
            </span>
            <span>{n(p.amount)}</span>
          </div>
        ))}
        {t.tendered != null && t.tendered > 0 && (
          <>
            <div className="flex justify-between">
              <span>Montant remis</span>
              <span>{n(t.tendered)}</span>
            </div>
            <div className="flex justify-between font-black" style={{ color: NAVY }}>
              <span>Monnaie rendue</span>
              <span>{n(t.change ?? 0)}</span>
            </div>
          </>
        )}
        {(t.refunded ?? 0) > 0 && (
          <div className="flex justify-between font-semibold">
            <span>Remboursé</span>
            <span>−{n(t.refunded!)}</span>
          </div>
        )}
      </div>

      {t.pickupPending && !t.cancelled && (
        <p className="mt-2 border border-black py-1 text-center text-[11.5px] font-black">À PRÉSENTER AU MAGASIN POUR ÊTRE SERVI</p>
      )}

      <div className="mt-2 flex justify-center">
        <Barcode value={t.saleNumber} height={narrow ? 26 : 32} />
      </div>

      <footer className="mt-2 text-center">
        <p className="font-semibold" style={{ color: NAVY }}>
          Merci de votre confiance
        </p>
        {c.invoiceNotes && <p className="mt-1 whitespace-pre-line text-[10px]">{c.invoiceNotes}</p>}
        <p className="mt-2 border-t border-dashed border-gray-500 pt-1 text-center text-[11px]">
          {who} — {stamp(date)}
        </p>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────
// Ticket 80 mm compact (comme les anciens logiciels de caisse)
// ─────────────────────────────────────────────
// Peu de papier : n°, date et heure, IFU, une ligne par article
// (réf. · désignation · qté · P.U. · montant), total à payer, qui a encaissé.
export function TicketCompact({ t }: { t: TicketData }) {
  const c = t.company;
  const d = new Date(t.date);
  const day = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const hour = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const cash = t.tendered != null && t.tendered > 0;
  return (
    <div className="mx-auto w-[72mm] bg-white px-[2mm] py-2 font-sans text-[11px] leading-snug text-black">
      <p className="text-center text-[13px] font-black uppercase">{c.tradeName}</p>
      <p className="text-center text-[10px]">
        {[t.center.city ?? c.city, `Tél. ${t.center.phone ?? c.phone}`].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-1.5 flex items-end justify-between border-b border-black pb-1">
        <p className="text-[16px] font-black">Facture N° {t.saleNumber}</p>
      </div>
      <div className="mt-1 grid grid-cols-[1fr_auto] gap-x-2 text-[10.5px]">
        <span>Date : {day}</span>
        <span className="text-right font-semibold">HEURE</span>
        <span>{c.taxId ? `IFU : ${c.taxId}` : ""}</span>
        <span className="text-right">{hour}</span>
      </div>
      {t.customer && <p className="text-[10.5px]">Client : {t.customer.name}</p>}
      {t.cancelled && <p className="mt-1 text-center font-black">*** ANNULÉE ***</p>}
      <table className="mt-1.5 w-full border-collapse text-[10.5px]">
        <tbody>
          {t.lines.map((l) => (
            <tr key={l.key} className="align-top">
              <td className="py-0.5 pr-1">
                {l.ref && <span className="mr-1">{l.ref}</span>}
                <span className="uppercase">{l.name}</span>
              </td>
              <td className="py-0.5 pr-1 text-right whitespace-nowrap">{q(l.quantity)}</td>
              <td className="py-0.5 pr-1 text-right whitespace-nowrap">{n(l.unitPrice)}</td>
              <td className="py-0.5 text-right whitespace-nowrap">{n(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {t.discountAmount > 0 && (
        <div className="flex justify-between text-[10.5px]">
          <span>Réduction</span>
          <span>−{n(t.discountAmount)}</span>
        </div>
      )}
      <div className="mt-1 flex justify-between border-t border-black pt-1 text-[13px] font-black">
        <span>{t.discountAmount > 0 ? "NET A PAYER" : "TOTAL A PAYER"}</span>
        <span>{n(t.total)}</span>
      </div>
      {cash && (
        <div className="text-[10.5px]">
          <div className="flex justify-between">
            <span>Remis</span>
            <span>{n(t.tendered!)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Rendu</span>
            <span>{n(t.change ?? 0)}</span>
          </div>
        </div>
      )}
      {!cash && t.payments.length > 0 && (
        <p className="text-[10.5px]">Payé : {t.payments.map((p) => METHODS[p.method] ?? p.method).join(" + ")}</p>
      )}
      {t.pickupPending && !t.cancelled && <p className="mt-1 text-center text-[10.5px] font-black">À PRÉSENTER AU MAGASIN</p>}
      <p className="mt-1.5 border-t border-dashed border-gray-500 pt-1 text-center text-[10.5px]">{sellerLabel(t.cashierRole, t.cashierFirstName)}</p>
    </div>
  );
}

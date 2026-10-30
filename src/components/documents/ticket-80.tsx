"use client";

import { Barcode } from "@/components/documents/a4-document";
import { EmecfTicketBlock, type EmecfView } from "@/components/documents/emecf-block";

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
  /** Facture normalisée e-MECeF (entreprises abonnées) : null = en attente. */
  emecf?: EmecfView | null;
  emecfEnabled?: boolean;
  /** Avoir normalisé (vente annulée). */
  emecfCredit?: EmecfView | null;
}

const METHODS: Record<string, string> = { CASH: "Espèces", MOBILE_MONEY: "Mobile money", CARD: "Carte", TRANSFER: "Virement", MIXED: "Mixte" };
// Montants sans symbole (colonnes étroites) : « 23 500 »
const n = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
const q = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 3 });

/** Styles d'impression : 72 mm imprimables sur un rouleau de 80 mm, sans marge. */
export const TICKET_PRINT_CSS = "@page { margin: 0; } @media print { html, body { background: #fff; width: 80mm; } }";

export function Ticket80({ t }: { t: TicketData }) {
  const c = t.company;
  const date = new Date(t.date);
  const place = [t.center.address ?? c.address, t.center.city ?? c.city].filter(Boolean).join(", ");
  return (
    <div className="w-[72mm] bg-white px-[2mm] py-3 font-sans text-[11.5px] leading-tight text-black">
      <header className="text-center">
        <p className="text-[17px] font-black uppercase tracking-wide">{c.tradeName}</p>
        {c.legalName && c.legalName !== c.tradeName && <p>{c.legalName}</p>}
        {place && <p>{place}</p>}
        <p>Tél. {t.center.phone ?? c.phone}</p>
        {c.taxId && <p className="font-semibold">IFU : {c.taxId}</p>}
        {c.tradeRegNumber && <p>RCCM : {c.tradeRegNumber}</p>}
      </header>

      <div className="mt-2 border-y border-black py-1.5">
        <p className="text-[13px] font-black">FACTURE N° {t.saleNumber}</p>
        <p>
          Date : {date.toLocaleDateString("fr-FR")} à {date.toLocaleTimeString("fr-FR")}
        </p>
        <p>Livraison : {t.center.name.toUpperCase()}</p>
        <p>
          Client : {t.customer ? t.customer.name : "Clients divers"}
          {t.customer?.phone && ` (${t.customer.phone})`}
        </p>
        {t.customer?.taxId && <p>IFU client : {t.customer.taxId}</p>}
        {t.cancelled && <p className="mt-1 text-center text-[13px] font-black">*** FACTURE ANNULÉE ***</p>}
      </div>

      <table className="mt-1.5 w-full border-collapse border border-black text-[11px]">
        <thead>
          <tr className="border-b border-black">
            <th className="border-r border-black px-1 py-0.5 text-left font-bold">Article</th>
            <th className="border-r border-black px-1 py-0.5 text-right font-bold">Qté</th>
            <th className="border-r border-black px-1 py-0.5 text-right font-bold">P.U.</th>
            <th className="px-1 py-0.5 text-right font-bold">Montant</th>
          </tr>
        </thead>
        <tbody>
          {t.lines.map((l) => (
            <tr key={l.key} className="border-b border-black align-top">
              <td className="border-r border-black px-1 py-0.5">
                <span className="font-semibold uppercase">{l.name}</span>
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
              <td className="border-r border-black px-1 py-0.5 text-right whitespace-nowrap">
                {q(l.quantity)}
                <span className="block text-[9.5px]">{l.unitSymbol}</span>
              </td>
              <td className="border-r border-black px-1 py-0.5 text-right whitespace-nowrap">{n(l.unitPrice)}</td>
              <td className="px-1 py-0.5 text-right font-semibold whitespace-nowrap">{n(l.lineTotal)}</td>
            </tr>
          ))}
          {t.discountAmount > 0 && (
            <tr className="border-b border-black">
              <td colSpan={3} className="border-r border-black px-1 py-0.5">
                Remises
              </td>
              <td className="px-1 py-0.5 text-right">−{n(t.discountAmount)}</td>
            </tr>
          )}
          <tr className="text-[14px]">
            <td colSpan={3} className="border-r border-black px-1 py-1 font-black">
              Total dû
            </td>
            <td className="px-1 py-1 text-right font-black whitespace-nowrap">{n(t.total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-0.5 text-right text-[10px]">Montants en {c.currency === "XOF" || c.currency === "XAF" ? "francs CFA" : c.currency}</p>

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

      <div className="mt-1.5 text-[11px]">
        {t.payments.map((p, i) => (
          <div key={i}>
            <div className="flex justify-between gap-2">
              <span>
                Payé — {METHODS[p.method] ?? p.method}
                {p.reference && ` (${p.reference})`}
              </span>
              <span>{n(p.amount)}</span>
            </div>
            {p.notes && <p className="text-[10px]">{p.notes}</p>}
          </div>
        ))}
        {(t.refunded ?? 0) > 0 && (
          <div className="flex justify-between font-semibold">
            <span>Remboursé</span>
            <span>−{n(t.refunded!)}</span>
          </div>
        )}
      </div>

      {t.emecfEnabled && (
        <EmecfTicketBlock
          e={t.emecf ?? { status: "PENDING", codeMecefDgi: null, qrCode: null, counters: null, nim: null, dgiDateTime: null }}
        />
      )}
      {t.emecfCredit?.status === "NORMALIZED" && <EmecfTicketBlock e={{ ...t.emecfCredit, type: "FA" }} />}

      {t.pickupPending && !t.cancelled && (
        <p className="mt-2 border border-black py-1 text-center text-[11.5px] font-black">À PRÉSENTER AU MAGASIN POUR ÊTRE SERVI</p>
      )}

      <div className="mt-2 flex justify-center">
        <Barcode value={t.saleNumber} height={32} />
      </div>

      <footer className="mt-2 text-center">
        <p>Merci de votre visite</p>
        {c.invoiceNotes && <p className="mt-1 whitespace-pre-line text-[10px]">{c.invoiceNotes}</p>}
        <p className="mt-1.5 text-left">{t.cashierFirstName}</p>
      </footer>
    </div>
  );
}

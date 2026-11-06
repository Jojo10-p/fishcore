"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { amountInWords } from "@/lib/amount-in-words";
import { closeOrBack, formatCurrency } from "@/lib/utils";

// ─────────────────────────────────────────────
// Documents commerciaux A4 (facture, devis, bon de sortie)
// ─────────────────────────────────────────────
// Une seule mise en page pour tous les documents : en-tête de l'entreprise
// (mentions légales IFU / RCCM), bloc client, tableau, totaux, montant en
// lettres, signatures. Aux couleurs GJH (bleu nuit et or) ; lisible aussi
// imprimée en noir et blanc.

export interface DocCompany {
  tradeName: string;
  legalName: string | null;
  logoUrl: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  poBox: string | null;
  taxId: string | null;
  tradeRegNumber: string | null;
  currency: string;
  vatEnabled: boolean;
  invoiceNotes: string | null;
}

export interface DocCenter {
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
}

export interface DocParty {
  name: string;
  phone: string | null;
  email?: string | null;
  address: string | null;
  taxId: string | null;
}

export interface DocLine {
  id: string;
  name: string;
  detail?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount: number; // par unité
  lineTotal: number;
  taxRate: number;
}

const qty = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

/** Code-barres (Code 128) du numéro : lu par la douchette du magasin. */
export function Barcode({ value, height = 38 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: "CODE128", height, width: 1.4, fontSize: 11, margin: 0, displayValue: true });
    } catch {
      // Valeur non encodable : on laisse le numéro en clair
    }
  }, [value, height]);
  return <svg ref={ref} aria-label={`Code-barres ${value}`} />;
}

/** Page A4 + barre d'outils (masquée à l'impression). */
export function A4Page({ children, toolbar }: { children: React.ReactNode; toolbar?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff; } article { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap justify-center gap-2 px-4 print:hidden">
        <button onClick={() => window.print()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          Imprimer
        </button>
        {toolbar}
        <button onClick={closeOrBack} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm hover:bg-gray-50">
          Fermer
        </button>
      </div>
      <article className="mx-auto w-full max-w-[210mm] min-h-[297mm] bg-white px-[14mm] py-[12mm] text-[12px] leading-snug text-gray-900 shadow print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        {children}
      </article>
    </div>
  );
}

export function DocumentHeader({
  company,
  center,
  title,
  number,
  meta,
}: {
  company: DocCompany;
  center: DocCenter | null;
  title: string;
  number: string;
  meta: Array<[string, React.ReactNode]>;
}) {
  const place = [center?.address ?? company.address, center?.city ?? company.city].filter(Boolean).join(", ");
  return (
    <header className="relative flex items-start justify-between gap-6 border-b-4 border-[#0b1f4b] pb-4 after:absolute after:-bottom-[7px] after:left-0 after:h-[3px] after:w-1/3 after:bg-[#e3a82b]">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo GJH statique */}
          <img src="/icons/gjh-logo.png" alt="" className="h-16 w-auto object-contain" />
          <div>
            <p className="text-xl font-bold uppercase tracking-wide text-[#0b1f4b]">{company.tradeName}</p>
            {company.legalName && company.legalName !== company.tradeName && <p className="text-[11px] text-gray-600">{company.legalName}</p>}
          </div>
        </div>
        <div className="mt-2 space-y-0.5 text-[11px] text-gray-700">
          {center && <p>{center.name}</p>}
          {place && <p>{place}</p>}
          {company.poBox && <p>{company.poBox}</p>}
          <p>
            Tél. {center?.phone ?? company.phone}
          </p>
          {(company.taxId || company.tradeRegNumber) && (
            <p>
              {company.taxId && `IFU : ${company.taxId}`}
              {company.taxId && company.tradeRegNumber && " · "}
              {company.tradeRegNumber && `RCCM : ${company.tradeRegNumber}`}
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-2xl font-black tracking-wider text-[#0b1f4b]">{title}</p>
        <p className="mt-0.5 inline-block rounded bg-[#fdf6e3] px-2 py-0.5 text-sm font-semibold text-[#8a5a00]">N° {number}</p>
        <dl className="mt-2 space-y-0.5 text-[11px]">
          {meta.map(([k, v]) => (
            <div key={k} className="flex justify-end gap-2">
              <dt className="text-gray-500">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2 flex justify-end">
          <Barcode value={number} height={30} />
        </div>
      </div>
    </header>
  );
}

export function PartyBlock({ label, party }: { label: string; party: DocParty | null }) {
  return (
    <section className="mt-5 ml-auto w-[48%] rounded-lg border border-[#e3a82b] border-l-4 bg-[#fffbf0] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8a5a00]">{label}</p>
      {party ? (
        <div className="mt-1 space-y-0.5">
          <p className="text-sm font-semibold">{party.name}</p>
          {party.address && <p>{party.address}</p>}
          {(party.phone || party.email) && <p>{[party.phone && `Tél. ${party.phone}`, party.email].filter(Boolean).join(" · ")}</p>}
          {party.taxId && <p>IFU : {party.taxId}</p>}
        </div>
      ) : (
        <p className="mt-1 text-sm font-semibold">Client Prestige</p>
      )}
    </section>
  );
}

export function LinesTable({ lines, currency, showTax }: { lines: DocLine[]; currency: string; showTax: boolean }) {
  const money = (n: number) => formatCurrency(n, currency);
  const hasDiscount = lines.some((l) => l.discount > 0);
  return (
    <table className="mt-5 w-full border-collapse text-[11.5px]">
      <thead>
        <tr className="bg-[#0b1f4b] text-left text-white">
          <th className="px-2 py-1.5 font-semibold w-8">#</th>
          <th className="px-2 py-1.5 font-semibold">Désignation</th>
          <th className="px-2 py-1.5 font-semibold text-right">Qté</th>
          <th className="px-2 py-1.5 font-semibold">Unité</th>
          <th className="px-2 py-1.5 font-semibold text-right">P.U.{showTax ? " TTC" : ""}</th>
          {hasDiscount && <th className="px-2 py-1.5 font-semibold text-right">Remise / u</th>}
          {showTax && <th className="px-2 py-1.5 font-semibold text-right">TVA</th>}
          <th className="px-2 py-1.5 font-semibold text-right">Montant{showTax ? " TTC" : ""}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={l.id} className="border-b border-gray-200 align-top even:bg-[#f6f8fc] [break-inside:avoid]">
            <td className="px-2 py-1.5 text-gray-500">{i + 1}</td>
            <td className="px-2 py-1.5">
              <p className="font-medium">{l.name}</p>
              {l.detail && <p className="text-[10px] text-gray-500">{l.detail}</p>}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{qty(l.quantity)}</td>
            <td className="px-2 py-1.5">{l.unit}</td>
            <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{money(l.unitPrice)}</td>
            {hasDiscount && <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{l.discount > 0 ? `−${money(l.discount)}` : ""}</td>}
            {showTax && <td className="px-2 py-1.5 text-right tabular-nums">{l.taxRate > 0 ? `${qty(l.taxRate)} %` : "—"}</td>}
            <td className="px-2 py-1.5 text-right font-medium tabular-nums whitespace-nowrap">{money(l.lineTotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TotalsBlock({
  subtotal,
  discount,
  total,
  tax,
  currency,
  extra,
}: {
  subtotal: number;
  discount: number;
  total: number;
  tax: number;
  currency: string;
  extra?: Array<[string, number]>;
}) {
  const money = (n: number) => formatCurrency(n, currency);
  const rows: Array<[string, string, boolean?]> = [];
  if (discount > 0) {
    rows.push(["Total brut", money(subtotal)]);
    rows.push(["Remises", `−${money(discount)}`]);
  }
  if (tax > 0) {
    rows.push(["Total HT", money(total - tax)]);
    rows.push(["TVA", money(tax)]);
  }
  rows.push([tax > 0 ? "NET À PAYER TTC" : "NET À PAYER", money(total), true]);
  for (const [k, v] of extra ?? []) rows.push([k, money(v)]);
  return (
    <div className="mt-4 flex justify-end [break-inside:avoid]">
      <table className="w-[48%] text-[12px]">
        <tbody>
          {rows.map(([k, v, strong]) => (
            <tr key={k} className={strong ? "border-y-2 border-[#e3a82b] bg-[#0b1f4b] text-sm font-bold text-white" : ""}>
              <td className="px-2 py-1">{k}</td>
              <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AmountInWords({ label, amount, currency }: { label: string; amount: number; currency: string }) {
  return (
    <p className="mt-4 [break-inside:avoid] text-[11.5px]">
      {label} <strong>{amountInWords(amount, currency)}</strong>.
    </p>
  );
}

export function Signatures({ labels }: { labels: string[] }) {
  return (
    <div className="mt-8 grid gap-6 [break-inside:avoid]" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((l) => (
        <div key={l} className="h-24 rounded border border-gray-300 p-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {l}
        </div>
      ))}
    </div>
  );
}

export function DocumentFooter({ company, note }: { company: DocCompany; note?: string }) {
  return (
    <footer className="mt-8 border-t-2 border-[#e3a82b] pt-2 text-center text-[10px] text-gray-500 [break-inside:avoid]">
      {company.invoiceNotes && <p className="whitespace-pre-line text-gray-700">{company.invoiceNotes}</p>}
      {note && <p className="mt-1">{note}</p>}
      <p className="mt-1">
        {company.tradeName}
        {company.taxId && ` · IFU ${company.taxId}`}
        {company.tradeRegNumber && ` · RCCM ${company.tradeRegNumber}`}
        {` · Tél. ${company.phone}`}
      </p>
    </footer>
  );
}

/** Tampon « ANNULÉE », « PAYÉE », « EXPIRÉ »… en travers du document. */
export function Stamp({ text, tone }: { text: string; tone: "red" | "green" | "gray" }) {
  const color = tone === "red" ? "border-red-700 text-red-700" : tone === "green" ? "border-green-700 text-green-700" : "border-gray-500 text-gray-500";
  return (
    <div className={`pointer-events-none mx-auto mt-4 w-fit -rotate-6 rounded border-4 px-6 py-1 text-2xl font-black tracking-[0.3em] opacity-80 ${color}`}>
      {text}
    </div>
  );
}

"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { apiGet, errorMessage } from "@/lib/client/api";
import { formatCurrency } from "@/lib/utils";
import {
  A4Page,
  AmountInWords,
  DocumentFooter,
  DocumentHeader,
  LinesTable,
  PartyBlock,
  Signatures,
  Stamp,
  type DocCompany,
  type DocParty,
} from "@/components/documents/a4-document";

interface InvoiceData {
  id: string;
  saleNumber: string;
  createdAt: string;
  status: string;
  deliveryStatus: "PENDING" | "PARTIAL" | "DELIVERED";
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  taxAmount: string;
  lines: Array<{
    id: string;
    quantity: string;
    deliveredQuantity: string;
    unitPrice: string;
    discount: string;
    lineTotal: string;
    taxRate: string;
    unitSymbol: string;
    lots: Array<{ lotNumber: string | null; expiresAt: string | null }>;
    product: { name: string };
  }>;
  payments: Array<{ id: string; method: string; amount: string; reference: string | null; notes: string | null }>;
  refunds: Array<{ id: string; amount: string }>;
  cashier: { firstName: string; lastName: string };
  customer: DocParty | null;
  quote: { id: string; number: string } | null;
  deliveries: Array<{ id: string; number: number; createdAt: string; deliveredBy: string; lines: Array<{ saleLineId: string; quantity: string }> }>;
  session: { cashRegister: { name: string; center: { name: string; address: string | null; city: string | null; phone: string | null } } };
  company: DocCompany & { requiresPickup: boolean };
}

const METHODS: Record<string, string> = { CASH: "Espèces", MOBILE_MONEY: "Mobile money", CARD: "Carte", TRANSFER: "Virement", MIXED: "Mixte" };
const qty = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const dateTime = (d: string) => new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

// Facture A4 (cahier §13) : remise au client, présentée au magasin pour être servi
export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [sale, setSale] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: InvoiceData }>(`/api/sales/${id}`)
      .then((r) => setSale(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    if (sale) document.title = `Facture ${sale.saleNumber}`;
  }, [sale]);

  if (error) return <p className="p-8 text-center text-sm text-red-700">{error}</p>;
  if (!sale) return <p className="p-8 text-center text-sm text-gray-500">Chargement de la facture…</p>;

  const cur = sale.company.currency;
  const money = (v: string | number) => formatCurrency(Number(v), cur);
  const center = sale.session.cashRegister.center;
  const cancelled = sale.status === "CANCELLED";
  const total = Number(sale.totalAmount);
  const tax = Number(sale.taxAmount);
  const pickup = sale.company.requiresPickup;

  return (
    <A4Page
      toolbar={
        <Link href={`/recu/${sale.id}`} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm hover:bg-gray-50">
          Ticket de caisse
        </Link>
      }
    >
      <DocumentHeader
        company={sale.company}
        center={center}
        title="FACTURE"
        number={sale.saleNumber}
        meta={[
          ["Date", dateTime(sale.createdAt)],
          ["Caisse", sale.session.cashRegister.name],
          ["Vendeur", `${sale.cashier.firstName} ${sale.cashier.lastName}`],
          ...(sale.quote ? ([["Devis", sale.quote.number]] as Array<[string, string]>) : []),
        ]}
      />

      <PartyBlock label="Facturé à" party={sale.customer} />

      {cancelled ? <Stamp text="ANNULÉE" tone="red" /> : <Stamp text="PAYÉE" tone="green" />}

      <LinesTable
        currency={cur}
        showTax={tax > 0}
        lines={sale.lines.map((l) => ({
          id: l.id,
          name: l.product.name,
          detail: l.lots?.length
            ? l.lots.map((lot) => `Lot ${lot.lotNumber ?? "—"}${lot.expiresAt ? ` · exp. ${new Date(lot.expiresAt).toLocaleDateString("fr-FR")}` : ""}`).join(" ; ")
            : undefined,
          quantity: Number(l.quantity),
          unit: l.unitSymbol,
          unitPrice: Number(l.unitPrice),
          discount: Number(l.discount),
          lineTotal: Number(l.lineTotal),
          taxRate: Number(l.taxRate),
        }))}
      />

      <div className="mt-4 grid grid-cols-2 gap-6 [break-inside:avoid]">
        <div className="text-[11px]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Règlement</p>
          <ul className="mt-1 space-y-0.5">
            {sale.payments.map((p) => (
              <li key={p.id}>
                {METHODS[p.method] ?? p.method} : <strong>{money(p.amount)}</strong>
                {p.reference && <span className="text-gray-600"> (réf. {p.reference})</span>}
                {p.notes && <span className="block text-gray-500">{p.notes}</span>}
              </li>
            ))}
            {sale.refunds.length > 0 && (
              <li className="text-red-700">Remboursé : {money(sale.refunds.reduce((s, r) => s + Number(r.amount), 0))}</li>
            )}
          </ul>
        </div>
        <TotalsInline subtotal={Number(sale.subtotal)} discount={Number(sale.discountAmount)} total={total} tax={tax} money={money} />
      </div>

      <AmountInWords label="Arrêtée la présente facture à la somme de" amount={total} currency={cur} />

      {pickup && !cancelled && (
        <section className="mt-6 rounded border-2 border-dashed border-gray-400 p-3 [break-inside:avoid]">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold uppercase tracking-wide">Bon pour retrait de la marchandise</p>
            <p className="text-[11px] font-semibold">
              {sale.deliveryStatus === "DELIVERED" ? "ENTIÈREMENT SERVIE" : sale.deliveryStatus === "PARTIAL" ? "SERVIE EN PARTIE" : "À SERVIR"}
            </p>
          </div>
          <p className="mt-0.5 text-[10.5px] text-gray-600">
            À présenter au magasin. Le magasinier enregistre chaque remise : une facture ne sert qu&apos;une fois.
          </p>
          <table className="mt-2 w-full text-[11px]">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-0.5 font-medium">Article</th>
                <th className="py-0.5 font-medium text-right">Payé</th>
                <th className="py-0.5 font-medium text-right">Déjà remis</th>
                <th className="py-0.5 font-medium text-right">Reste à remettre</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l) => {
                const left = Number(l.quantity) - Number(l.deliveredQuantity);
                return (
                  <tr key={l.id} className="border-t border-gray-200">
                    <td className="py-0.5">{l.product.name}</td>
                    <td className="py-0.5 text-right">
                      {qty(Number(l.quantity))} {l.unitSymbol}
                    </td>
                    <td className="py-0.5 text-right">{qty(Number(l.deliveredQuantity))}</td>
                    <td className="py-0.5 text-right font-semibold">{left > 0 ? `${qty(left)} ${l.unitSymbol}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sale.deliveries.length > 0 && (
            <p className="mt-2 text-[10.5px] text-gray-600">
              {sale.deliveries.map((d) => `Retrait n° ${d.number} le ${dateTime(d.createdAt)} (${d.deliveredBy})`).join(" · ")}
            </p>
          )}
        </section>
      )}

      <Signatures labels={pickup ? ["Le client", "La caisse", "Le magasin"] : ["Le client", "La caisse"]} />
      <DocumentFooter company={sale.company} />
    </A4Page>
  );
}

function TotalsInline({ subtotal, discount, total, tax, money }: { subtotal: number; discount: number; total: number; tax: number; money: (n: number) => string }) {
  const rows: Array<[string, string, boolean?]> = [];
  if (discount > 0) rows.push(["Total brut", money(subtotal)], ["Remises", `−${money(discount)}`]);
  if (tax > 0) rows.push(["Total HT", money(total - tax)], ["TVA", money(tax)]);
  rows.push([tax > 0 ? "TOTAL TTC" : "TOTAL", money(total), true]);
  return (
    <table className="ml-auto w-full text-[12px]">
      <tbody>
        {rows.map(([k, v, strong]) => (
          <tr key={k} className={strong ? "border-y-2 border-gray-900 text-sm font-bold" : ""}>
            <td className="px-2 py-1">{k}</td>
            <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

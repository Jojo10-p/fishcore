"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { apiGet, errorMessage } from "@/lib/client/api";
import {
  A4Page,
  AmountInWords,
  DocumentFooter,
  DocumentHeader,
  LinesTable,
  PartyBlock,
  Signatures,
  Stamp,
  TotalsBlock,
  type DocCenter,
  type DocCompany,
  type DocParty,
} from "@/components/documents/a4-document";

interface QuoteData {
  id: string;
  number: string;
  createdAt: string;
  validUntil: string;
  status: "OPEN" | "CONVERTED" | "CANCELLED";
  expired: boolean;
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  taxAmount: string;
  notes: string | null;
  cancelReason: string | null;
  customer: DocParty;
  sale: { id: string; saleNumber: string } | null;
  lines: Array<{ id: string; quantity: string; unitPrice: string; discount: string; lineTotal: string; taxRate: string; unitSymbol: string; product: { name: string } }>;
  company: DocCompany;
  center: DocCenter | null;
  createdBy: string;
}

const day = (d: string) => new Date(d).toLocaleDateString("fr-FR");

// Devis A4 : remis ou envoyé au client, encaissé ensuite à la caisse
export default function QuoteDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: QuoteData }>(`/api/quotes/${id}`)
      .then((r) => setQuote(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    if (quote) document.title = `Devis ${quote.number} — ${quote.customer.name}`;
  }, [quote]);

  if (error) return <p className="p-8 text-center text-sm text-red-700">{error}</p>;
  if (!quote) return <p className="p-8 text-center text-sm text-gray-500">Chargement du devis…</p>;

  const cur = quote.company.currency;
  const total = Number(quote.totalAmount);
  const tax = Number(quote.taxAmount);

  return (
    <A4Page
      toolbar={
        quote.sale && (
          <Link href={`/facture/${quote.sale.id}`} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm hover:bg-gray-50">
            Voir la facture {quote.sale.saleNumber}
          </Link>
        )
      }
    >
      <DocumentHeader
        company={quote.company}
        center={quote.center}
        title="DEVIS"
        number={quote.number}
        meta={[
          ["Date", day(quote.createdAt)],
          ["Valable jusqu'au", day(quote.validUntil)],
          ["Établi par", quote.createdBy],
        ]}
      />

      <PartyBlock label="Client" party={quote.customer} />

      {quote.status === "CONVERTED" && <Stamp text={`FACTURÉ ${quote.sale?.saleNumber ?? ""}`} tone="green" />}
      {quote.status === "CANCELLED" && <Stamp text="ANNULÉ" tone="red" />}
      {quote.expired && <Stamp text="EXPIRÉ" tone="gray" />}

      <LinesTable
        currency={cur}
        showTax={tax > 0}
        lines={quote.lines.map((l) => ({
          id: l.id,
          name: l.product.name,
          quantity: Number(l.quantity),
          unit: l.unitSymbol,
          unitPrice: Number(l.unitPrice),
          discount: Number(l.discount),
          lineTotal: Number(l.lineTotal),
          taxRate: Number(l.taxRate),
        }))}
      />

      <TotalsBlock subtotal={Number(quote.subtotal)} discount={Number(quote.discountAmount)} total={total} tax={tax} currency={cur} />

      <AmountInWords label="Arrêté le présent devis à la somme de" amount={total} currency={cur} />

      <section className="mt-4 space-y-1 text-[11px] text-gray-700 [break-inside:avoid]">
        {quote.notes && <p className="whitespace-pre-line">{quote.notes}</p>}
        <p>
          Prix valables jusqu&apos;au <strong>{day(quote.validUntil)}</strong>, sous réserve de disponibilité du stock au moment de l&apos;achat.
          Pour commander, présentez ce devis (n° {quote.number}) à la caisse.
        </p>
      </section>

      <Signatures labels={["Bon pour accord — le client (date et signature)", "Pour l'entreprise"]} />
      <DocumentFooter company={quote.company} />
    </A4Page>
  );
}

"use client";

import { closeOrBack } from "@/lib/utils";
import { invoiceFileName } from "@/components/pos/printing";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Ticket, type TicketData } from "@/components/documents/ticket-80";
import { TICKET_FORMATS, asTicketFormat, ticketPrintCss, type TicketFormat } from "@/lib/invoice-formats";
import { apiGet, errorMessage } from "@/lib/client/api";

interface SaleDetail {
  id: string;
  saleNumber: string;
  createdAt: string;
  status: string;
  deliveryStatus: "PENDING" | "PARTIAL" | "DELIVERED";
  discountAmount: string;
  totalAmount: string;
  taxAmount: string;
  customer: { name: string; phone: string | null; taxId: string | null } | null;
  customerName: string | null;
  amountTendered: string | null;
  changeGiven: string | null;
  lines: Array<{
    id: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    lineTotal: string;
    unitSymbol: string;
    lots: Array<{ lotNumber: string | null; expiresAt: string | null }>;
    product: { name: string; internalCode: string | null };
  }>;
  payments: Array<{ method: string; amount: string; reference: string | null; notes: string | null }>;
  refunds: Array<{ amount: string }>;
  cashier: { firstName: string; role: string };
  session: { cashRegister: { center: { name: string; address: string | null; city: string | null; phone: string | null } } };
  company: TicketData["company"] & { requiresPickup: boolean; invoiceFormat?: string };
}

function toTicket(s: SaleDetail): TicketData {
  return {
    saleNumber: s.saleNumber,
    date: s.createdAt,
    company: s.company,
    center: s.session.cashRegister.center,
    customer: s.customer ?? (s.customerName ? { name: s.customerName } : null),
    cashierFirstName: s.cashier.firstName,
    cashierRole: s.cashier.role,
    tendered: s.amountTendered != null ? Number(s.amountTendered) : null,
    change: s.changeGiven != null ? Number(s.changeGiven) : null,
    lines: s.lines.map((l) => ({
      key: l.id,
      name: l.product.name,
      ref: l.product.internalCode,
      quantity: Number(l.quantity),
      unitSymbol: l.unitSymbol,
      unitPrice: Number(l.unitPrice),
      discount: Number(l.discount),
      lineTotal: Number(l.lineTotal),
      lots: l.lots,
    })),
    discountAmount: Number(s.discountAmount),
    total: Number(s.totalAmount),
    tax: Number(s.taxAmount),
    payments: s.payments.map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference, notes: p.notes })),
    refunded: s.refunds.reduce((sum, r) => sum + Number(r.amount), 0),
    cancelled: s.status === "CANCELLED",
    pickupPending: s.company.requiresPickup && s.deliveryStatus !== "DELIVERED",
  };
}

/**
 * Facture ticket (réimpression), au format choisi dans Paramètres ou via ?format=
 * (TICKET_80, TICKET_80_COMPACT, TICKET_80_210, TICKET_80_297, TICKET_58).
 * Réglage de l'imprimante : papier « 80(72.1) x 3276 mm » (rouleau), ou 210 / 297
 * pour les formats du même nom ; marges « Aucune ». ?print=1 : impression directe.
 */
export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<TicketFormat | null>(null);
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("format");
    const t = setTimeout(() => f && setChosen(asTicketFormat(f)), 0);
    return () => clearTimeout(t);
  }, []);
  // ?format= ou bouton choisi, sinon le format de l'entreprise (Paramètres)
  const format = chosen ?? asTicketFormat(sale?.company.invoiceFormat);

  useEffect(() => {
    apiGet<{ data: SaleDetail }>(`/api/sales/${id}`)
      .then((r) => setSale(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    if (!sale) return;
    document.title = invoiceFileName(sale.saleNumber);
    if (new URLSearchParams(window.location.search).get("print") !== "1") return;
    // Laisser le temps au code-barres d'être dessiné
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [sale]);

  if (error) return <p className="p-8 text-center text-sm text-red-700">{error}</p>;
  if (!sale) return <p className="p-8 text-center text-sm text-gray-500">Chargement de la facture…</p>;

  return (
    <div className="min-h-dvh bg-gray-100 py-6 print:min-h-0 print:bg-white print:py-0">
      <style>{ticketPrintCss(format)}</style>
      <div className="mx-auto w-fit shadow print:shadow-none">
        <Ticket t={toTicket(sale)} format={format} />
      </div>
      <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-1.5 px-3 print:hidden" role="group" aria-label="Format du ticket">
        {TICKET_FORMATS.map((f) => (
          <button
            key={f.value}
            onClick={() => setChosen(f.value)}
            aria-pressed={format === f.value}
            className={`rounded-full border px-3 py-1 text-xs ${format === f.value ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-700"}`}
          >
            {f.label.replace("Ticket ", "")}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-3 print:hidden">
        <button onClick={() => window.print()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">
          Imprimer
        </button>
        <Link href={`/facture/${sale.id}`} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm">
          Facture A4
        </Link>
        <button onClick={closeOrBack} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm">
          Fermer
        </button>
      </div>
    </div>
  );
}

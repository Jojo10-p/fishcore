"use client";

import { invoiceFileName } from "@/components/pos/printing";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { TICKET_PRINT_CSS, Ticket80, type TicketData } from "@/components/documents/ticket-80";
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
  company: TicketData["company"] & { requiresPickup: boolean };
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
 * Facture ticket 80 mm (réimpression). Réglage conseillé de l'imprimante :
 * papier « 80(72.1) x 3276 mm », marges « Aucune ». ?print=1 : impression directe.
 */
export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <style>{TICKET_PRINT_CSS}</style>
      <div className="mx-auto w-fit shadow print:shadow-none">
        <Ticket80 t={toTicket(sale)} />
      </div>
      <div className="mt-4 flex justify-center gap-3 print:hidden">
        <button onClick={() => window.print()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">
          Imprimer
        </button>
        <Link href={`/facture/${sale.id}`} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm">
          Facture A4
        </Link>
        <button onClick={() => window.close()} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm">
          Fermer
        </button>
      </div>
    </div>
  );
}

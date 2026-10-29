"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Barcode } from "@/components/documents/a4-document";
import { apiGet, errorMessage } from "@/lib/client/api";

interface TicketData {
  id: string;
  saleNumber: string;
  createdAt: string;
  status: string;
  deliveryStatus: "PENDING" | "PARTIAL" | "DELIVERED";
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  taxAmount: string;
  createdOffline: boolean;
  customer: { name: string; phone: string | null; taxId: string | null } | null;
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
  payments: Array<{ id: string; method: string; amount: string; reference: string | null; notes: string | null }>;
  refunds: Array<{ id: string; amount: string }>;
  cashier: { firstName: string; lastName: string };
  session: { cashRegister: { name: string; center: { name: string; address: string | null; city: string | null; phone: string | null } } };
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
    requiresPickup: boolean;
  };
}

const METHODS: Record<string, string> = { CASH: "Espèces", MOBILE_MONEY: "Mobile money", CARD: "Carte", TRANSFER: "Virement", MIXED: "Mixte" };
// Montants sans symbole sur le ticket (colonnes étroites) : « 23 500 »
const n = (v: string | number) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
const qty = (v: string | number) =>
  Number(v).toLocaleString("fr-FR", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 3 });

/**
 * Facture au format ticket 80 mm (imprimante thermique XP-80C et équivalentes).
 * Réglage conseillé de l'imprimante : papier « 80(72.1) x 3276 mm », marges « Aucune ».
 * ?print=1 : l'impression part toute seule (bouton de la caisse, impression automatique).
 */
export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [sale, setSale] = useState<TicketData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: TicketData }>(`/api/sales/${id}`)
      .then((r) => setSale(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    if (!sale) return;
    document.title = `Facture ${sale.saleNumber}`;
    if (new URLSearchParams(window.location.search).get("print") !== "1") return;
    // Laisser le temps au code-barres d'être dessiné
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [sale]);

  if (error) return <p className="p-8 text-center text-sm text-red-700">{error}</p>;
  if (!sale) return <p className="p-8 text-center text-sm text-gray-500">Chargement de la facture…</p>;

  const c = sale.company;
  const center = sale.session.cashRegister.center;
  const date = new Date(sale.createdAt);
  const cancelled = sale.status === "CANCELLED";
  const tax = Number(sale.taxAmount);
  const refunded = sale.refunds.reduce((s, r) => s + Number(r.amount), 0);
  const place = [center.address ?? c.address, center.city ?? c.city].filter(Boolean).join(", ");

  return (
    <div className="min-h-dvh bg-gray-100 py-6 print:min-h-0 print:bg-white print:py-0">
      {/* 72 mm imprimables sur un rouleau de 80 mm */}
      <style>{`@page { margin: 0; } @media print { html, body { background: #fff; width: 80mm; } }`}</style>
      <div className="mx-auto w-[72mm] bg-white px-[2mm] py-3 font-sans text-[11.5px] leading-tight text-black shadow print:shadow-none">
        <header className="text-center">
          <p className="text-[17px] font-black uppercase tracking-wide">{c.tradeName}</p>
          {c.legalName && c.legalName !== c.tradeName && <p>{c.legalName}</p>}
          {place && <p>{place}</p>}
          <p>Tél. {center.phone ?? c.phone}</p>
          {c.taxId && <p className="font-semibold">IFU : {c.taxId}</p>}
          {c.tradeRegNumber && <p>RCCM : {c.tradeRegNumber}</p>}
        </header>

        <div className="mt-2 border-y border-black py-1.5">
          <p className="text-[13px] font-black">FACTURE N° {sale.saleNumber}</p>
          <p>
            Date : {date.toLocaleDateString("fr-FR")} à {date.toLocaleTimeString("fr-FR")}
          </p>
          <p>Livraison : {center.name.toUpperCase()}</p>
          <p>
            Client : {sale.customer ? sale.customer.name : "Clients divers"}
            {sale.customer?.phone && ` (${sale.customer.phone})`}
          </p>
          {sale.customer?.taxId && <p>IFU client : {sale.customer.taxId}</p>}
          {cancelled && <p className="mt-1 text-center text-[13px] font-black">*** FACTURE ANNULÉE ***</p>}
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
            {sale.lines.map((l) => (
              <tr key={l.id} className="border-b border-black align-top">
                <td className="border-r border-black px-1 py-0.5">
                  <span className="font-semibold uppercase">{l.product.name}</span>
                  {l.product.internalCode && <span className="block text-[9.5px]">Réf. {l.product.internalCode}</span>}
                  {Number(l.discount) > 0 && (
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
                  {qty(l.quantity)}
                  <span className="block text-[9.5px]">{l.unitSymbol}</span>
                </td>
                <td className="border-r border-black px-1 py-0.5 text-right whitespace-nowrap">{n(l.unitPrice)}</td>
                <td className="px-1 py-0.5 text-right font-semibold whitespace-nowrap">{n(l.lineTotal)}</td>
              </tr>
            ))}
            {Number(sale.discountAmount) > 0 && (
              <tr className="border-b border-black">
                <td colSpan={3} className="border-r border-black px-1 py-0.5">
                  Remises
                </td>
                <td className="px-1 py-0.5 text-right">−{n(sale.discountAmount)}</td>
              </tr>
            )}
            <tr className="text-[14px]">
              <td colSpan={3} className="border-r border-black px-1 py-1 font-black">
                Total dû
              </td>
              <td className="px-1 py-1 text-right font-black whitespace-nowrap">{n(sale.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-0.5 text-right text-[10px]">Montants en {c.currency === "XOF" || c.currency === "XAF" ? "francs CFA" : c.currency}</p>

        {tax > 0 && (
          <div className="mt-1 text-[10.5px]">
            <div className="flex justify-between">
              <span>Total HT</span>
              <span>{n(Number(sale.totalAmount) - tax)}</span>
            </div>
            <div className="flex justify-between">
              <span>TVA</span>
              <span>{n(tax)}</span>
            </div>
          </div>
        )}

        <div className="mt-1.5 text-[11px]">
          {sale.payments.map((p) => (
            <div key={p.id}>
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
          {refunded > 0 && (
            <div className="flex justify-between font-semibold">
              <span>Remboursé</span>
              <span>−{n(refunded)}</span>
            </div>
          )}
        </div>

        {c.requiresPickup && !cancelled && sale.deliveryStatus !== "DELIVERED" && (
          <p className="mt-2 border border-black py-1 text-center text-[11.5px] font-black">À PRÉSENTER AU MAGASIN POUR ÊTRE SERVI</p>
        )}

        <div className="mt-2 flex justify-center">
          <Barcode value={sale.saleNumber} height={32} />
        </div>

        <footer className="mt-2 text-center">
          <p>Merci de votre visite</p>
          {c.invoiceNotes && <p className="mt-1 whitespace-pre-line text-[10px]">{c.invoiceNotes}</p>}
          <p className="mt-1.5 text-left">{sale.cashier.firstName}</p>
          {sale.createdOffline && <p className="mt-1 text-[9.5px]">Vente enregistrée hors connexion</p>}
        </footer>
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

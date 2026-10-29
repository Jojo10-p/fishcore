"use client";

import { use, useEffect, useState } from "react";
import { apiGet, errorMessage } from "@/lib/client/api";
import { formatCurrency } from "@/lib/utils";

interface ReceiptData {
  saleNumber: string;
  createdAt: string;
  status: string;
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  taxAmount: string;
  createdOffline: boolean;
  lines: Array<{ id: string; quantity: string; unitPrice: string; discount: string; lineTotal: string; taxRate: string; unitSymbol: string; lots: Array<{ lotNumber: string | null; expiresAt: string | null }>; product: { name: string } }>;
  payments: Array<{ id: string; method: string; amount: string; notes: string | null }>;
  refunds: Array<{ id: string; amount: string }>;
  cashier: { firstName: string; lastName: string };
  session: { cashRegister: { name: string; center: { name: string; address: string | null; city: string | null; phone: string | null } } };
  company: { tradeName: string; legalName: string | null; phone: string; address: string | null; city: string | null; taxId: string | null; tradeRegNumber: string | null; currency: string };
}

const METHODS: Record<string, string> = {
  CASH: "Espèces",
  MOBILE_MONEY: "Mobile money",
  CARD: "Carte",
  TRANSFER: "Virement",
  CREDIT: "Crédit client",
  MIXED: "Mixte",
};

// Reçu imprimable (ticket 80 mm ou A4) — cahier §9.1, §13
export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [sale, setSale] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: ReceiptData }>(`/api/sales/${id}`)
      .then((r) => setSale(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  if (error) return <p className="p-8 text-center text-sm text-red-700">{error}</p>;
  if (!sale) return <p className="p-8 text-center text-sm text-gray-500">Chargement du reçu…</p>;

  const cur = sale.company.currency;
  const money = (v: string | number) => formatCurrency(Number(v), cur);
  const center = sale.session.cashRegister.center;

  return (
    <div className="min-h-dvh bg-gray-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto w-full max-w-[340px] bg-white p-5 font-mono text-[12px] leading-snug text-black shadow print:shadow-none">
        <div className="text-center">
          <p className="text-base font-bold">{sale.company.tradeName}</p>
          {sale.company.legalName && <p>{sale.company.legalName}</p>}
          <p>{center.name}</p>
          {(center.address || center.city) && <p>{[center.address, center.city].filter(Boolean).join(", ")}</p>}
          <p>Tél. {center.phone ?? sale.company.phone}</p>
          {sale.company.taxId && <p>IFU : {sale.company.taxId}</p>}
          {sale.company.tradeRegNumber && <p>RCCM : {sale.company.tradeRegNumber}</p>}
        </div>

        <hr className="my-3 border-dashed border-black" />
        <p>Reçu N° {sale.saleNumber}</p>
        <p>{new Date(sale.createdAt).toLocaleString("fr-FR")}</p>
        <p>
          {sale.session.cashRegister.name} — {sale.cashier.firstName} {sale.cashier.lastName}
        </p>
        {sale.status === "CANCELLED" && <p className="mt-1 font-bold">*** VENTE ANNULÉE ***</p>}
        <hr className="my-3 border-dashed border-black" />

        {sale.lines.map((l) => (
          <div key={l.id} className="mb-1.5">
            <p>{l.product.name}</p>
            <div className="flex justify-between">
              <span>
                {Number(l.quantity).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} {l.unitSymbol} × {money(l.unitPrice)}
                {Number(l.discount) > 0 && ` (−${money(l.discount)})`}
              </span>
              <span>{money(l.lineTotal)}</span>
            </div>
            {l.lots?.map((lot, k) => (
              <p key={k} className="text-[10px]">
                Lot {lot.lotNumber ?? "—"}
                {lot.expiresAt && ` · exp. ${new Date(lot.expiresAt).toLocaleDateString("fr-FR")}`}
              </p>
            ))}
          </div>
        ))}

        <hr className="my-3 border-dashed border-black" />
        {Number(sale.discountAmount) > 0 && (
          <div className="flex justify-between">
            <span>Remise</span>
            <span>−{money(sale.discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL{Number(sale.taxAmount) > 0 ? " TTC" : ""}</span>
          <span>{money(sale.totalAmount)}</span>
        </div>
        {Number(sale.taxAmount) > 0 && (
          <>
            <div className="flex justify-between text-[11px]">
              <span>dont TVA</span>
              <span>{money(sale.taxAmount)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span>Total HT</span>
              <span>{money(Number(sale.totalAmount) - Number(sale.taxAmount))}</span>
            </div>
          </>
        )}
        {sale.payments.map((p) => (
          <div key={p.id}>
            <div className="flex justify-between">
              <span>{METHODS[p.method] ?? p.method}</span>
              <span>{money(p.amount)}</span>
            </div>
            {p.notes && <p className="text-[11px]">{p.notes}</p>}
          </div>
        ))}
        {sale.refunds.length > 0 && (
          <div className="flex justify-between mt-1">
            <span>Remboursé</span>
            <span>−{money(sale.refunds.reduce((s, r) => s + Number(r.amount), 0))}</span>
          </div>
        )}

        <hr className="my-3 border-dashed border-black" />
        <p className="text-center">Merci de votre visite !</p>
        {sale.createdOffline && <p className="text-center text-[10px] mt-1">Vente enregistrée hors connexion</p>}
      </div>

      <div className="mt-4 flex justify-center gap-3 print:hidden">
        <button onClick={() => window.print()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">
          Imprimer
        </button>
        <button onClick={() => window.close()} className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm">
          Fermer
        </button>
      </div>
    </div>
  );
}

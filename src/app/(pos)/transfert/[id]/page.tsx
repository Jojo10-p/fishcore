"use client";

import { use, useEffect, useState } from "react";
import { apiGet, errorMessage } from "@/lib/client/api";
import { A4Page, DocumentFooter, DocumentHeader, PartyBlock, Signatures, Stamp, type DocCenter, type DocCompany } from "@/components/documents/a4-document";
import { formatCurrency } from "@/lib/utils";

interface TrData {
  number: string;
  status: "IN_TRANSIT" | "RECEIVED" | "CANCELLED";
  createdAt: string;
  receivedAt: string | null;
  notes: string | null;
  receptionNotes: string | null;
  createdBy: string | null;
  receivedBy: string | null;
  fromCenter: DocCenter & { code: string };
  toCenter: DocCenter & { code: string };
  company: DocCompany;
  lines: Array<{
    id: string;
    quantity: string;
    receivedQty: string | null;
    unitCost: string;
    batches: Array<{ lotNumber: string | null; expiresAt: string | null; quantity: string }> | null;
    product: { name: string; internalCode: string | null; baseUnit: { symbol: string } };
  }>;
}

const n = (v: string | number | null) => (v === null ? "" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 }));
const day = (d: string) => new Date(d).toLocaleDateString("fr-FR");

// Bon de transfert : accompagne la marchandise, signé au départ et à l'arrivée
export default function TransferDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tr, setTr] = useState<TrData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: TrData }>(`/api/transfers/${id}`)
      .then((r) => setTr(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(() => {
    if (tr) document.title = `Bon de transfert ${tr.number}`;
  }, [tr]);

  if (error) return <p className="p-8 text-center text-sm text-red-700">{error}</p>;
  if (!tr) return <p className="p-8 text-center text-sm text-gray-500">Chargement…</p>;
  const cur = tr.company.currency;
  const received = tr.status === "RECEIVED";
  const value = tr.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);

  return (
    <A4Page>
      <DocumentHeader
        company={tr.company}
        center={tr.fromCenter}
        title="BON DE TRANSFERT"
        number={tr.number}
        meta={[
          ["Expédié le", day(tr.createdAt)],
          ...(tr.receivedAt ? ([["Reçu le", day(tr.receivedAt)]] as Array<[string, string]>) : []),
          ["Expédié par", tr.createdBy ?? ""],
        ]}
      />
      <PartyBlock label="Destination" party={{ name: `${tr.toCenter.name} (${tr.toCenter.code})`, phone: tr.toCenter.phone, address: [tr.toCenter.address, tr.toCenter.city].filter(Boolean).join(", ") || null, taxId: null }} />
      {tr.status === "CANCELLED" && <Stamp text="ANNULÉ" tone="red" />}
      {received && <Stamp text="REÇU" tone="green" />}

      <table className="mt-5 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b-2 border-gray-900 text-left">
            <th className="py-1.5 pr-2">Réf.</th>
            <th className="py-1.5 pr-2">Désignation</th>
            <th className="py-1.5 pr-2 text-right">Expédié</th>
            <th className="py-1.5 pr-2 text-right">Reçu</th>
            <th className="py-1.5 pr-2">Unité</th>
            <th className="py-1.5 text-right">Valeur</th>
          </tr>
        </thead>
        <tbody>
          {tr.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-200 align-top [break-inside:avoid]">
              <td className="py-1.5 pr-2 font-mono">{l.product.internalCode ?? ""}</td>
              <td className="py-1.5 pr-2">
                {l.product.name}
                {l.batches && l.batches.length > 0 && (
                  <div className="text-[10px] text-gray-600">
                    {l.batches.map((b) => `Lot ${b.lotNumber ?? "—"} : ${n(b.quantity)}${b.expiresAt ? ` (DLC ${day(b.expiresAt)})` : ""}`).join(" · ")}
                  </div>
                )}
              </td>
              <td className="py-1.5 pr-2 text-right">{n(l.quantity)}</td>
              <td className="py-1.5 pr-2 text-right">{received ? n(l.receivedQty) : <span className="inline-block w-16 border-b border-gray-400">&nbsp;</span>}</td>
              <td className="py-1.5 pr-2">{l.product.baseUnit.symbol}</td>
              <td className="py-1.5 text-right">{formatCurrency(Number(l.quantity) * Number(l.unitCost), cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-right text-[12px] font-semibold">Valeur au coût moyen : {formatCurrency(value, cur)}</p>

      {(tr.notes || tr.receptionNotes) && (
        <section className="mt-3 space-y-1 text-[11px] text-gray-700">
          {tr.notes && <p>Note d&apos;expédition : {tr.notes}</p>}
          {tr.receptionNotes && <p>Note de réception : {tr.receptionNotes}</p>}
        </section>
      )}

      <Signatures labels={["Expédié par (nom et signature)", "Transporteur", `Reçu par${tr.receivedBy ? ` ${tr.receivedBy}` : ""}`]} />
      <DocumentFooter company={tr.company} />
    </A4Page>
  );
}

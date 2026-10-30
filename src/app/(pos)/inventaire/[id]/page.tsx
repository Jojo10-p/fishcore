"use client";

import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense } from "react";
import { apiGet, errorMessage } from "@/lib/client/api";
import { A4Page, DocumentFooter, DocumentHeader, Signatures, Stamp, type DocCenter, type DocCompany } from "@/components/documents/a4-document";
import { formatCurrency } from "@/lib/utils";

interface InvLine {
  productId: string;
  theoreticalQty: string;
  countedQty: string | null;
  discrepancy: string | null;
  unitCost: string;
  discrepancyReason: string | null;
  product: { name: string; internalCode: string | null; category: { name: string } | null; baseUnit: { symbol: string } };
}
interface InvData {
  number: string;
  label: string | null;
  status: "IN_PROGRESS" | "VALIDATED" | "CANCELLED";
  createdAt: string;
  validatedAt: string | null;
  startedBy: string | null;
  validatedBy: string | null;
  center: DocCenter;
  company: DocCompany;
  summary: { lineCount: number; countedCount: number; gapValue: string; shortageValue: string; surplusValue: string };
  lines: InvLine[];
}

const n = (v: string | number | null) => (v === null ? "" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 }));
const day = (d: string) => new Date(d).toLocaleDateString("fr-FR");

function InventoryDocument({ id }: { id: string }) {
  const blank = useSearchParams().get("vierge") === "1";
  const [inv, setInv] = useState<InvData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: InvData }>(`/api/inventories/${id}`)
      .then((r) => setInv(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(() => {
    if (inv) document.title = `${blank ? "Feuille de comptage" : "Inventaire"} ${inv.number}`;
  }, [inv, blank]);

  if (error) return <p className="p-8 text-center text-sm text-red-700">{error}</p>;
  if (!inv) return <p className="p-8 text-center text-sm text-gray-500">Chargement…</p>;

  const cur = inv.company.currency;
  // Feuille de comptage : rangée par famille, sans le stock théorique (comptage à l'aveugle)
  const lines = [...inv.lines].sort(
    (a, b) => (a.product.category?.name ?? "~").localeCompare(b.product.category?.name ?? "~", "fr") || a.product.name.localeCompare(b.product.name, "fr")
  );
  const shown = blank ? lines : lines.filter((l) => l.countedQty !== null);

  return (
    <A4Page>
      <DocumentHeader
        company={inv.company}
        center={inv.center}
        title={blank ? "FEUILLE DE COMPTAGE" : "INVENTAIRE"}
        number={inv.number}
        meta={[
          ["Ouvert le", day(inv.createdAt)],
          ...(inv.validatedAt ? ([["Validé le", day(inv.validatedAt)]] as Array<[string, string]>) : []),
          ...(inv.label ? ([["Libellé", inv.label]] as Array<[string, string]>) : []),
        ]}
      />
      {inv.status === "CANCELLED" && <Stamp text="ABANDONNÉ" tone="red" />}
      {inv.status === "IN_PROGRESS" && !blank && <Stamp text="PROVISOIRE" tone="gray" />}

      <table className="mt-5 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b-2 border-gray-900 text-left">
            <th className="py-1.5 pr-2">Réf.</th>
            <th className="py-1.5 pr-2">Désignation</th>
            <th className="py-1.5 pr-2">Unité</th>
            {!blank && <th className="py-1.5 pr-2 text-right">Théorique</th>}
            <th className="py-1.5 pr-2 text-right">Compté</th>
            {!blank && <th className="py-1.5 pr-2 text-right">Écart</th>}
            {!blank && <th className="py-1.5 text-right">Valeur</th>}
            {blank && <th className="py-1.5 pl-2">Observations</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((l, i) => {
            const prevCat = i > 0 ? shown[i - 1].product.category?.name : undefined;
            const cat = l.product.category?.name ?? "Sans famille";
            const gap = l.discrepancy === null ? 0 : Number(l.discrepancy);
            return (
              <Fragment key={l.productId}>
                {(i === 0 || prevCat !== l.product.category?.name) && (
                  <tr className="[break-inside:avoid]">
                    <td colSpan={7} className="pt-3 pb-1 font-semibold uppercase tracking-wide text-gray-600">
                      {cat}
                    </td>
                  </tr>
                )}
                <tr className="border-b border-gray-200 [break-inside:avoid]">
                  <td className="py-1.5 pr-2 font-mono">{l.product.internalCode ?? ""}</td>
                  <td className="py-1.5 pr-2">{l.product.name}</td>
                  <td className="py-1.5 pr-2">{l.product.baseUnit.symbol}</td>
                  {!blank && <td className="py-1.5 pr-2 text-right">{n(l.theoreticalQty)}</td>}
                  <td className="py-1.5 pr-2 text-right">{blank ? <span className="inline-block w-20 border-b border-gray-400">&nbsp;</span> : n(l.countedQty)}</td>
                  {!blank && <td className={`py-1.5 pr-2 text-right ${gap < 0 ? "text-red-700" : ""}`}>{gap ? `${gap > 0 ? "+" : ""}${n(gap)}` : ""}</td>}
                  {!blank && <td className="py-1.5 text-right">{gap ? formatCurrency(gap * Number(l.unitCost), cur) : ""}</td>}
                  {blank && <td className="py-1.5 pl-2"><span className="inline-block w-40 border-b border-gray-300">&nbsp;</span></td>}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {!blank && (
        <section className="mt-4 ml-auto w-[55%] space-y-1 text-[12px] [break-inside:avoid]">
          <div className="flex justify-between"><span>Articles comptés</span><span>{inv.summary.countedCount} / {inv.summary.lineCount}</span></div>
          <div className="flex justify-between text-red-700"><span>Manquants</span><span>{formatCurrency(Number(inv.summary.shortageValue), cur)}</span></div>
          <div className="flex justify-between"><span>Surplus</span><span>{formatCurrency(Number(inv.summary.surplusValue), cur)}</span></div>
          <div className="flex justify-between border-t border-gray-900 pt-1 font-bold"><span>Écart net (au coût moyen)</span><span>{formatCurrency(Number(inv.summary.gapValue), cur)}</span></div>
        </section>
      )}

      <Signatures labels={blank ? ["Compté par (nom et signature)", "Contrôlé par"] : [`Ouvert par ${inv.startedBy ?? ""}`, `Validé par ${inv.validatedBy ?? ""}`]} />
      <DocumentFooter company={inv.company} />
    </A4Page>
  );
}

export default function InventoryDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<p className="p-8 text-center text-sm text-gray-500">Chargement…</p>}>
      <InventoryDocument id={id} />
    </Suspense>
  );
}

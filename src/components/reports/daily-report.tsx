import { formatCurrency } from "@/lib/utils";

export interface DailyReport {
  date: string;
  company: { currency: string; tradeName: string };
  center: { name: string } | null;
  items: Array<{ productId: string; name: string; unit: string | null; quantity: number; sales: number; unitPrice: number | null; averagePrice: number; total: number }>;
  summary: {
    salesCount: number;
    articlesTotal: number;
    cartDiscounts: number;
    salesWithDiscount: number;
    netTotal: number;
    firstSale: string | null;
    lastSale: string | null;
    cancelledCount: number;
    cancelledTotal: number;
    refunds: number;
  };
  /** Résultat de la journée (gérant, direction) */
  profit?: { salesHT: number; costOfSales: number; grossProfit: number; expenses: number; netProfit: number };
  payments: Array<{ method: string; amount: number }>;
  printedBy: string;
}

const METHODS: Record<string, string> = { CASH: "Espèces", MOBILE_MONEY: "Mobile money", CARD: "Carte", TRANSFER: "Virement", MIXED: "Mixte", CREDIT: "Crédit" };
export const frDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const qty = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const hour = (d: string | null) => (d ? new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—");

/** Corps du rapport journalier (écran et impression). */
export function DailyReportBody({ r }: { r: DailyReport }) {
  const money = (n: number) => formatCurrency(n, r.company.currency);
  const s = r.summary;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["Ventes", String(s.salesCount)],
            ["Articles différents", String(new Set(r.items.map((i) => i.productId)).size)],
            ["Total encaissé", money(s.netTotal)],
            ["Heures", s.salesCount ? `${hour(s.firstSale)} → ${hour(s.lastSale)}` : "—"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-gray-200 p-2.5">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">{k}</p>
            <p className="text-base font-bold text-gray-900">{v}</p>
          </div>
        ))}
      </div>

      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-[#0b1f4b] text-left text-white print:bg-[#0b1f4b]">
            <th className="px-2 py-1.5 font-semibold">N°</th>
            <th className="px-2 py-1.5 font-semibold">Article</th>
            <th className="px-2 py-1.5 text-right font-semibold">Quantité vendue</th>
            <th className="px-2 py-1.5 text-right font-semibold">Prix unitaire</th>
            <th className="px-2 py-1.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {r.items.map((i, k) => (
            <tr key={`${i.productId}-${i.unit}`} className="border-b border-gray-200 [break-inside:avoid]">
              <td className="px-2 py-1.5 text-gray-500">{k + 1}</td>
              <td className="px-2 py-1.5">
                <span className="font-medium">{i.name}</span>
                <span className="block text-[11px] text-gray-500">
                  {i.sales} vente{i.sales > 1 ? "s" : ""}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                <strong>{qty(i.quantity)}</strong> {i.unit ?? ""}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                {i.unitPrice !== null ? money(i.unitPrice) : <span title="Plusieurs prix dans la journée">{money(i.averagePrice)} (moy.)</span>}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums whitespace-nowrap">{money(i.total)}</td>
            </tr>
          ))}
          {r.items.length === 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-6 text-center text-gray-500">
                Aucune vente ce jour-là.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between [break-inside:avoid]">
        <div className="text-[12.5px]">
          <p className="mb-1 font-semibold text-gray-900">Encaissements par moyen de paiement</p>
          {r.payments.length === 0 ? (
            <p className="text-gray-500">—</p>
          ) : (
            r.payments.map((p) => (
              <p key={p.method} className="flex justify-between gap-8">
                <span>{METHODS[p.method] ?? p.method}</span>
                <span className="tabular-nums">{money(p.amount)}</span>
              </p>
            ))
          )}
          {s.cancelledCount > 0 && (
            <p className="mt-2 text-gray-600">
              Ventes annulées : {s.cancelledCount} ({money(s.cancelledTotal)}){s.refunds > 0 ? ` · remboursé ${money(s.refunds)}` : ""}
            </p>
          )}
        </div>
        <table className="w-full text-[12.5px] sm:w-72">
          <tbody>
            <tr>
              <td className="py-0.5">Total des articles</td>
              <td className="py-0.5 text-right tabular-nums">{money(s.articlesTotal)}</td>
            </tr>
            {s.cartDiscounts > 0 && (
              <tr>
                <td className="py-0.5">
                  Réductions ({s.salesWithDiscount} vente{s.salesWithDiscount > 1 ? "s" : ""})
                </td>
                <td className="py-0.5 text-right tabular-nums">−{money(s.cartDiscounts)}</td>
              </tr>
            )}
            <tr className="border-y-2 border-[#e3a82b] bg-[#0b1f4b] font-bold text-white">
              <td className="px-2 py-1">TOTAL DE LA JOURNÉE</td>
              <td className="px-2 py-1 text-right tabular-nums">{money(s.netTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {r.profit && (
        <div className="rounded-lg border-2 border-[#0b1f4b] p-3 text-[12.5px] [break-inside:avoid]">
          <p className="mb-1.5 font-bold uppercase tracking-wide text-[#0b1f4b]">Bénéfice de la journée</p>
          <div className="space-y-0.5">
            <p className="flex justify-between gap-4">
              <span>Ventes de la journée{r.profit.salesHT !== s.netTotal ? " (hors TVA)" : ""}</span>
              <span className="tabular-nums">{money(r.profit.salesHT)}</span>
            </p>
            <p className="flex justify-between gap-4">
              <span>− Prix d&apos;achat des articles vendus</span>
              <span className="tabular-nums">{money(r.profit.costOfSales)}</span>
            </p>
            <p className="flex justify-between gap-4 border-t border-gray-300 pt-0.5 font-semibold">
              <span>= Bénéfice sur les ventes</span>
              <span className="tabular-nums">{money(r.profit.grossProfit)}</span>
            </p>
            <p className="flex justify-between gap-4">
              <span>− Dépenses de la journée</span>
              <span className="tabular-nums">{money(r.profit.expenses)}</span>
            </p>
          </div>
          <p
            className={`mt-2 flex justify-between gap-4 rounded px-2 py-1.5 text-[14px] font-black text-white ${r.profit.netProfit < 0 ? "bg-red-700" : "bg-emerald-700"}`}
          >
            <span>{r.profit.netProfit < 0 ? "PERTE DE LA JOURNÉE" : "BÉNÉFICE DE LA JOURNÉE"}</span>
            <span className="tabular-nums">{money(Math.abs(r.profit.netProfit))}</span>
          </p>
          <p className="mt-1 text-[10.5px] text-gray-500">Prix d&apos;achat : celui du stock au moment de chaque vente.</p>
        </div>
      )}
    </div>
  );
}

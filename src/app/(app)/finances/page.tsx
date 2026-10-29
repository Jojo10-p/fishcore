"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { PAYMENT_METHOD_LABELS, PeriodPicker, frDate, presetPeriod, type Period } from "@/components/app/period-picker";
import { Alert, Button, Card, EmptyState, Money, PageHeader, Qty, Select, Spinner, Table, Td } from "@/components/ui";
import { apiGet, errorMessage } from "@/lib/client/api";
import { cn, formatCurrency } from "@/lib/utils";

interface FinanceReport {
  sales: { count: number; discounts: number };
  revenueTTC: number;
  tax: number;
  revenueHT: number;
  costOfSales: number;
  grossMargin: number;
  marginRate: number;
  expenses: { total: number; byCategory: Array<{ category: string; amount: number; count: number }> };
  netResult: number;
  collections: { total: number; byMethod: Array<{ method: string; amount: number }>; refunds: number };
  cancelled: { count: number; amount: number };
  cashDiscrepancy: { total: number; sessions: number };
  payables: { total: number; overdue: number };
  byCenter: Array<{ centerId: string; name: string; count: number; revenueTTC: number; grossMargin: number }>;
  byCashier: Array<{ cashierId: string; name: string; count: number; revenueTTC: number }>;
  topProducts: Array<{ productId: string; name: string; unit: string; quantity: number; revenueTTC: number; grossMargin: number; marginRate: number }>;
  daily: Array<{ day: string; revenueTTC: number; count: number }>;
}
interface ApiData {
  from: string;
  to: string;
  current: FinanceReport;
  previous: { from: string; to: string; report: FinanceReport } | null;
}

// Rapport financier (cahier §14, §15) — chiffre d'affaires, marge, dépenses,
// encaissements, créances et dettes ; comparaison avec la période précédente.
export default function FinancesPage() {
  const { session, can, currency } = useSession();
  const [period, setPeriod] = useState<Period>(() => presetPeriod("month"));
  const [centerId, setCenterId] = useState("");
  const [compare, setCompare] = useState(true);
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (extra: Record<string, string> = {}) =>
      new URLSearchParams({ from: period.from, to: period.to, ...(centerId ? { centerId } : {}), ...(compare ? { compare: "true" } : {}), ...extra }).toString(),
    [period, centerId, compare]
  );

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await apiGet<{ data: ApiData }>(`/api/reports/finance?${query()}`);
        setData(r.data);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [query]);

  const r = data?.current;
  const p = data?.previous?.report;
  // Tous les jours de la période, y compris ceux sans vente (barre vide) :
  // sinon un seul jour d'activité occuperait tout le graphique.
  const days = useMemo(() => fillDays(period.from, period.to, r?.daily ?? []), [period.from, period.to, r?.daily]);
  const maxDay = Math.max(1, ...days.map((d) => d.revenueTTC));

  return (
    <>
      <PageHeader
        title="Finances"
        description="Chiffre d'affaires, marge, dépenses et trésorerie — le chiffre d'affaires n'est pas l'argent encaissé, ni le bénéfice."
        actions={
          can("report:export") && (
            <a href={`/api/reports/finance?${query({ format: "csv" })}`} download>
              <Button variant="secondary">Exporter (Excel / CSV)</Button>
            </a>
          )
        }
      />

      <Card className="p-3 sm:p-4 mb-6 flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="flex flex-wrap items-center gap-3">
          {(session?.centers.length ?? 0) > 1 && (
            <Select aria-label="Centre" value={centerId} onChange={(e) => setCenterId(e.target.value)} className="w-auto">
              <option value="">Tous les centres</option>
              {session?.centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            Comparer à la période précédente
          </label>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}
      {!r && !error && <Spinner />}

      {r && (
        <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
          {data?.previous && (
            <p className="text-xs text-gray-500 -mt-3">
              Comparaison : du {frDate(data.previous.from)} au {frDate(data.previous.to)}
            </p>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Chiffre d'affaires TTC" value={r.revenueTTC} prev={p?.revenueTTC} currency={currency} sub={`${r.sales.count} vente(s)`} />
            <Kpi label="Marge brute" value={r.grossMargin} prev={p?.grossMargin} currency={currency} sub={`${r.marginRate} % du CA HT`} />
            <Kpi label="Dépenses" value={r.expenses.total} prev={p?.expenses.total} currency={currency} invert />
            <Kpi label="Résultat estimé" value={r.netResult} prev={p?.netResult} currency={currency} strong />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-4 sm:p-5 lg:col-span-2">
              <h2 className="font-semibold text-gray-900 mb-1">Chiffre d&apos;affaires par jour</h2>
              {r.daily.length === 0 ? (
                <EmptyState icon="📈" title="Aucune vente sur la période" />
              ) : (
                <>
                  <div className="flex items-end gap-1 h-44 mt-3" role="img" aria-label="Chiffre d'affaires par jour">
                    {days.map((d) => (
                      <div key={d.day} className="flex-1 h-full flex flex-col justify-end group min-w-[3px]">
                        <div
                          className="rounded-t bg-blue-500 group-hover:bg-blue-700 min-h-[2px]"
                          style={{ height: `${(d.revenueTTC / maxDay) * 100}%` }}
                          title={d.count === 0 ? `${frDate(d.day)} : aucune vente` : `${frDate(d.day)} : ${formatCurrency(d.revenueTTC, currency)} (${d.count} vente(s))`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                    <span>{frDate(days[0].day)}</span>
                    <span>{frDate(days[days.length - 1].day)}</span>
                  </div>
                </>
              )}
            </Card>

            <Card className="p-4 sm:p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Du chiffre d&apos;affaires au résultat</h2>
              <dl className="space-y-1.5 text-sm">
                <Row label="CA TTC" value={r.revenueTTC} currency={currency} />
                {r.tax > 0 && <Row label="− TVA collectée" value={-r.tax} currency={currency} muted />}
                <Row label="= CA HT" value={r.revenueHT} currency={currency} />
                <Row label="− Coût des marchandises vendues" value={-r.costOfSales} currency={currency} muted />
                <Row label="= Marge brute" value={r.grossMargin} currency={currency} bold />
                <Row label="− Dépenses" value={-r.expenses.total} currency={currency} muted />
                <Row label="= Résultat estimé" value={r.netResult} currency={currency} bold />
              </dl>
              <p className="text-[11px] text-gray-500 mt-3">
                Coût de revient = prix d&apos;achat + frais d&apos;approche (transport, glace, manutention…), au coût moyen pondéré ou par lot.
              </p>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-4 sm:p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Encaissements</h2>
              <dl className="space-y-1.5 text-sm">
                {r.collections.byMethod.map((m) => (
                  <Row key={m.method} label={PAYMENT_METHOD_LABELS[m.method] ?? m.method} value={m.amount} currency={currency} />
                ))}
                <Row label="Total encaissé" value={r.collections.total} currency={currency} bold />
              </dl>
              <div className="mt-3 space-y-1 text-xs text-gray-500">
                {r.collections.refunds > 0 && (
                  <p>
                    Remboursements : <Money value={r.collections.refunds} currency={currency} /> ({r.cancelled.count} vente(s) annulée(s))
                  </p>
                )}
                {r.cashDiscrepancy.sessions > 0 && (
                  <p className={r.cashDiscrepancy.total < 0 ? "text-red-700" : ""}>
                    Écarts de caisse : <Money value={r.cashDiscrepancy.total} currency={currency} /> sur {r.cashDiscrepancy.sessions} clôture(s)
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-4 sm:p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Dépenses par catégorie</h2>
              {r.expenses.byCategory.length === 0 ? (
                <p className="text-sm text-gray-500">Aucune dépense sur la période.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {r.expenses.byCategory.map((e) => (
                    <li key={e.category}>
                      <div className="flex justify-between">
                        <span>{e.category}</span>
                        <Money value={e.amount} currency={currency} />
                      </div>
                      <div className="h-1.5 rounded bg-gray-100 mt-1">
                        <div className="h-1.5 rounded bg-amber-400" style={{ width: `${(e.amount / r.expenses.total) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-4 sm:p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Fournisseurs — à ce jour</h2>
              <dl className="space-y-2 text-sm">
                <Row label="Dettes fournisseurs" value={r.payables.total} currency={currency} />
                {r.payables.overdue > 0 && <Row label="dont échues" value={r.payables.overdue} currency={currency} danger />}
              </dl>
            </Card>
          </div>

          {r.byCenter.length > 1 && (
            <Card>
              <h2 className="font-semibold text-gray-900 px-4 sm:px-6 py-4 border-b border-gray-100">Par centre</h2>
              <Table head={["Centre", "Ventes", "CA TTC", "Marge brute"]}>
                {r.byCenter.map((c) => (
                  <tr key={c.centerId}>
                    <Td>{c.name}</Td>
                    <Td>{c.count}</Td>
                    <Td>
                      <Money value={c.revenueTTC} currency={currency} />
                    </Td>
                    <Td>
                      <Money value={c.grossMargin} currency={currency} />
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <h2 className="font-semibold text-gray-900 px-4 sm:px-6 py-4 border-b border-gray-100">Meilleurs articles</h2>
              {r.topProducts.length === 0 ? (
                <EmptyState title="Aucune vente" />
              ) : (
                <Table head={["Article", "Quantité", "CA TTC", "Marge", "Taux"]}>
                  {r.topProducts.map((t) => (
                    <tr key={t.productId}>
                      <Td className="whitespace-normal">{t.name}</Td>
                      <Td>
                        <Qty value={t.quantity} unit={t.unit} />
                      </Td>
                      <Td>
                        <Money value={t.revenueTTC} currency={currency} />
                      </Td>
                      <Td className={t.grossMargin < 0 ? "text-red-700 font-semibold" : ""}>
                        <Money value={t.grossMargin} currency={currency} />
                      </Td>
                      <Td>{t.marginRate} %</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card>
              <h2 className="font-semibold text-gray-900 px-4 sm:px-6 py-4 border-b border-gray-100">Par caissier</h2>
              <Table head={["Caissier", "Ventes", "CA TTC"]}>
                {r.byCashier.map((c) => (
                  <tr key={c.cashierId}>
                    <Td>{c.name}</Td>
                    <Td>{c.count}</Td>
                    <Td>
                      <Money value={c.revenueTTC} currency={currency} />
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, prev, currency, sub, invert, strong }: {
  label: string;
  value: number;
  prev?: number;
  currency: string;
  sub?: string;
  invert?: boolean;
  strong?: boolean;
}) {
  const delta = prev !== undefined && prev !== 0 ? Math.round(((value - prev) / Math.abs(prev)) * 100) : null;
  const good = delta === null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <Card className={cn("p-4", strong && (value >= 0 ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"))}>
      <p className="text-xs sm:text-sm text-gray-500">{label}</p>
      <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-1">
        <Money value={value} currency={currency} />
      </p>
      <div className="flex flex-wrap items-center gap-x-2 text-xs mt-1">
        {sub && <span className="text-gray-500">{sub}</span>}
        {delta !== null && (
          <span className={good ? "text-green-700" : "text-red-700"}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} %
          </span>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value, currency, bold, muted, danger }: { label: string; value: number; currency: string; bold?: boolean; muted?: boolean; danger?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", bold && "font-semibold border-t border-gray-100 pt-1.5", muted && "text-gray-500", danger && "text-red-700")}>
      <dt>{label}</dt>
      <dd className="tabular-nums whitespace-nowrap">
        <Money value={value} currency={currency} />
      </dd>
    </div>
  );
}

/** Complète la série jour par jour entre deux dates AAAA-MM-JJ (au plus 366 jours). */
function fillDays(from: string, to: string, daily: Array<{ day: string; revenueTTC: number; count: number }>) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out: Array<{ day: string; revenueTTC: number; count: number }> = [];
  const cur = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cur <= end && out.length < 366) {
    const day = cur.toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, revenueTTC: 0, count: 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out.length ? out : daily;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { PeriodPicker, frDate, presetPeriod, type Period } from "@/components/app/period-picker";
import { Alert, Button, Card, EmptyState, Money, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { apiGet, errorMessage } from "@/lib/client/api";

interface Line {
  account: string;
  debit: number;
  credit: number;
}
interface Entry {
  date: string;
  journal: "VE" | "AC" | "TR" | "OD";
  piece: string;
  label: string;
  lines: Line[];
}
interface Data {
  from: string;
  to: string;
  company: { name: string; vatEnabled: boolean; ifu: string | null };
  entries: Entry[];
  balance: Array<{ account: string; name: string; debit: number; credit: number; solde: number }>;
  totals: { debit: number; credit: number };
  treasury: Array<{ account: string; name: string; entrees: number; sorties: number; variation: number }>;
  result: {
    ventesHT: number;
    tvaCollectee: number;
    coutMarchandisesVendues: number;
    margeCommerciale: number;
    tauxMarge: number;
    charges: Array<{ account: string; name: string; amount: number }>;
    manquantsCaisse: number;
    excedentsCaisse: number;
    totalCharges: number;
    resultatNet: number;
    achatsPeriode: number;
    fraisSurAchats: number;
  };
  situation: {
    stockValue: number;
    stockItems: number;
    supplierDebt: number;
    supplierDebtOverdue: number;
    suppliers: Array<{ name: string; left: number; overdue: number }>;
  };
}

const JOURNALS: Record<Entry["journal"], string> = { VE: "Ventes", AC: "Achats", TR: "Trésorerie", OD: "Opérations diverses" };
type Tab = "resultat" | "journal" | "balance" | "tresorerie" | "situation";
const TABS: Array<[Tab, string]> = [
  ["resultat", "📊 Compte de résultat"],
  ["journal", "📒 Journal"],
  ["balance", "⚖️ Balance"],
  ["tresorerie", "💵 Trésorerie"],
  ["situation", "🏦 Situation"],
];

// Comptabilité de l'entreprise (direction) : ce que ferait un comptable, à partir
// des ventes, arrivages, règlements, dépenses et caisses déjà enregistrés.
export default function AccountingPage() {
  const { session, currency } = useSession();
  const owner = session?.user.role === "COMPANY_OWNER";
  const [period, setPeriod] = useState<Period>(() => presetPeriod("month"));
  const [centerId, setCenterId] = useState("");
  const [tab, setTab] = useState<Tab>("resultat");
  const [journal, setJournal] = useState<"" | Entry["journal"]>("");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useMemo(() => new URLSearchParams({ from: period.from, to: period.to, ...(centerId ? { centerId } : {}) }).toString(), [period, centerId]);

  useEffect(() => {
    if (!owner) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await apiGet<{ data: Data }>(`/api/reports/accounting?${query}`);
        setData(r.data);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [query, owner]);

  if (session && !owner) return <Alert tone="amber">La comptabilité est réservée à la direction.</Alert>;
  const m = (v: number) => <Money value={v} currency={currency} />;
  const entries = (data?.entries ?? []).filter((e) => !journal || e.journal === journal);
  const res = data?.result;

  return (
    <>
      <PageHeader
        title="Comptabilité"
        description="Journal, balance, compte de résultat et trésorerie, tenus automatiquement. Plan comptable SYSCOHADA simplifié, à faire valider par votre comptable."
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>
              🖨️ Imprimer / PDF
            </Button>
            <a href={`/api/reports/accounting?${query}&format=csv`} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              ⬇️ Excel (pour le comptable)
            </a>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <PeriodPicker value={period} onChange={setPeriod} />
        {(session?.centers.length ?? 0) > 1 && (
          <Select aria-label="Boutique" value={centerId} onChange={(e) => setCenterId(e.target.value)} className="w-auto">
            <option value="">Toutes les boutiques</option>
            {session?.centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <p className="mb-3 hidden text-sm print:block">
        {data?.company.name} — du {frDate(period.from)} au {frDate(period.to)}
      </p>
      <div className="mb-4 flex gap-1 overflow-x-auto print:hidden">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold ${tab === k ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {!data || loading ? (
        <Spinner />
      ) : tab === "resultat" && res ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="font-semibold text-gray-900">Compte de résultat</h2>
            <p className="text-xs text-gray-500">
              du {frDate(data.from)} au {frDate(data.to)}
            </p>
            <table className="mt-3 w-full text-sm">
              <tbody>
                <Row label="Ventes de marchandises (HT)" value={m(res.ventesHT)} strong />
                <Row label="− Coût d'achat des marchandises vendues" value={m(-res.coutMarchandisesVendues)} />
                <Row label={`= Marge commerciale (${res.tauxMarge.toLocaleString("fr-FR")} %)`} value={m(res.margeCommerciale)} strong tone={res.margeCommerciale >= 0 ? "green" : "red"} />
                {res.charges.map((c) => (
                  <Row key={c.account} label={`− ${c.name} (${c.account})`} value={m(-c.amount)} />
                ))}
                {res.manquantsCaisse > 0 && <Row label="− Manquants de caisse (6581)" value={m(-res.manquantsCaisse)} />}
                {res.excedentsCaisse > 0 && <Row label="+ Excédents de caisse (7581)" value={m(res.excedentsCaisse)} />}
                <tr className="border-t-2 border-gray-900">
                  <td className="py-2 font-bold">Résultat net (avant impôt)</td>
                  <td className={`py-2 text-right text-lg font-bold ${res.resultatNet >= 0 ? "text-green-700" : "text-red-700"}`}>{m(res.resultatNet)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-gray-500">{res.resultatNet >= 0 ? "Bénéfice" : "Perte"} de la période, avant impôt sur les bénéfices.</p>
          </Card>
          <div className="space-y-4">
            <Card className="p-4 text-sm">
              <h2 className="font-semibold text-gray-900">Achats de la période</h2>
              <p className="mt-2">
                Marchandises achetées : <strong>{m(res.achatsPeriode)}</strong>
              </p>
              <p>
                Frais sur achats (transport, manutention) : <strong>{m(res.fraisSurAchats)}</strong>
              </p>
              <p className="mt-1 text-xs text-gray-500">La marge se calcule sur ce qui a été vendu (coût d&apos;achat des marchandises vendues), pas sur tout ce qui a été acheté.</p>
            </Card>
            <Card className="p-4 text-sm">
              <h2 className="font-semibold text-gray-900">Taxes</h2>
              {data.company.vatEnabled ? (
                <p className="mt-2">
                  TVA collectée sur les ventes (compte 4431) : <strong>{m(res.tvaCollectee)}</strong>
                </p>
              ) : (
                <p className="mt-2 text-gray-600">Entreprise non assujettie à la TVA (régime TPS) : pas de TVA facturée.</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Montants à déclarer : voyez-les avec votre comptable. L&apos;espace e-MECeF les reprendra quand la facture normalisée sera activée.
              </p>
            </Card>
          </div>
        </div>
      ) : tab === "journal" ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-3 print:hidden">
            <Select aria-label="Journal" value={journal} onChange={(e) => setJournal(e.target.value as typeof journal)} className="w-auto">
              <option value="">Tous les journaux</option>
              {Object.entries(JOURNALS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <p className="text-xs text-gray-500">{entries.length} écriture(s) · les ventes sont regroupées par jour</p>
          </div>
          {entries.length === 0 ? (
            <EmptyState icon="📒" title="Aucune écriture sur la période" />
          ) : (
            <Table head={["Date", "Jnl", "Pièce", "Compte", "Libellé", "Débit", "Crédit"]}>
              {entries.flatMap((e, i) =>
                e.lines.map((l, j) => (
                  <tr key={`${i}-${j}`} className={j === 0 ? "border-t-2 border-gray-200" : ""}>
                    <Td className="whitespace-nowrap">{j === 0 ? frDate(e.date) : ""}</Td>
                    <Td>{j === 0 ? e.journal : ""}</Td>
                    <Td className="text-xs text-gray-500">{j === 0 ? e.piece : ""}</Td>
                    <Td className="whitespace-nowrap">
                      <span className="font-mono">{l.account}</span> <span className="text-xs text-gray-500">{data.balance.find((b) => b.account === l.account)?.name}</span>
                    </Td>
                    <Td className="max-w-xs whitespace-normal text-xs">{j === 0 ? e.label : ""}</Td>
                    <Td className="text-right tabular-nums">{l.debit ? l.debit.toLocaleString("fr-FR") : ""}</Td>
                    <Td className="text-right tabular-nums">{l.credit ? l.credit.toLocaleString("fr-FR") : ""}</Td>
                  </tr>
                ))
              )}
            </Table>
          )}
        </Card>
      ) : tab === "balance" ? (
        <Card>
          <Table head={["Compte", "Intitulé", "Débit", "Crédit", "Solde"]}>
            {data.balance.map((b) => (
              <tr key={b.account}>
                <Td className="font-mono">{b.account}</Td>
                <Td>{b.name}</Td>
                <Td className="text-right tabular-nums">{b.debit.toLocaleString("fr-FR")}</Td>
                <Td className="text-right tabular-nums">{b.credit.toLocaleString("fr-FR")}</Td>
                <Td className={`text-right font-semibold tabular-nums ${b.solde < 0 ? "text-red-700" : ""}`}>
                  {Math.abs(b.solde).toLocaleString("fr-FR")} {b.solde > 0 ? "D" : b.solde < 0 ? "C" : ""}
                </Td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-900 font-bold">
              <Td>{""}</Td>
              <Td>Total</Td>
              <Td className="text-right tabular-nums">{data.totals.debit.toLocaleString("fr-FR")}</Td>
              <Td className="text-right tabular-nums">{data.totals.credit.toLocaleString("fr-FR")}</Td>
              <Td className="text-right">{data.totals.debit === data.totals.credit ? "✅ équilibrée" : "⚠️"}</Td>
            </tr>
          </Table>
        </Card>
      ) : tab === "tresorerie" ? (
        <Card>
          {data.treasury.length === 0 ? (
            <EmptyState icon="💵" title="Aucun mouvement d'argent sur la période" />
          ) : (
            <Table head={["Compte", "Entrées", "Sorties", "Variation"]}>
              {data.treasury.map((t) => (
                <tr key={t.account}>
                  <Td>
                    <span className="font-mono">{t.account}</span> {t.name}
                  </Td>
                  <Td className="text-right text-green-700">{m(t.entrees)}</Td>
                  <Td className="text-right text-red-700">{m(t.sorties)}</Td>
                  <Td className={`text-right font-semibold ${t.variation < 0 ? "text-red-700" : "text-green-700"}`}>{m(t.variation)}</Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="p-3 text-xs text-gray-500">Argent entré et sorti pendant la période, par caisse, mobile money et banque.</p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-2 p-4 text-sm">
            <h2 className="font-semibold text-gray-900">Situation à ce jour</h2>
            <p>
              Valeur du stock (au coût d&apos;achat) : <strong>{m(data.situation.stockValue)}</strong>{" "}
              <span className="text-gray-500">({data.situation.stockItems} articles)</span>
            </p>
            <p>
              Dettes fournisseurs : <strong>{m(data.situation.supplierDebt)}</strong>
              {data.situation.supplierDebtOverdue > 0 && <span className="text-red-700"> dont {m(data.situation.supplierDebtOverdue)} en retard</span>}
            </p>
          </Card>
          <Card>
            {data.situation.suppliers.length === 0 ? (
              <EmptyState icon="✅" title="Aucune dette fournisseur" />
            ) : (
              <Table head={["Fournisseur", "Reste à payer", "En retard"]}>
                {data.situation.suppliers.map((s) => (
                  <tr key={s.name}>
                    <Td>{s.name}</Td>
                    <Td className="text-right font-semibold">{m(s.left)}</Td>
                    <Td className="text-right text-red-700">{s.overdue ? m(s.overdue) : "—"}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: React.ReactNode; strong?: boolean; tone?: "green" | "red" }) {
  return (
    <tr className="border-b border-gray-100">
      <td className={`py-1.5 ${strong ? "font-semibold" : "text-gray-700"}`}>{label}</td>
      <td className={`py-1.5 text-right tabular-nums ${strong ? "font-semibold" : ""} ${tone === "green" ? "text-green-700" : tone === "red" ? "text-red-700" : ""}`}>{value}</td>
    </tr>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Card, PageHeader, Spinner } from "@/components/ui";
import { day, fcfa, StatusBadge, type SubStatus } from "@/components/platform/shell";
import { apiGet, errorMessage } from "@/lib/client/api";

interface Row {
  id: string;
  tradeName: string;
  ownerName: string;
  phone: string;
  status: SubStatus;
  accessEndsAt: string | null;
  daysLeft: number | null;
  plan: { name: string };
}
interface Overview {
  total: number;
  byStatus: Partial<Record<SubStatus, number>>;
  mrr: number;
  paidThisMonth: { amount: number; count: number };
  signups30d: number;
  expiringSoon: Row[];
  graceOrExpired: Row[];
}

export default function PlatformHome() {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ data: Overview }>("/api/platform/overview")
      .then((r) => setO(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!o) return <Spinner />;
  const s = o.byStatus;
  return (
    <>
      <PageHeader title="Vue d'ensemble" description="Vos entreprises clientes, leurs abonnements et vos encaissements." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Entreprises" value={String(o.total)} hint={`${o.signups30d} inscription(s) sur 30 jours`} />
        <Kpi label="Abonnés payants" value={String(s.ACTIVE ?? 0)} hint={`${s.TRIAL ?? 0} en essai`} />
        <Kpi label="Revenu mensuel récurrent" value={fcfa(o.mrr)} hint="Prix mensuel des abonnements en cours" />
        <Kpi label="Encaissé ce mois-ci" value={fcfa(o.paidThisMonth.amount)} hint={`${o.paidThisMonth.count} paiement(s)`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-semibold text-gray-900">Échéance dans les 7 jours</h2>
          <p className="text-xs text-gray-500">À relancer avant la fin de l&apos;essai ou de l&apos;abonnement.</p>
          <List rows={o.expiringSoon} empty="Aucune échéance proche." />
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold text-gray-900">Échues</h2>
          <p className="text-xs text-gray-500">Délai de grâce en cours ou consultation seule.</p>
          <List rows={o.graceOrExpired} empty="Aucun compte échu." />
        </Card>
      </div>
      {(s.SUSPENDED ?? 0) > 0 && <p className="mt-4 text-sm text-gray-500">{s.SUSPENDED} compte(s) suspendu(s).</p>}
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function List({ rows, empty }: { rows: Row[]; empty: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-gray-500">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-gray-100">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/plateforme/entreprises/${r.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-gray-50">
            <span className="min-w-0">
              <span className="block truncate font-medium text-gray-900">{r.tradeName}</span>
              <span className="block text-xs text-gray-500">
                {r.ownerName} · {r.phone}
              </span>
            </span>
            <span className="shrink-0 text-right text-xs">
              <StatusBadge status={r.status} />
              <span className="mt-0.5 block text-gray-500">
                {r.plan.name} · {day(r.accessEndsAt)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

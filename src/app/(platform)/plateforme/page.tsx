"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Card, PageHeader, Spinner } from "@/components/ui";
import { day, fcfa, metier } from "@/components/platform/shell";
import { apiGet, errorMessage } from "@/lib/client/api";
import { deletionReasonLabel } from "@/lib/deletion-reasons";

interface Overview {
  companies: number;
  suspended: number;
  withSeveralCenters: number;
  centers: number;
  users: number;
  products: number;
  sales30d: { count: number; amount: number };
  activeLast7d: number;
  inactive: number;
  signups30d: number;
  signupsByMonth: Array<{ month: string; count: number }>;
  byBusinessType: Record<string, number>;
  recentSignups: Array<{
    id: string;
    tradeName: string;
    ownerName: string;
    city: string | null;
    businessType: string;
    createdAt: string;
    centers: number;
  }>;
  deletions: {
    total: number;
    last30d: number;
    recent: Array<{
      id: string;
      tradeName: string;
      deletedAt: string;
      reasons: string[];
      otherReason: string | null;
    }>;
  };
}

const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

export default function ConsoleHome() {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ data: Overview }>("/api/platform/overview")
      .then((r) => setO(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!o) return <Spinner />;
  const maxMonth = Math.max(1, ...o.signupsByMonth.map((m) => m.count));
  const types = Object.entries(o.byBusinessType).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Vue d'ensemble"
        description="Tout ce qui se passe sur la plateforme : entreprises inscrites, filiales, utilisateurs, activité."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Entreprises inscrites"
          value={o.companies}
          hint={`${o.signups30d} nouvelle(s) sur 30 jours`}
          href="/plateforme/clients"
        />
        <Kpi
          label="Filiales (centres)"
          value={o.centers}
          hint={`${o.withSeveralCenters} entreprise(s) à plusieurs centres`}
          href="/plateforme/clients?state=multi"
        />
        <Kpi
          label="Utilisateurs"
          value={o.users}
          hint={`${o.products.toLocaleString("fr-FR")} articles au total`}
        />
        <Kpi
          label="Ventes (30 jours)"
          value={o.sales30d.count}
          hint={fcfa(o.sales30d.amount)}
        />
        <Kpi
          label="Actives cette semaine"
          value={o.activeLast7d}
          hint="au moins une vente en 7 jours"
          href="/plateforme/clients?state=active"
        />
        <Kpi
          label="Inactives"
          value={o.inactive}
          hint="ni vente ni connexion depuis 14 jours"
          tone={o.inactive > 0 ? "amber" : undefined}
          href="/plateforme/clients?state=inactive"
        />
        <Kpi
          label="Suspendues"
          value={o.suspended}
          href="/plateforme/clients?state=suspended"
        />
        <Kpi
          label="Comptes supprimés"
          value={o.deletions.total}
          hint={`${o.deletions.last30d} sur 30 jours`}
          href="/plateforme/departs"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <h2 className="font-semibold text-gray-900">Inscriptions par mois</h2>
          <div className="mt-4 flex h-40 items-end gap-2">
            {o.signupsByMonth.map((m) => (
              <div
                key={m.month}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <span className="text-xs font-medium text-gray-700">
                  {m.count || ""}
                </span>
                <div
                  className="w-full rounded-t bg-blue-500"
                  style={{
                    height: `${(m.count / maxMonth) * 100}%`,
                    minHeight: m.count ? 4 : 1,
                    opacity: m.count ? 1 : 0.15,
                  }}
                />
                <span className="text-[10px] text-gray-500">
                  {MONTHS[Number(m.month.slice(5)) - 1]}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold text-gray-900">Par métier</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {types.length === 0 && (
              <li className="text-gray-500">Aucune entreprise.</li>
            )}
            {types.map(([t, n]) => (
              <li key={t}>
                <Link
                  href={`/plateforme/clients?type=${t}`}
                  className="flex items-center gap-2 hover:underline"
                >
                  <span className="flex-1 truncate">{metier(t)}</span>
                  <span className="font-semibold">{n}</span>
                </Link>
                <div className="mt-1 h-1.5 rounded bg-gray-100">
                  <div
                    className="h-1.5 rounded bg-blue-500"
                    style={{
                      width: `${(n / Math.max(1, o.companies)) * 100}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-semibold text-gray-900">
            Dernières inscriptions
          </h2>
          <ul className="mt-2 divide-y divide-gray-100">
            {o.recentSignups.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/plateforme/entreprises/${c.id}`}
                  className="flex justify-between gap-3 py-2 text-sm hover:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-900">
                      {c.tradeName}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {c.ownerName} · {metier(c.businessType)}
                      {c.city ? ` · ${c.city}` : ""} · {c.centers} centre(s)
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {day(c.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
            {o.recentSignups.length === 0 && (
              <li className="py-6 text-center text-sm text-gray-500">
                Aucune inscription.
              </li>
            )}
          </ul>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Derniers départs</h2>
            <Link
              href="/plateforme/departs"
              className="text-sm text-blue-600 hover:underline"
            >
              Tout voir
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-gray-100">
            {o.deletions.recent.map((d) => (
              <li key={d.id} className="py-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-medium text-gray-900">
                    {d.tradeName}
                  </span>
                  <span className="text-xs text-gray-500">
                    {day(d.deletedAt)}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  {d.reasons
                    .filter((r) => r !== "other")
                    .map(deletionReasonLabel)
                    .join(" · ")}
                  {d.otherReason
                    ? `${d.reasons.length > 1 ? " · " : ""}« ${d.otherReason} »`
                    : ""}
                </p>
              </li>
            ))}
            {o.deletions.recent.length === 0 && (
              <li className="py-6 text-center text-sm text-gray-500">
                Aucun compte supprimé.
              </li>
            )}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "amber";
  href?: string;
}) {
  const body = (
    <div
      className={`h-full rounded-xl border bg-white p-4 ${href ? "hover:border-blue-300" : ""} ${tone === "amber" ? "border-amber-200" : "border-gray-200"}`}
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${tone === "amber" ? "text-amber-700" : "text-gray-900"}`}
      >
        {value.toLocaleString("fr-FR")}
      </p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

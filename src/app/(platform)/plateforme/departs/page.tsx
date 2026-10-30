"use client";

import { useEffect, useState } from "react";
import { Alert, Card, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { day, fcfa, metier } from "@/components/platform/shell";
import { apiGet, errorMessage } from "@/lib/client/api";
import { DELETION_REASONS, deletionReasonLabel } from "@/lib/deletion-reasons";

interface Deletion {
  id: string;
  deletedAt: string;
  tradeName: string;
  ownerName: string;
  email: string;
  phone: string;
  city: string | null;
  businessType: string;
  companyCreatedAt: string;
  reasons: string[];
  otherReason: string | null;
  centersCount: number;
  usersCount: number;
  productsCount: number;
  salesCount: number;
  salesTotal: string | number;
  lastSaleAt: string | null;
}

const lifetime = (from: string, to: string) => {
  const d = Math.max(
    0,
    Math.round(
      (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000,
    ),
  );
  return d < 1
    ? "moins d'un jour"
    : d < 60
      ? `${d} jour(s)`
      : `${Math.round(d / 30)} mois`;
};

export default function PlatformDepartures() {
  const [data, setData] = useState<{
    rows: Deletion[];
    byReason: Record<string, number>;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{
      data: {
        rows: Deletion[];
        byReason: Record<string, number>;
        total: number;
      };
    }>("/api/platform/deletions")
      .then((r) => setData(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Spinner />;
  const max = Math.max(1, ...Object.values(data.byReason));

  return (
    <>
      <PageHeader
        title="Départs"
        description="Les comptes supprimés par leurs propriétaires, et pourquoi ils sont partis. Leurs données ont été effacées ; seul ce résumé est gardé."
      />
      {data.total === 0 ? (
        <Card>
          <EmptyState icon="👋" title="Aucun compte supprimé pour l'instant" />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="h-fit p-4">
            <h2 className="font-semibold text-gray-900">
              Raisons les plus citées
            </h2>
            <p className="text-xs text-gray-500">
              {data.total} départ(s) · plusieurs raisons possibles par départ
            </p>
            <ul className="mt-3 space-y-2.5 text-sm">
              {DELETION_REASONS.filter((r) => data.byReason[r.code])
                .sort(
                  (a, b) =>
                    (data.byReason[b.code] ?? 0) - (data.byReason[a.code] ?? 0),
                )
                .map((r) => (
                  <li key={r.code}>
                    <div className="flex justify-between gap-2">
                      <span>{r.label}</span>
                      <span className="font-semibold">
                        {data.byReason[r.code]}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-gray-100">
                      <div
                        className="h-1.5 rounded bg-red-400"
                        style={{
                          width: `${(data.byReason[r.code] / max) * 100}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
          <div className="space-y-3 lg:col-span-2">
            {data.rows.map((d) => (
              <Card key={d.id} className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-gray-900">{d.tradeName}</h3>
                  <span className="text-xs text-gray-500">
                    supprimé le{" "}
                    {new Date(d.deletedAt).toLocaleString("fr-FR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  {d.ownerName} · {d.phone} · {d.email}
                  {d.city ? ` · ${d.city}` : ""} · {metier(d.businessType)}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {d.reasons
                    .filter((r) => r !== "other")
                    .map((r) => (
                      <span
                        key={r}
                        className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700"
                      >
                        {deletionReasonLabel(r)}
                      </span>
                    ))}
                </div>
                {d.otherReason && (
                  <blockquote className="mt-2 border-l-4 border-gray-300 pl-3 text-sm italic text-gray-700">
                    « {d.otherReason} »
                  </blockquote>
                )}
                <p className="mt-3 text-xs text-gray-500">
                  Client pendant {lifetime(d.companyCreatedAt, d.deletedAt)}{" "}
                  (inscrit le {day(d.companyCreatedAt)}) · {d.centersCount}{" "}
                  centre(s) · {d.usersCount} utilisateur(s) · {d.productsCount}{" "}
                  article(s) · {d.salesCount} vente(s) pour{" "}
                  {fcfa(Number(d.salesTotal))}
                  {d.lastSaleAt
                    ? ` · dernière vente le ${day(d.lastSaleAt)}`
                    : ""}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import {
  ago,
  day,
  fcfa,
  metier,
  StateBadge,
} from "@/components/platform/shell";
import { apiGet, errorMessage } from "@/lib/client/api";
import { BUSINESS_PROFILES } from "@/lib/business-profiles";

interface Row {
  id: string;
  tradeName: string;
  ownerName: string;
  email: string;
  phone: string;
  city: string | null;
  businessType: string;
  createdAt: string;
  isActive: boolean;
  inactive: boolean;
  _count: { centers: number; users: number; products: number };
  activity: {
    sales30d: number;
    revenue30d: number;
    lastActivityAt: string | null;
  };
}

const STATES = [
  { value: "", label: "Toutes" },
  { value: "active", label: "Actives" },
  { value: "inactive", label: "Inactives (14 j sans activité)" },
  { value: "suspended", label: "Suspendues" },
  { value: "multi", label: "Avec plusieurs centres" },
];

export default function PlatformCompanies() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [state, setState] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Filtres repris de l'adresse (liens depuis la vue d'ensemble)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = setTimeout(() => {
      setType(sp.get("type") ?? "");
      setState(sp.get("state") ?? "");
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (state) p.set("state", state);
    if (type) p.set("type", type);
    return p;
  }, [q, state, type]);

  useEffect(() => {
    if (state === null) return;
    const t = setTimeout(
      async () => {
        try {
          const r = await apiGet<{ data: Row[] }>(
            `/api/platform/companies?${params()}`,
          );
          setRows(r.data);
          setError(null);
        } catch (e) {
          setError(errorMessage(e));
        }
      },
      q ? 300 : 0,
    );
    return () => clearTimeout(t);
  }, [params, q, state]);

  const exportCsv = () => {
    const p = params();
    p.set("format", "csv");
    const a = document.createElement("a");
    a.href = `/api/platform/companies?${p}`;
    a.download = "";
    a.click();
  };

  return (
    <>
      <PageHeader
        title="Entreprises"
        description="Toutes les entreprises inscrites, leurs centres (filiales), leurs utilisateurs et leur activité."
        actions={
          <Button
            variant="secondary"
            onClick={exportCsv}
            disabled={!rows?.length}
          >
            ⬇ Exporter (Excel)
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <Input
            placeholder="Nom, propriétaire, e-mail, téléphone, ville, IFU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            value={state ?? ""}
            onChange={(e) => setState(e.target.value)}
            aria-label="État"
            className="md:w-64"
          >
            {STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Métier"
            className="md:w-56"
          >
            <option value="">Tous les métiers</option>
            {Object.entries(BUSINESS_PROFILES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
      </Card>
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState icon="🏪" title="Aucune entreprise" />
        ) : (
          <>
            <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
              {rows.length} entreprise(s)
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 font-medium">Entreprise</th>
                    <th className="px-4 py-3 font-medium">Métier</th>
                    <th className="px-4 py-3 text-center font-medium">
                      Centres
                    </th>
                    <th className="px-4 py-3 text-center font-medium">
                      Utilisateurs
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Ventes 30 j
                    </th>
                    <th className="px-4 py-3 font-medium">Dernière activité</th>
                    <th className="px-4 py-3 font-medium">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() =>
                        router.push(`/plateforme/entreprises/${r.id}`)
                      }
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">
                          {r.tradeName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {r.ownerName} · {r.phone}
                          {r.city ? ` · ${r.city}` : ""} · inscrite le{" "}
                          {day(r.createdAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {metier(r.businessType)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={
                            r._count.centers > 1
                              ? "rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700"
                              : ""
                          }
                        >
                          {r._count.centers}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r._count.users}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="font-medium">{r.activity.sales30d}</p>
                        <p className="text-xs text-gray-500">
                          {fcfa(r.activity.revenue30d)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {ago(r.activity.lastActivityAt)}
                      </td>
                      <td className="px-4 py-3">
                        <StateBadge
                          isActive={r.isActive}
                          inactive={r.inactive}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

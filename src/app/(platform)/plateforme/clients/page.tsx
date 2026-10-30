"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, Card, EmptyState, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { day, fcfa, StatusBadge, STATUS_UI, type SubStatus } from "@/components/platform/shell";
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
  status: SubStatus;
  accessEndsAt: string | null;
  daysLeft: number | null;
  plan: { name: string; monthlyPrice: number };
  _count: { centers: number; users: number };
  activity: { sales30d: number; revenue30d: number; lastSaleAt: string | null; lastLoginAt: string | null };
}

export default function PlatformClients() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status", status);
      const r = await apiGet<{ data: Row[] }>(`/api/platform/companies?${p}`);
      setRows(r.data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q, status]);
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <>
      <PageHeader title="Clients" description="Toutes les entreprises inscrites, leur abonnement et leur activité." />
      {error && <Alert>{error}</Alert>}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input placeholder="Nom, patron, e-mail, téléphone, IFU…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut" className="sm:w-56">
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_UI).map(([k, v]) => (
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
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Entreprise</th>
                  <th className="px-4 py-3 font-medium">Abonnement</th>
                  <th className="px-4 py-3 font-medium">Échéance</th>
                  <th className="px-4 py-3 font-medium text-right">Ventes 30 j</th>
                  <th className="px-4 py-3 font-medium">Dernière activité</th>
                  <th className="px-4 py-3 font-medium">Inscrite le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/plateforme/entreprises/${r.id}`)}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{r.tradeName}</p>
                      <p className="text-xs text-gray-500">
                        {r.ownerName} · {r.phone} · {BUSINESS_PROFILES[r.businessType as keyof typeof BUSINESS_PROFILES]?.label ?? r.businessType}
                        {r.city ? ` · ${r.city}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusBadge status={r.status} />
                      <span className="ml-1.5 text-xs text-gray-500">
                        {r.plan.name} · {r._count.centers} centre(s), {r._count.users} util.
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 whitespace-nowrap ${r.daysLeft !== null && r.daysLeft <= 7 ? "font-semibold text-amber-700" : ""}`}>
                      {day(r.accessEndsAt)}
                      {r.daysLeft !== null && <span className="block text-xs font-normal text-gray-500">{r.daysLeft >= 0 ? `dans ${r.daysLeft} j` : `il y a ${-r.daysLeft} j`}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {r.activity.sales30d}
                      <span className="block text-xs text-gray-500">{fcfa(r.activity.revenue30d)}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                      {day(r.activity.lastSaleAt ?? r.activity.lastLoginAt)}
                      <span className="block text-xs text-gray-500">{r.activity.lastSaleAt ? "dernière vente" : r.activity.lastLoginAt ? "dernière connexion" : "jamais utilisée"}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{day(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

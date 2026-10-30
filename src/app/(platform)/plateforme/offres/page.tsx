"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, PageHeader, Spinner } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface Plan {
  code: string;
  name: string;
  monthlyPrice: number;
  maxCenters: number | null;
  maxUsers: number | null;
  description: string | null;
  isActive: boolean;
  _count: { companies: number };
}

export default function PlatformPlans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    apiGet<{ data: Plan[] }>("/api/platform/plans")
      .then((r) => setPlans(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const set = (code: string, patch: Partial<Plan>) => setPlans((ps) => ps?.map((p) => (p.code === code ? { ...p, ...patch } : p)) ?? null);
  const nul = (v: string) => (v.trim() === "" ? null : Math.max(1, Number(v) || 1));

  const save = async () => {
    if (!plans) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const r = await apiSend<{ data: Plan[] }>("/api/platform/plans", { plans }, "PUT");
      setPlans(r.data);
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Offres & prix"
        description="Prix mensuels et limites de chaque offre. Un changement s'applique aux paiements suivants ; les limites s'appliquent aussitôt aux nouveaux ajouts."
      />
      {error && <Alert>{error}</Alert>}
      {done && <Alert tone="green">Offres enregistrées.</Alert>}
      {!plans ? (
        <Spinner />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 font-medium">Offre</th>
                  <th className="px-4 py-3 font-medium">Prix / mois (F CFA)</th>
                  <th className="px-4 py-3 font-medium">Centres max</th>
                  <th className="px-4 py-3 font-medium">Utilisateurs max</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Proposée</th>
                  <th className="px-4 py-3 font-medium text-right">Clients</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plans.map((p) => (
                  <tr key={p.code}>
                    <td className="px-4 py-2">
                      <Input value={p.name} onChange={(e) => set(p.code, { name: e.target.value })} aria-label={`Nom ${p.code}`} />
                      <span className="text-[11px] text-gray-400">{p.code}</span>
                    </td>
                    <td className="px-4 py-2">
                      <Input inputMode="numeric" value={String(p.monthlyPrice)} disabled={p.code === "TRIAL"} onChange={(e) => set(p.code, { monthlyPrice: Number(e.target.value.replace(/\D/g, "")) || 0 })} aria-label={`Prix ${p.code}`} />
                    </td>
                    <td className="px-4 py-2">
                      <Input inputMode="numeric" value={p.maxCenters?.toString() ?? ""} placeholder="illimité" onChange={(e) => set(p.code, { maxCenters: nul(e.target.value) })} />
                    </td>
                    <td className="px-4 py-2">
                      <Input inputMode="numeric" value={p.maxUsers?.toString() ?? ""} placeholder="illimité" onChange={(e) => set(p.code, { maxUsers: nul(e.target.value) })} />
                    </td>
                    <td className="px-4 py-2">
                      <Input value={p.description ?? ""} onChange={(e) => set(p.code, { description: e.target.value })} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="checkbox" checked={p.isActive} disabled={p.code === "TRIAL"} onChange={(e) => set(p.code, { isActive: e.target.checked })} aria-label={`Proposée ${p.code}`} />
                    </td>
                    <td className="px-4 py-2 text-right">{p._count.companies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end border-t border-gray-100 p-4">
            <Button onClick={save} loading={busy}>
              Enregistrer les offres
            </Button>
          </div>
        </Card>
      )}
      <p className="mt-3 text-xs text-gray-500">L&apos;essai gratuit dure 14 jours (variable PLATFORM_TRIAL_DAYS), suivi de 7 jours de grâce avant la consultation seule.</p>
    </>
  );
}

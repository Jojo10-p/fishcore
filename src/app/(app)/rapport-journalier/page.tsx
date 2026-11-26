"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Card, Input, PageHeader, Spinner } from "@/components/ui";
import { DailyReportBody, frDay, type DailyReport } from "@/components/reports/daily-report";
import { apiGet, errorMessage } from "@/lib/client/api";

// Rapport journalier : le point de la journée sans imprimer chaque facture.
export default function DailyReportPage() {
  const { centerId, can } = useSession();
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo" }).format(new Date()));
  const [r, setR] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = new URLSearchParams({ date, ...(centerId ? { centerId } : {}) }).toString();

  useEffect(() => {
    if (!can("report:view")) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<{ data: DailyReport }>(`/api/reports/daily?${query}`);
        if (alive) {
          setR(res.data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, can]);

  if (!can("report:view")) return <Alert tone="amber">Le rapport journalier est réservé au gérant et à la direction.</Alert>;

  return (
    <>
      <PageHeader
        title="Rapport journalier"
        description={r ? `${frDay(r.date)} · ${r.center?.name ?? "toutes les boutiques"}` : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Input type="date" aria-label="Jour" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-auto" />
            <a href={`/rapport-jour?${query}`} target="_blank" rel="noreferrer" className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              🖨️ Imprimer le rapport
            </a>
          </div>
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card className="p-4">{!r ? <Spinner /> : <DailyReportBody r={r} />}</Card>
    </>
  );
}

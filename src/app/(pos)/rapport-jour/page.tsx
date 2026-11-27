"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { A4Page, DocumentHeader, type DocCompany, type DocCenter } from "@/components/documents/a4-document";
import { DailyReportBody, frDay, type DailyReport } from "@/components/reports/daily-report";
import { apiGet, errorMessage } from "@/lib/client/api";

type Report = DailyReport & { company: DocCompany; center: DocCenter | null };

// Rapport journalier à imprimer (A4) : ?date=AAAA-MM-JJ&centerId=…
function ReportPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const date = sp.get("date") ?? "";
  // Sans boutique dans l'adresse (menu) : la boutique ouverte dans l'application
  const [savedCenter] = useState(() => {
    try {
      return typeof window !== "undefined" ? (localStorage.getItem("fishcore-selected-center") ?? "") : "";
    } catch {
      return "";
    }
  });
  const centerId = sp.get("centerId") ?? savedCenter;
  const pickDate = (d: string) => {
    if (!d) return;
    const q = new URLSearchParams({ date: d, ...(centerId ? { centerId } : {}) });
    setR(null);
    router.replace(`/rapport-jour?${q}`);
  };
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({ ...(date ? { date } : {}), ...(centerId ? { centerId } : {}) });
    apiGet<{ data: Report }>(`/api/reports/daily?${q}`)
      .then((res) => {
        setR(res.data);
        document.title = `Rapport journalier ${res.data.date}`;
      })
      .catch((e) => setError(errorMessage(e)));
  }, [date, centerId]);

  if (error)
    return (
      <div className="p-6 text-sm">
        <p className="text-red-700">{error}</p>
        <button type="button" onClick={() => router.back()} className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5">
          ← Retour
        </button>
      </div>
    );
  if (!r) return <p className="p-6 text-sm text-gray-500">Chargement du rapport…</p>;

  return (
    <A4Page
      toolbar={
        <input
          type="date"
          aria-label="Choisir le jour"
          value={r.date}
          onChange={(e) => pickDate(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        />
      }
    >
      <DocumentHeader
        company={r.company}
        center={r.center}
        title="RAPPORT JOURNALIER"
        number={r.date.split("-").reverse().join("")}
        meta={[
          ["Date", <span key="d" className="capitalize">{frDay(r.date)}</span>],
          ["Boutique", r.center?.name ?? "Toutes"],
          ["Imprimé le", new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })],
          ...(r.printedBy ? ([["Par", r.printedBy]] as Array<[string, string]>) : []),
        ]}
      />
      <div className="mt-6">
        <DailyReportBody r={r} />
      </div>
    </A4Page>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReportPage />
    </Suspense>
  );
}

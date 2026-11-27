"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { A4Page, type DocCompany, type DocCenter } from "@/components/documents/a4-document";
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
  // Jour choisi dans le calendrier ; le rapport sort quand on clique « Générer »
  const [picked, setPicked] = useState("");
  const generate = () => {
    if (!picked) return;
    const q = new URLSearchParams({ date: picked, ...(centerId ? { centerId } : {}) });
    setR(null);
    setError(null);
    router.replace(`/rapport-jour?${q}`);
  };
  const [r, setR] = useState<Report | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo" }).format(new Date());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({ ...(date ? { date } : {}), ...(centerId ? { centerId } : {}) });
    apiGet<{ data: Report }>(`/api/reports/daily?${q}`)
      .then((res) => {
        setR(res.data);
        setPicked(res.data.date);
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
      responsive
      toolbar={
        <div className="flex w-full flex-wrap items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white p-2 sm:w-auto">
          <label htmlFor="jour" className="text-sm font-medium text-gray-700">
            📅 Jour du rapport
          </label>
          <input
            id="jour"
            type="date"
            value={picked}
            max={today}
            onChange={(e) => setPicked(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={generate}
            disabled={!picked || picked === r.date}
            className="rounded-lg bg-[#0b1f4b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#13307a] disabled:opacity-40"
          >
            Générer le rapport
          </button>
        </div>
      }
    >
      {/* En-tête centré (lisible sur téléphone comme sur papier) */}
      <header className="border-b-4 border-[#0b1f4b] pb-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo GJH statique */}
        <img src="/icons/gjh-logo.png" alt="" className="mx-auto h-14 w-auto object-contain" />
        <p className="mt-1 text-base font-bold uppercase tracking-wide text-[#0b1f4b] sm:text-lg">{r.company.tradeName}</p>
        <p className="text-[11px] text-gray-600">
          {[r.center?.name, r.center?.city ?? r.company.city, `Tél. ${r.center?.phone ?? r.company.phone}`].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-3 text-xl font-black tracking-wider text-[#0b1f4b] sm:text-2xl">RAPPORT JOURNALIER</p>
        <p className="mt-1 inline-block rounded bg-[#fdf6e3] px-3 py-1 text-sm font-semibold capitalize text-[#8a5a00]">{frDay(r.date)}</p>
        <p className="mt-1.5 text-[11px] text-gray-500">
          Boutique : {r.center?.name ?? "toutes"} · Imprimé le {new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
          {r.printedBy ? ` par ${r.printedBy}` : ""}
        </p>
      </header>
      <div className="mt-5">
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

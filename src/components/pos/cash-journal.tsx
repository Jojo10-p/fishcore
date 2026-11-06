"use client";

import { createPortal } from "react-dom";
import { Money } from "@/components/ui";

// ─────────────────────────────────────────────
// Journal de caisse : à la fermeture (caissier) et à tout moment (direction)
// ─────────────────────────────────────────────

export interface CloseResult {
  theoreticalBalance: string;
  declaredBalance: string;
  discrepancy: string;
  totalSales: string;
  journal?: {
    openedAt: string;
    closedAt: string | null;
    registerName: string;
    cashier: { firstName: string; lastName: string; role: string };
    openingBalance: string;
    salesCount: number;
    totalCash: string;
    totalMobileMoney: string;
    totalCard: string;
    totalOther: string;
    totalCashOut: string;
    expenses: Array<{ category: string; description: string | null; amount: string; date: string }>;
  };
}

/** Journal de caisse de la journée : ouverture, ventes par mode, dépenses, clôture. */
export function CashJournal({ r, currency, printable = false }: { r: CloseResult; currency: string; printable?: boolean }) {
  const j = r.journal;
  const gap = Number(r.discrepancy);
  const row = (label: string, value: string | number, strong = false, tone = "") => (
    <div className={`flex justify-between gap-2 ${strong ? "font-semibold" : ""} ${tone}`}>
      <span className={printable ? "" : "text-gray-600"}>{label}</span>
      <span className="tabular-nums">
        <Money value={value} currency={currency} />
      </span>
    </div>
  );
  return (
    <div className={printable ? "space-y-1 text-[11.5px]" : "space-y-1.5 text-sm"}>
      {printable && (
        <div className="mb-2 text-center">
          <p className="text-[15px] font-black">JOURNAL DE CAISSE</p>
          {j && (
            <p>
              {j.registerName} — {j.cashier.firstName}
            </p>
          )}
        </div>
      )}
      {j && !printable && (
        <p className="font-semibold text-gray-900">
          {j.registerName} — {j.cashier.firstName} {j.cashier.lastName}
        </p>
      )}
      {j && (
        <p className={printable ? "" : "text-xs text-gray-500"}>
          Ouverte le {new Date(j.openedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
          {j.closedAt && ` · clôturée le ${new Date(j.closedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`}
        </p>
      )}
      {j && row("Fond de caisse (ouverture)", j.openingBalance)}
      {row(`Ventes${j ? ` (${j.salesCount})` : ""}`, r.totalSales, true)}
      {j && Number(j.totalCash) > 0 && row("  dont espèces", j.totalCash)}
      {j && Number(j.totalMobileMoney) > 0 && row("  dont Mobile Money", j.totalMobileMoney)}
      {j && Number(j.totalCard) > 0 && row("  dont carte", j.totalCard)}
      {j && Number(j.totalOther) > 0 && row("  dont autres", j.totalOther)}
      {j && j.expenses.length > 0 && (
        <div className="border-t border-dashed border-gray-300 pt-1">
          <p className="font-semibold">Dépenses</p>
          {j.expenses.map((e, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {e.category}
                {e.description ? ` — ${e.description}` : ""}
              </span>
              <span className="tabular-nums">
                −<Money value={e.amount} currency={currency} />
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-gray-300 pt-1">
        {row("Espèces attendues", r.theoreticalBalance)}
        {row("Espèces comptées", r.declaredBalance, true)}
        {row("Écart", r.discrepancy, true, gap === 0 ? "text-green-700" : "text-red-700")}
      </div>
      {printable && (
        <div className="mt-6 grid grid-cols-2 gap-2 text-[10px]">
          <div className="h-12 border border-black p-1">Caissier</div>
          <div className="h-12 border border-black p-1">Responsable</div>
        </div>
      )}
    </div>
  );
}


/** Version ticket 80 mm, imprimée seule (le reste de la page est masqué à l'impression). */
export function PrintableJournal({ r, currency }: { r: CloseResult; currency: string }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="cash-journal-print hidden w-[72mm] bg-white p-[2mm] text-black print:block">
      <style>{`@page { margin: 0; } @media print { body > *:not(.cash-journal-print) { display: none !important; } }`}</style>
      <CashJournal r={r} currency={currency} printable />
    </div>,
    document.body
  );
}

/** Nom proposé à l'enregistrement en PDF : « Journal caisse Samson 06-11-2026 18h05 » */
export function journalFileName(r: CloseResult) {
  const j = r.journal;
  const d = new Date(j?.closedAt ?? Date.now());
  const p = (n: number) => String(n).padStart(2, "0");
  return `Journal caisse ${j?.cashier.firstName ?? ""} ${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}h${p(d.getMinutes())}`.replace(/\s+/g, " ");
}

/** Imprime le journal (ou l'enregistre en PDF) avec un nom de fichier clair. */
export function printJournal(r: CloseResult) {
  const before = document.title;
  document.title = journalFileName(r);
  window.print();
  document.title = before;
}

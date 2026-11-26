"use client";

import { createPortal } from "react-dom";
import { Money } from "@/components/ui";

// ─────────────────────────────────────────────
// Journal de caisse : à la fermeture (caissier) et à tout moment (direction)
// ─────────────────────────────────────────────

export interface CloseResult {
  sessionId?: string;
  cashierId?: string;
  isValidated?: boolean;
  validatedBy?: string | null;
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
    /** Entrées et sorties de caisse hors ventes et dépenses (apports, avances…) */
    totalCashIn?: string;
    otherCashOut?: string;
    totalRefunds?: string;
    totalExpenses?: string;
    expenses: Array<{ category: string; description: string | null; amount: string; date: string }>;
  };
  /** Résultat estimé (gérant, direction) */
  profit?: { revenue: string; costOfSales: string; grossProfit: string; expenses: string; netProfit: string };
}

/**
 * Journal de caisse de la journée, en deux parties bien séparées :
 *  1. L'argent de la caisse : fond de départ + ventes − dépenses = ce qui doit rester.
 *  2. Le résultat estimé (gérant, direction) : ce que les ventes ont rapporté,
 *     moins les dépenses = bénéfice net estimé.
 */
export function CashJournal({ r, currency, printable = false }: { r: CloseResult; currency: string; printable?: boolean }) {
  const j = r.journal;
  const gap = Number(r.discrepancy);
  const num = (v: string | number | undefined) => Number(v ?? 0);
  const row = (label: string, value: string | number, opts: { strong?: boolean; tone?: string; sign?: "+" | "−" | "=" ; indent?: boolean } = {}) => (
    <div className={`flex justify-between gap-2 ${opts.strong ? "font-semibold" : ""} ${opts.tone ?? ""} ${opts.indent ? "pl-3 text-[0.92em]" : ""}`}>
      <span className={printable || opts.strong ? "" : "text-gray-600"}>
        {opts.sign && <span className="inline-block w-3">{opts.sign}</span>}
        {label}
      </span>
      <span className="tabular-nums whitespace-nowrap">
        <Money value={value} currency={currency} />
      </span>
    </div>
  );
  const title = (t: string) => <p className={`font-bold uppercase tracking-wide ${printable ? "mt-2 text-[11px]" : "mt-3 text-xs text-gray-500"}`}>{t}</p>;
  const line = <div className={`my-1 border-t ${printable ? "border-black" : "border-gray-300"}`} />;

  const cash = num(j?.totalCash);
  const nonCash = num(r.totalSales) - cash;
  const expensesTotal = num(j?.totalExpenses ?? j?.expenses.reduce((s, e) => s + num(e.amount), 0));
  const p = r.profit;
  const net = num(p?.netProfit);

  return (
    <div className={printable ? "space-y-0.5 text-[11.5px]" : "space-y-1 text-sm"}>
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

      {/* ── 1. Ventes du jour ── */}
      {title("Ventes du jour")}
      {row(`Total des ventes${j ? ` (${j.salesCount})` : ""}`, r.totalSales, { strong: true })}
      {j && cash > 0 && row("en espèces", j.totalCash, { indent: true })}
      {j && num(j.totalMobileMoney) > 0 && row("en Mobile Money", j.totalMobileMoney, { indent: true })}
      {j && num(j.totalCard) > 0 && row("par carte", j.totalCard, { indent: true })}
      {j && num(j.totalOther) > 0 && row("autres moyens", j.totalOther, { indent: true })}

      {/* ── 2. Dépenses du jour ── */}
      {j && (
        <>
          {title("Dépenses du jour")}
          {j.expenses.length === 0 && <p className={printable ? "" : "text-gray-500"}>Aucune dépense</p>}
          {j.expenses.map((e, i) => (
            <div key={i} className="flex justify-between gap-2 pl-3 text-[0.92em]">
              <span className="min-w-0 truncate">
                {e.category}
                {e.description ? ` — ${e.description}` : ""}
              </span>
              <span className="tabular-nums whitespace-nowrap">
                <Money value={e.amount} currency={currency} />
              </span>
            </div>
          ))}
          {row("Total des dépenses", expensesTotal, { strong: true })}
        </>
      )}

      {/* ── 3. Argent dans la caisse (espèces) ── */}
      {title("Argent dans la caisse (espèces)")}
      {j && row("Fond de caisse au début", j.openingBalance)}
      {j && row("Ventes en espèces", cash, { sign: "+" })}
      {j && num(j.totalCashIn) > 0 && row("Autres entrées", num(j.totalCashIn), { sign: "+" })}
      {j && expensesTotal > 0 && row("Dépenses payées par la caisse", expensesTotal, { sign: "−" })}
      {j && num(j.totalRefunds) > 0 && row("Remboursements", num(j.totalRefunds), { sign: "−" })}
      {j && num(j.otherCashOut) > 0 && row("Autres sorties (avances…)", num(j.otherCashOut), { sign: "−" })}
      {line}
      {row("Reste attendu en caisse", r.theoreticalBalance, { strong: true, sign: j ? "=" : undefined })}
      {row("Espèces comptées", r.declaredBalance, { strong: true })}
      {row(gap === 0 ? "Écart : la caisse est juste" : gap > 0 ? "Écart : surplus" : "Écart : manque", r.discrepancy, {
        strong: true,
        tone: gap === 0 ? "text-green-700" : "text-red-700",
      })}
      {nonCash > 0 && (
        <p className={printable ? "text-[10px]" : "text-xs text-gray-500"}>
          Mobile Money, carte… (<Money value={nonCash} currency={currency} />) : sur les comptes, pas dans le tiroir.
        </p>
      )}

      {/* ── 4. Résultat estimé (gérant, direction) ── */}
      {p && (
        <>
          {title("Résultat de la journée (estimation)")}
          {row("Ventes (hors TVA)", p.revenue)}
          {row("Prix d'achat des articles vendus", p.costOfSales, { sign: "−" })}
          {line}
          {row("Bénéfice sur les ventes", p.grossProfit, { strong: true, sign: "=" })}
          {row("Dépenses du jour", p.expenses, { sign: "−" })}
          {line}
          {row("Bénéfice net estimé", p.netProfit, { strong: true, sign: "=", tone: net >= 0 ? "text-green-700" : "text-red-700" })}
          <p className={printable ? "text-[10px]" : "text-xs text-gray-500"}>
            Ce que les ventes ont rapporté, moins les dépenses payées par cette caisse. Estimation : le prix d&apos;achat est celui du stock au moment de la vente.
          </p>
        </>
      )}

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

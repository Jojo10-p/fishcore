import { QrCode } from "@/components/documents/qr-code";

// Mentions de la facture normalisée e-MECeF (DGI Bénin), reprises telles que la
// DGI les a renvoyées : taxes par groupe, code MECeF/DGI, NIM, compteurs, heure, QR code.

export interface EmecfView {
  type?: "FV" | "FA";
  status: "PENDING" | "SUBMITTED" | "NORMALIZED" | "FAILED";
  codeMecefDgi: string | null;
  qrCode: string | null;
  counters: string | null;
  nim: string | null;
  dgiDateTime: string | null;
  total?: number | null;
  totals?: Record<string, number> | null;
  lastError?: string | null;
}

const GROUPS: Array<{ letter: string; amount: string; label: string; ht?: string; vat?: string }> = [
  { letter: "A", amount: "taa", label: "A — Exonéré" },
  { letter: "B", amount: "tab", label: "B — Taxable 18 %", ht: "hab", vat: "vab" },
  { letter: "C", amount: "tac", label: "C — Exportation" },
  { letter: "D", amount: "tad", label: "D — TVA régime d'exception", ht: "had", vat: "vad" },
  { letter: "E", amount: "tae", label: "E — Régime TPS" },
  { letter: "F", amount: "taf", label: "F — Réservé" },
];
const n = (v: number) => v.toLocaleString("fr-FR").replace(/[  ]/g, " ");

/** Bloc pour le ticket 80 mm. */
export function EmecfTicketBlock({ e }: { e: EmecfView | null | undefined }) {
  if (!e) return null;
  if (e.status !== "NORMALIZED" || !e.codeMecefDgi) {
    return (
      <p className="mt-2 border border-dashed border-black px-1 py-1 text-center text-[10.5px]">
        Facture en attente de normalisation DGI (e-MECeF). La facture normalisée est disponible à la caisse dès la connexion rétablie.
      </p>
    );
  }
  const t = e.totals ?? {};
  return (
    <section className="mt-2 border-t border-black pt-1.5 text-[10.5px]">
      <p className="text-center font-black">{e.type === "FA" ? "FACTURE D'AVOIR NORMALISÉE" : "FACTURE NORMALISÉE"}</p>
      <div className="mt-1">
        {GROUPS.filter((g) => (t[g.amount] ?? 0) > 0).map((g) => (
          <div key={g.letter}>
            <div className="flex justify-between">
              <span>{g.label}</span>
              <span>{n(t[g.amount])}</span>
            </div>
            {g.ht && (t[g.ht] ?? 0) > 0 && (
              <div className="flex justify-between pl-2 text-[9.5px]">
                <span>HT {n(t[g.ht])}</span>
                <span>TVA {n(t[g.vat!] ?? 0)}</span>
              </div>
            )}
          </div>
        ))}
        {(t.aib ?? 0) > 0 && (
          <div className="flex justify-between">
            <span>AIB</span>
            <span>{n(t.aib)}</span>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-center font-bold">Code MECeF/DGI</p>
      <p className="whitespace-nowrap text-center font-mono text-[11px] font-bold tracking-tight">{e.codeMecefDgi}</p>
      <div className="mt-1 flex items-center gap-2">
        {e.qrCode && <QrCode value={e.qrCode} size={92} />}
        <div className="min-w-0 space-y-0.5 text-[10px]">
          {e.nim && <p>MECeF NIM : {e.nim}</p>}
          {e.counters && <p>Compteurs : {e.counters}</p>}
          {e.dgiDateTime && <p>Heure MECeF : {e.dgiDateTime}</p>}
        </div>
      </div>
    </section>
  );
}

/** Bloc pour la facture A4. */
export function EmecfA4Block({ e, credit }: { e: EmecfView | null | undefined; credit?: EmecfView | null }) {
  if (!e) return null;
  if (e.status !== "NORMALIZED" || !e.codeMecefDgi) {
    return (
      <p className="mt-4 rounded border border-dashed border-gray-500 p-2 text-[11px] text-gray-700">
        Facture en attente de normalisation auprès de la DGI (e-MECeF){e.lastError ? ` — ${e.lastError}` : ""}.
      </p>
    );
  }
  const t = e.totals ?? {};
  const docs = [e, ...(credit?.status === "NORMALIZED" ? [credit] : [])];
  return (
    <section className="mt-5 grid grid-cols-[1fr_auto] gap-4 rounded border border-gray-400 p-3 text-[11px] [break-inside:avoid]">
      <div>
        <p className="font-bold uppercase">Facture normalisée — e-MECeF</p>
        <table className="mt-1.5 w-full text-[10.5px]">
          <tbody>
            {GROUPS.filter((g) => (t[g.amount] ?? 0) > 0).map((g) => (
              <tr key={g.letter}>
                <td className="pr-2">{g.label}</td>
                <td className="pr-2 text-right">{g.ht && t[g.ht] ? `HT ${n(t[g.ht])}` : ""}</td>
                <td className="pr-2 text-right">{g.vat && t[g.vat] ? `TVA ${n(t[g.vat])}` : ""}</td>
                <td className="text-right font-semibold">{n(t[g.amount])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {docs.map((d) => (
          <div key={d.codeMecefDgi} className="mt-2 space-y-0.5">
            <p>
              {d.type === "FA" ? "Avoir — " : ""}Code MECeF/DGI : <span className="font-mono font-bold">{d.codeMecefDgi}</span>
            </p>
            <p className="text-gray-700">
              MECeF NIM : {d.nim ?? "—"} · Compteurs : {d.counters ?? "—"} · Heure MECeF : {d.dgiDateTime ?? "—"}
            </p>
          </div>
        ))}
      </div>
      {e.qrCode && <QrCode value={e.qrCode} size={110} />}
    </section>
  );
}

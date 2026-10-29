"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Alert, Button, Card, Field, PageHeader, Select, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { FIELD_LABELS, parseImport, type ImportField } from "@/lib/import-articles";

interface Unit {
  id: string;
  name: string;
  symbol: string;
}
interface Report {
  created: number;
  updated: number;
  unchanged: number;
  stockSet: number;
  dryRun: boolean;
  skipped: Array<{ line?: number; name: string; reason: string }>;
  warnings: Array<{ line?: number; name: string; message: string }>;
}

const FIELDS = Object.keys(FIELD_LABELS) as ImportField[];
const fmt = (v?: number) => (v === undefined ? "" : v.toLocaleString("fr-FR", { maximumFractionDigits: 3 }));

/** Fichier exporté par Sage : souvent en Windows-1252, pas en UTF-8. */
async function readFileText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

// Reprise du catalogue depuis Sage Gestion Commerciale, Excel ou tout tableau
export default function ImportProductsPage() {
  const { centerId, session, profile, can } = useSession();
  const [text, setText] = useState("");
  const [mapping, setMapping] = useState<Array<ImportField | null> | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [defaultUnitId, setDefaultUnitId] = useState("");
  const [stockCenterId, setStockCenterId] = useState("");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: Unit[] }>("/api/units")
      .then((r) => setUnits(r.data))
      .catch(() => undefined);
  }, []);

  const parsed = useMemo(() => (text.trim() ? parseImport(text, mapping ?? undefined) : null), [text, mapping]);
  const hasStock = parsed?.columns.some((c) => c.field === "stock") ?? false;
  const unitDefault = defaultUnitId || units.find((u) => u.symbol === profile.defaultUnit)?.id || "";
  const targetCenter = stockCenterId || centerId || "";

  const changeText = (t: string) => {
    setText(t);
    setMapping(null);
    setReport(null);
  };

  const send = async (dryRun: boolean) => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: Report }>("/api/products/import", {
        dryRun,
        updateExisting,
        defaultUnitId: unitDefault || undefined,
        centerId: hasStock ? targetCenter : undefined,
        rows: parsed.rows,
      });
      setReport(r.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Importer des articles"
        description="Reprenez votre catalogue et votre stock depuis Sage Gestion Commerciale, Excel ou tout autre logiciel."
        actions={
          <Link href="/produits">
            <Button variant="secondary">Retour aux articles</Button>
          </Link>
        }
      />
      <div className="max-w-5xl space-y-6">
        <Card className="space-y-4 p-4 sm:p-6">
          <h2 className="font-semibold text-gray-900">1. Copiez votre liste d&apos;articles</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
            <li>
              Dans Sage : <strong>Structure → Articles</strong>, cliquez dans la liste, <strong>Ctrl + A</strong> puis <strong>Ctrl + C</strong>.
              Depuis Excel : sélectionnez le tableau avec ses titres et copiez-le.
            </li>
            <li>
              Collez ci-dessous (<strong>Ctrl + V</strong>), ou choisissez un fichier exporté (.csv, .txt).
            </li>
            <li>Les colonnes sont reconnues d&apos;après leur titre (Référence, Désignation, Stock réel, Prix de vente…) ; corrigez-les si besoin.</li>
          </ol>
          <Textarea
            rows={8}
            value={text}
            onChange={(e) => changeText(e.target.value)}
            placeholder={"Référence\tDésignation\tStock réel\tPrix de vente\nA01\tAILERON\t52,15\t2500"}
            className="font-mono text-xs"
            aria-label="Tableau d'articles collé"
          />
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-blue-700 hover:underline">
            <input
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) changeText(await readFileText(f));
                e.target.value = "";
              }}
            />
            Choisir un fichier CSV / texte…
          </label>
        </Card>

        {parsed && (
          <Card className="space-y-4 p-4 sm:p-6">
            <h2 className="font-semibold text-gray-900">2. Vérifiez les colonnes</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {parsed.columns.map((c, i) => (
                <Field key={i} label={c.header || `Colonne ${i + 1}`}>
                  <Select
                    value={c.field ?? ""}
                    onChange={(e) => {
                      const next = parsed.columns.map((x) => x.field);
                      next[i] = (e.target.value || null) as ImportField | null;
                      setMapping(next);
                      setReport(null);
                    }}
                  >
                    <option value="">— ignorer —</option>
                    {FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            {parsed.errors.length > 0 && (
              <Alert tone="amber">
                <p className="font-medium">{parsed.errors.length} ligne(s) écartée(s) :</p>
                <ul className="mt-1 list-disc pl-5">
                  {parsed.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      Ligne {e.line} — {e.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}

            {parsed.rows.length > 0 && (
              <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                    <tr>
                      {["Réf.", "Désignation", "Unité", "Prix de vente", "Prix d'achat", "Stock", "Catégorie"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsed.rows.slice(0, 200).map((r) => (
                      <tr key={r.line}>
                        <td className="px-2 py-1 font-mono text-xs">{r.reference}</td>
                        <td className="px-2 py-1">{r.name}</td>
                        <td className="px-2 py-1">{r.unit}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.sellingPrice)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.purchasePrice)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmt(r.stock)}</td>
                        <td className="px-2 py-1">{r.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 200 && <p className="px-2 py-1.5 text-xs text-gray-500">… et {parsed.rows.length - 200} autres.</p>}
              </div>
            )}
            <p className="text-sm text-gray-600">{parsed.rows.length} article(s) prêts à importer.</p>
          </Card>
        )}

        {parsed && parsed.rows.length > 0 && (
          <Card className="space-y-4 p-4 sm:p-6">
            <h2 className="font-semibold text-gray-900">3. Options et import</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Unité des nouveaux articles" hint="Utilisée quand la colonne Unité est absente ou inconnue.">
                <Select value={unitDefault} onChange={(e) => setDefaultUnitId(e.target.value)}>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.symbol})
                    </option>
                  ))}
                </Select>
              </Field>
              {hasStock && (
                <Field label="Stock importé dans" hint="Le stock de ce magasin est amené aux quantités du fichier (ajustement d'inventaire tracé).">
                  <Select value={targetCenter} onChange={(e) => setStockCenterId(e.target.value)}>
                    {session?.centers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            {can("product:edit") && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                <span>
                  Mettre à jour les prix des articles déjà enregistrés (même référence)
                  <span className="block text-xs text-gray-500">Sinon, seuls les nouveaux articles sont créés ; les prix existants ne bougent pas.</span>
                </span>
              </label>
            )}
            {hasStock && !can("stock:adjust") && <Alert tone="amber">Votre rôle ne permet pas d&apos;ajuster le stock : retirez la colonne Stock.</Alert>}
            {error && <Alert>{error}</Alert>}

            {report && (
              <Alert tone={report.dryRun ? "blue" : "green"}>
                <p className="font-medium">
                  {report.dryRun ? "Vérification (rien n'est encore enregistré) :" : "Import terminé :"} {report.created} créé(s), {report.updated} mis à jour,{" "}
                  {report.unchanged} inchangé(s), stock ajusté pour {report.stockSet} article(s)
                  {report.skipped.length > 0 && `, ${report.skipped.length} écarté(s)`}.
                </p>
                {[...report.skipped.map((s) => `Ligne ${s.line ?? "?"} — ${s.name} : ${s.reason}`), ...report.warnings.map((w) => `Ligne ${w.line ?? "?"} — ${w.name} : ${w.message}`)]
                  .slice(0, 15)
                  .map((m, i) => (
                    <p key={i} className="text-xs">
                      {m}
                    </p>
                  ))}
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => send(true)} loading={busy}>
                Vérifier
              </Button>
              <Button onClick={() => send(false)} loading={busy} disabled={!report?.dryRun}>
                Importer {parsed.rows.length} article(s)
              </Button>
              {report && !report.dryRun && (
                <Link href="/produits">
                  <Button variant="secondary">Voir les articles</Button>
                </Link>
              )}
            </div>
            <p className="text-xs text-gray-500">Commencez par « Vérifier » : le résultat s&apos;affiche sans rien enregistrer. L&apos;import se fait ensuite en une fois (tout ou rien).</p>
          </Card>
        )}
      </div>
    </>
  );
}

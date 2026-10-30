"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, Select, Spinner, Textarea } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";

interface EmecfSettings {
  enabled: boolean;
  mode: "test" | "production";
  hasToken: boolean;
  nim: string | null;
  tokenValidUntil: string | null;
  defaultTaxGroup: string;
  taxId: string | null;
  taxGroups: Record<string, { label: string; rate: number }>;
  counts: Partial<Record<"PENDING" | "SUBMITTED" | "NORMALIZED" | "FAILED", number>>;
  waiting: Array<{ id: string; type: "FV" | "FA"; status: string; lastError: string | null; attempts: number; createdAt: string; sale: { id: string; saleNumber: string; totalAmount: string } }>;
}

/** Facture normalisée e-MECeF (DGI) : activation, jeton, groupe de taxe, suivi. */
export function EmecfCard({ editable }: { editable: boolean }) {
  const [s, setS] = useState<EmecfSettings | null>(null);
  const [mode, setMode] = useState<"test" | "production">("test");
  const [token, setToken] = useState("");
  const [group, setGroup] = useState("B");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ data: EmecfSettings }>("/api/company/emecf");
      setS(r.data);
      setMode(r.data.mode);
      setGroup(r.data.defaultTaxGroup);
      setEnabled(r.data.enabled);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await apiSend<{ data: EmecfSettings }>("/api/company/emecf", { enabled, mode, defaultTaxGroup: group, ...(token.trim() ? { token: token.trim() } : {}) }, "PUT");
      setS(r.data);
      setToken("");
      setDone(r.data.enabled ? `Facture normalisée active (${r.data.mode === "production" ? "production" : "bac à sable DGI"}) — NIM ${r.data.nim ?? "—"}.` : "Réglages enregistrés.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const r = await apiSend<{ data: { processed: number; normalized: number } }>("/api/company/emecf/retry", {});
      setDone(`${r.data.normalized} facture(s) normalisée(s) sur ${r.data.processed} reprise(s).`);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRetrying(false);
    }
  };

  if (!s) return <Card className="p-4 sm:p-6">{error ? <Alert>{error}</Alert> : <Spinner />}</Card>;
  const waiting = (s.counts.PENDING ?? 0) + (s.counts.SUBMITTED ?? 0) + (s.counts.FAILED ?? 0);

  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">Facture normalisée e-MECeF (DGI)</h2>
          <p className="text-sm text-gray-500">
            Chaque vente est déclarée à la DGI : le ticket et la facture portent le code MECeF/DGI, le QR code, le NIM et les compteurs.
          </p>
        </div>
        {s.enabled ? (
          <Badge tone={s.mode === "production" ? "green" : "amber"}>{s.mode === "production" ? "Active — production" : "Active — bac à sable"}</Badge>
        ) : (
          <Badge tone="gray">Inactive</Badge>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      {done && <Alert tone="green">{done}</Alert>}
      {!s.taxId && <Alert tone="amber">Renseignez d&apos;abord l&apos;IFU de l&apos;entreprise (ci-dessous), puis enregistrez les paramètres.</Alert>}

      {s.enabled && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Info label="NIM de l'e-MCF" value={s.nim ?? "—"} />
          <Info label="Jeton valable jusqu'au" value={s.tokenValidUntil ? new Date(s.tokenValidUntil).toLocaleDateString("fr-FR") : "—"} />
          <Info label="Factures normalisées" value={String(s.counts.NORMALIZED ?? 0)} />
          <Info label="En attente" value={String(waiting)} tone={waiting > 0 ? "amber" : undefined} />
        </div>
      )}

      {s.waiting.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-amber-900">Factures à normaliser</p>
            <Button variant="secondary" onClick={retry} loading={retrying}>
              Normaliser maintenant
            </Button>
          </div>
          <ul className="space-y-1 text-amber-900">
            {s.waiting.map((w) => (
              <li key={w.id}>
                <Link href={`/facture/${w.sale.id}`} target="_blank" className="font-mono underline">
                  {w.sale.saleNumber}
                </Link>
                {w.type === "FA" ? " (avoir)" : ""} — {w.status === "FAILED" ? "refusée" : "en attente"}
                {w.lastError ? ` : ${w.lastError}` : ""}
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-800">Elles sont reprises automatiquement dès que la DGI répond ; ce bouton force la reprise.</p>
        </div>
      )}

      {editable && (
        <div className="space-y-4 border-t border-gray-100 pt-4">
          <Field label="Environnement">
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={mode === "test"} onChange={() => setMode("test")} /> Bac à sable DGI (essais)
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={mode === "production"} onChange={() => setMode("production")} /> Production (factures réelles)
              </label>
            </div>
          </Field>
          <Field
            label="Jeton e-MCF"
            hint={
              s.hasToken
                ? "Un jeton est enregistré (chiffré, jamais affiché). Collez-en un nouveau seulement pour le remplacer."
                : "À récupérer sur le portail e-MECeF de la DGI, rubrique de gestion de votre e-MCF (un jeton par appareil e-MCF)."
            }
          >
            <Textarea rows={3} value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.hasToken ? "••••••••  (inchangé)" : "eyJhbGciOi…"} autoComplete="off" spellCheck={false} className="font-mono text-xs" />
          </Field>
          <Field label="Groupe de taxe par défaut des articles" hint="Un article peut avoir son propre groupe (fiche article).">
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              {Object.entries(s.taxGroups).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} — {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1" />
            <span>
              <strong>Normaliser toutes les ventes</strong> — sans connexion, la vente passe et sa facture est normalisée au retour du réseau.
            </span>
          </label>
          <div className="flex justify-end">
            <Button onClick={save} loading={busy}>
              Vérifier et enregistrer
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-0.5 font-semibold ${tone === "amber" ? "text-amber-700" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}

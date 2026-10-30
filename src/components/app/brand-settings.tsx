"use client";

import { useRef, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { InstallAppButton } from "@/components/app/install-app";
import { Alert, Button, Card } from "@/components/ui";
import { apiSend, errorMessage } from "@/lib/client/api";
import { prepareLogo } from "@/lib/client/brand";

/** Logo de l'entreprise : icône de l'application installée et en-tête des documents. */
export function BrandCard({ editable }: { editable: boolean }) {
  const { session, refresh } = useSession();
  const company = session?.company;
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ logo512: string; logo192: string; maskable512: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!company) return null;
  const current = company.logoUrl ? `/api/brand/${company.id}/logo.png?v=${new URLSearchParams(company.logoUrl.split("?")[1] ?? "").get("v") ?? ""}` : null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      setPreview(await prepareLogo(file));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/company/logo", preview);
      setPreview(null);
      await refresh();
      setDone("Logo enregistré : il apparaît sur l'application, ses icônes et vos documents.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Retirer le logo ? L'icône par défaut sera utilisée.")) return;
    setBusy(true);
    try {
      await apiSend("/api/company/logo", {}, "DELETE");
      await refresh();
      setDone("Logo retiré.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = preview?.logo512 ?? current;

  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-gray-900">Votre application</h2>
        <p className="text-sm text-gray-500">
          L&apos;application porte le nom <strong>{company.tradeName}</strong>. Votre logo devient son icône (bureau, menu Démarrer, téléphone) et
          l&apos;en-tête de vos factures, devis et bons.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {done && <Alert tone="green">{done}</Alert>}
      <div className="flex flex-col sm:flex-row items-start gap-5">
        <div className="flex items-end gap-4">
          <div className="h-28 w-28 rounded-2xl border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element -- aperçu local / logo servi par l'API
              <img src={shown} alt="Logo" className="h-full w-full object-contain" />
            ) : (
              <span className="text-3xl font-bold text-gray-300">{company.tradeName.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          {preview && (
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu de l'icône ronde (Android) */}
              <img src={preview.maskable512} alt="" className="h-14 w-14 rounded-full border border-gray-200" />
              <p className="mt-1 text-[11px] text-gray-500">icône ronde</p>
            </div>
          )}
        </div>
        <div className="space-y-2 text-sm">
          {editable ? (
            <>
              <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
                  {current ? "Changer le logo" : "Ajouter un logo"}
                </Button>
                {preview && (
                  <Button onClick={save} loading={busy}>
                    Enregistrer ce logo
                  </Button>
                )}
                {current && !preview && (
                  <Button variant="ghost" onClick={remove} disabled={busy}>
                    Retirer
                  </Button>
                )}
              </div>
              <p className="text-xs text-gray-500">PNG, JPG ou WebP. Un logo carré sur fond clair donne la meilleure icône.</p>
            </>
          ) : (
            <p className="text-gray-500">Seul le propriétaire peut changer le logo.</p>
          )}
          <div className="pt-2">
            <InstallAppButton appName={company.tradeName} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100" />
          </div>
          <p className="text-xs text-gray-500">
            Après un changement de logo, une application déjà installée met à jour son icône d&apos;elle-même (quelques heures à un jour selon
            l&apos;appareil).
          </p>
        </div>
      </div>
    </Card>
  );
}

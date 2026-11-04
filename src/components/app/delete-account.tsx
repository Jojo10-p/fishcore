"use client";

import { useState } from "react";
import {
  clearSessionCache,
  useSession,
} from "@/components/app/session-provider";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Textarea,
} from "@/components/ui";
import { apiSend, errorMessage } from "@/lib/client/api";
import { applyBrand } from "@/lib/client/brand";
import {
  DELETION_REASONS,
  type DeletionReasonCode,
} from "@/lib/deletion-reasons";
import { getOfflineDB } from "@/lib/offline/db";
import { getPendingSyncCount } from "@/lib/offline/sync";

/** Zone dangereuse des paramètres : suppression définitive du compte (propriétaire). */
export function DeleteAccountCard() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [reasons, setReasons] = useState<DeletionReasonCode[]>([]);
  const [otherReason, setOtherReason] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session?.company || session.user.role !== "COMPANY_OWNER") return null;
  const name = session.company.tradeName;
  const ready =
    password.length > 0 &&
    confirmName.trim().toLowerCase() === name.trim().toLowerCase();
  const wantsOther = reasons.includes("other");
  const reasonsOk =
    reasons.length > 0 && (!wantsOther || otherReason.trim().length >= 3);
  const toggle = (code: DeletionReasonCode) =>
    setReasons((r) =>
      r.includes(code) ? r.filter((x) => x !== code) : [...r, code],
    );
  const openDialog = () => {
    setStep(1);
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const pending = await getPendingSyncCount().catch(() => 0);
      if (
        pending > 0 &&
        !window.confirm(
          `${pending} vente(s) ou opération(s) de cet appareil ne sont pas encore envoyées. Elles seront perdues. Continuer ?`,
        )
      ) {
        setBusy(false);
        return;
      }
      await apiSend("/api/company/delete", {
        password,
        confirmName,
        reasons,
        otherReason: wantsOther ? otherReason.trim() : undefined,
      });
      // Rien ne reste sur cet appareil : identité, nom/logo, données hors ligne
      clearSessionCache();
      applyBrand(null);
      try {
        await getOfflineDB().delete();
        localStorage.clear();
      } catch {
        /* ignore */
      }
      window.location.replace("/login?compte=supprime");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-6 space-y-3 border-red-200">
      <h2 className="font-semibold text-red-700">Supprimer le compte</h2>
      <p className="text-sm text-gray-600">
        Supprime définitivement <strong>{name}</strong> et toutes ses données :
        centres, caisses, articles, stocks, ventes, factures, devis, clients,
        fournisseurs, dépenses, utilisateurs et téléphones abonnés. Tout est
        effacé de la base de données. Cette action est irréversible.
      </p>
      <div>
        <Button variant="danger" onClick={openDialog}>
          Supprimer mon compte…
        </Button>
      </div>
      <Modal
        open={open}
        title="Supprimer définitivement le compte"
        onClose={() => !busy && setOpen(false)}
        closeOnBackdrop={false}
        footer={
          <>
            {step === 1 ? (
              <>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Annuler
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setStep(2)}
                  disabled={!reasonsOk}
                >
                  Continuer
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setStep(1)}
                  disabled={busy}
                >
                  ← Retour
                </Button>
                <Button
                  variant="danger"
                  onClick={submit}
                  loading={busy}
                  disabled={!ready}
                >
                  Tout supprimer
                </Button>
              </>
            )}
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        {step === 1 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-900">
              Pourquoi voulez-vous quitter ? (une ou plusieurs réponses)
            </p>
            <div className="space-y-1.5">
              {DELETION_REASONS.map((r) => (
                <label
                  key={r.code}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 has-[:checked]:border-red-300 has-[:checked]:bg-red-50"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-red-600"
                    checked={reasons.includes(r.code)}
                    onChange={() => toggle(r.code)}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
            {wantsOther && (
              <Field label="Dites-nous en quelques mots">
                <Textarea
                  rows={3}
                  maxLength={1000}
                  value={otherReason}
                  onChange={(e) => setOtherReason(e.target.value)}
                  placeholder="Votre raison…"
                  autoFocus
                />
              </Field>
            )}
            <p className="text-xs text-gray-500">
              Votre réponse est transmise à l&apos;éditeur du logiciel pour
              l&apos;aider à s&apos;améliorer.
            </p>
          </div>
        ) : (
          <>
            <Alert tone="amber">
              Toutes les données de <strong>{name}</strong> seront effacées pour
              tous les utilisateurs et tous les appareils. Pensez à exporter ce
              dont vous avez besoin (rapports, factures) avant de continuer.
            </Alert>
            <Field label={`Recopiez le nom de l'entreprise : ${name}`}>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Votre mot de passe">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
          </>
        )}
      </Modal>
    </Card>
  );
}

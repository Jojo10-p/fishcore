"use client";

import { useState } from "react";
import { clearSessionCache, useSession } from "@/components/app/session-provider";
import { Alert, Button, Card, Field, Input, Modal } from "@/components/ui";
import { apiSend, errorMessage } from "@/lib/client/api";
import { applyBrand } from "@/lib/client/brand";
import { getOfflineDB } from "@/lib/offline/db";
import { getPendingSyncCount } from "@/lib/offline/sync";

/** Zone dangereuse des paramètres : suppression définitive du compte (propriétaire). */
export function DeleteAccountCard() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session?.company || session.user.role !== "COMPANY_OWNER") return null;
  const name = session.company.tradeName;
  const ready = password.length > 0 && confirmName.trim().toLowerCase() === name.trim().toLowerCase();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const pending = await getPendingSyncCount().catch(() => 0);
      if (pending > 0 && !window.confirm(`${pending} vente(s) ou opération(s) de cet appareil ne sont pas encore envoyées. Elles seront perdues. Continuer ?`)) {
        setBusy(false);
        return;
      }
      await apiSend("/api/company/delete", { password, confirmName });
      // Rien ne reste sur cet appareil : identité, nom/logo, données hors ligne
      clearSessionCache();
      applyBrand(null);
      try {
        await getOfflineDB().delete();
        localStorage.clear();
      } catch {
        /* ignore */
      }
      window.location.replace("/register?compte=supprime");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-6 space-y-3 border-red-200">
      <h2 className="font-semibold text-red-700">Supprimer le compte</h2>
      <p className="text-sm text-gray-600">
        Supprime définitivement <strong>{name}</strong> et toutes ses données : centres, caisses, articles, stocks, ventes, factures, devis,
        clients, fournisseurs, dépenses, utilisateurs et logo. Cette action est irréversible. L&apos;adresse e-mail pourra servir aussitôt à une nouvelle
        inscription.
      </p>
      <div>
        <Button variant="danger" onClick={() => setOpen(true)}>
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
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Annuler
            </Button>
            <Button variant="danger" onClick={submit} loading={busy} disabled={!ready}>
              Tout supprimer
            </Button>
          </>
        }
      >
        {error && <Alert>{error}</Alert>}
        <Alert tone="amber">
          Toutes les données de <strong>{name}</strong> seront effacées pour tous les utilisateurs et tous les appareils. Pensez à exporter ce dont vous
          avez besoin (rapports, factures) avant de continuer.
        </Alert>
        <Field label={`Recopiez le nom de l'entreprise : ${name}`}>
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Votre mot de passe">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
      </Modal>
    </Card>
  );
}

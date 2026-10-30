"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Modal } from "@/components/ui";
import { apiSend, errorMessage } from "@/lib/client/api";

/** « Changer mon mot de passe » : les autres appareils connectés sont déconnectés. */
export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const close = () => {
    setOpen(false);
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setError(null);
    setDone(false);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/auth/password", form);
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="w-full text-left text-sm text-gray-700 hover:bg-gray-100 rounded-lg px-3 py-2">
        🔒 Changer mon mot de passe
      </button>
      <Modal
        open={open}
        title="Changer mon mot de passe"
        onClose={close}
        footer={
          done ? (
            <Button onClick={close}>Fermer</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>
                Annuler
              </Button>
              <Button onClick={submit} loading={busy} disabled={!form.currentPassword || !form.newPassword || form.newPassword !== form.confirmPassword}>
                Enregistrer
              </Button>
            </>
          )
        }
      >
        {error && <Alert>{error}</Alert>}
        {done ? (
          <Alert tone="green">Mot de passe changé. Vos autres appareils ont été déconnectés ; celui-ci reste connecté.</Alert>
        ) : (
          <>
            <Field label="Mot de passe actuel">
              <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={set("currentPassword")} />
            </Field>
            <Field label="Nouveau mot de passe" hint="8 caractères minimum, dont une majuscule et un chiffre.">
              <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={set("newPassword")} />
            </Field>
            <Field label="Confirmer" error={form.confirmPassword && form.confirmPassword !== form.newPassword ? "Les deux saisies diffèrent" : undefined}>
              <Input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set("confirmPassword")} />
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}

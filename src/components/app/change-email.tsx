"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Modal } from "@/components/ui";
import { apiSend, errorMessage } from "@/lib/client/api";
import { clearSessionCache } from "@/components/app/session-provider";

/** « Changer mon adresse e-mail » : même mot de passe, seule l'adresse de connexion change. */
export function ChangeEmailButton({ currentEmail }: { currentEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ newEmail: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.newEmail.trim());

  const close = () => {
    setOpen(false);
    setForm({ newEmail: "", password: "" });
    setError(null);
    if (done) {
      clearSessionCache();
      window.location.reload();
    }
    setDone(null);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: { email: string } }>("/api/auth/email", form);
      setDone(r.data.email);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="w-full text-left text-sm text-gray-700 hover:bg-gray-100 rounded-lg px-3 py-2">
        ✉️ Changer mon adresse e-mail
      </button>
      <Modal
        open={open}
        title="Changer mon adresse e-mail"
        onClose={close}
        footer={
          done ? (
            <Button onClick={close}>Fermer</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>
                Annuler
              </Button>
              <Button onClick={submit} loading={busy} disabled={!valid || !form.password}>
                Enregistrer
              </Button>
            </>
          )
        }
      >
        {error && <Alert>{error}</Alert>}
        {done ? (
          <Alert tone="green">C&apos;est fait. À partir de maintenant, connectez-vous avec {done} et le même mot de passe.</Alert>
        ) : (
          <>
            {currentEmail && <p className="text-sm text-gray-500">Adresse actuelle : {currentEmail}</p>}
            <Field label="Nouvelle adresse e-mail">
              <Input type="email" autoComplete="email" value={form.newEmail} onChange={set("newEmail")} placeholder="vous@exemple.com" />
            </Field>
            <Field label="Votre mot de passe" hint="Pour confirmer que c'est bien vous.">
              <Input type="password" autoComplete="current-password" value={form.password} onChange={set("password")} />
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}

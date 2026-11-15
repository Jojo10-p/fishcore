"use client";

import { useState } from "react";
import { Button, Field, Input, Modal } from "@/components/ui";
import { apiSend } from "@/lib/client/api";
import { useSession } from "@/components/app/session-provider";

/**
 * « Ajouter une boutique » : réservé au super administrateur.
 * Chaque boutique a sa caisse, son stock, ses employés et son historique ;
 * le tableau de bord montre une boutique ou la vue d'ensemble.
 */
export function AddBoutiqueButton({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { session, refresh, setCenterId } = useSession();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", city: "", address: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session?.user.isSuperAdmin) return null;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const close = () => {
    setOpen(false);
    setError(null);
  };
  const save = async () => {
    if (f.name.trim().length < 2) return setError("Donnez un nom à la boutique (ex. : Cotonou, Calavi…)");
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: { id: string } }>("/api/centers", {
        name: f.name.trim(),
        city: f.city.trim() || undefined,
        address: f.address.trim() || undefined,
        phone: f.phone.trim() || undefined,
      });
      await refresh();
      setCenterId(r.data.id);
      setF({ name: "", city: "", address: "", phone: "" });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ||
          `flex w-full items-center gap-2 rounded-lg border border-dashed border-blue-300 px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50 ${compact ? "justify-center" : ""}`
        }
      >
        <span aria-hidden className="text-base leading-none">＋</span> Ajouter une boutique
      </button>
      <Modal
        open={open}
        title="Nouvelle boutique"
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Annuler
            </Button>
            <Button onClick={() => void save()} loading={busy}>
              Ouvrir la boutique
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
            La nouvelle boutique a sa propre caisse, son stock, ses employés et son historique. Vous passez d&apos;une boutique à l&apos;autre, ou voyez tout dans la vue d&apos;ensemble.
          </p>
          {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <Field label="Nom de la boutique">
            <Input value={f.name} onChange={set("name")} placeholder="Ex. : Cotonou, Calavi, Tokan…" autoFocus />
          </Field>
          <Field label="Ville (facultatif)">
            <Input value={f.city} onChange={set("city")} placeholder="Cotonou" />
          </Field>
          <Field label="Adresse (facultatif)">
            <Input value={f.address} onChange={set("address")} />
          </Field>
          <Field label="Téléphone (facultatif)">
            <Input type="tel" value={f.phone} onChange={set("phone")} placeholder="+229 …" />
          </Field>
        </div>
      </Modal>
    </>
  );
}

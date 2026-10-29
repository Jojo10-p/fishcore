"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { Field, Select } from "@/components/ui";
import { apiGet } from "@/lib/client/api";

interface OpenSession {
  id: string;
  cashierId: string;
  cashRegister: { name: string };
  cashier: { firstName: string; lastName: string };
}

/**
 * Choix de la caisse ouverte d'où sortent (ou où entrent) des espèces.
 * « Hors caisse » = coffre, banque, poche du gérant… : la clôture n'en tient pas compte.
 * Si l'utilisateur a lui-même une caisse ouverte, elle est présélectionnée :
 * c'est le cas du caissier qui encaisse un règlement au comptoir.
 */
export function DrawerSelect({
  centerId,
  value,
  onChange,
  direction,
}: {
  centerId: string | null;
  value: string;
  onChange: (sessionId: string) => void;
  direction: "in" | "out";
}) {
  const { session } = useSession();
  const userId = session?.user.id;
  const [sessions, setSessions] = useState<OpenSession[]>([]);

  useEffect(() => {
    if (!centerId) return;
    let cancelled = false;
    apiGet<{ data: OpenSession[] }>(`/api/cash/sessions?open=true&centerId=${centerId}`)
      .then((r) => {
        if (cancelled) return;
        setSessions(r.data);
        const mine = r.data.find((s) => s.cashierId === userId);
        if (mine) onChange(mine.id);
      })
      .catch(() => !cancelled && setSessions([]));
    return () => {
      cancelled = true;
    };
    // onChange volontairement hors dépendances : présélection unique au chargement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId, userId]);

  return (
    <Field
      label={direction === "out" ? "Argent pris dans" : "Argent mis dans"}
      hint="Choisir une caisse ouverte la fait apparaître dans sa clôture."
    >
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Hors caisse (coffre, banque…)</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.cashRegister.name} — {s.cashier.firstName} {s.cashier.lastName}
          </option>
        ))}
      </Select>
    </Field>
  );
}

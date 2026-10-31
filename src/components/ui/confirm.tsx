"use client";
import * as React from "react";
import { Button, type ButtonProps } from "./button";
import { Dialog } from "./dialog";

/** Bouton qui demande confirmation avant d'exécuter une action sensible. */
export function ConfirmButton({ onConfirm, title, description, confirmLabel = "Confirmer", children, tone = "danger", ...btn }: Omit<ButtonProps, "onClick"> & { onConfirm: () => Promise<void> | void; title: string; description?: string; confirmLabel?: string; tone?: "danger" | "primary" }) {
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button type="button" {...btn} onClick={() => setOpen(true)}>{children}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            size="sm"
            loading={pending}
            onClick={() => start(async () => { await onConfirm(); setOpen(false); })}
          >
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

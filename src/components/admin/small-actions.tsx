"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";

/** Bouton déclenchant une Server Action simple (avec confirmation optionnelle). */
export function ActionButton({ run, children, confirm, ...btn }: Omit<ButtonProps, "onClick"> & { run: () => Promise<{ ok: boolean; message: string } | void>; confirm?: { title: string; description?: string; label?: string; danger?: boolean } }) {
  const [pending, start] = useTransition();
  const exec = async () => {
    const r = await run();
    if (r) (r.ok ? toast.success : toast.error)(r.message);
  };
  if (confirm) return <ConfirmButton {...btn} title={confirm.title} description={confirm.description} confirmLabel={confirm.label} tone={confirm.danger ? "danger" : "primary"} onConfirm={exec}>{children}</ConfirmButton>;
  return <Button {...btn} loading={pending} onClick={() => start(exec)}>{children}</Button>;
}

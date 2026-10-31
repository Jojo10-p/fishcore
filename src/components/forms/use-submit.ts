"use client";
import { startTransition, type FormEvent } from "react";

/**
 * React 19 réinitialise les champs non contrôlés après une action de formulaire,
 * y compris en cas d'erreur de validation. On soumet donc manuellement pour
 * préserver la saisie de l'utilisateur ; la réinitialisation se fait explicitement en cas de succès.
 */
export function submitWith(formAction: (fd: FormData) => void, guard?: (e: FormEvent<HTMLFormElement>) => boolean) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (guard && !guard(e)) return;
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(fd));
  };
}

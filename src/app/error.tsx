"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Une erreur est survenue</h1>
        <p className="mt-2 text-ink-soft">L'opération n'a pas pu aboutir. Réessayez ; si le problème persiste, contactez-nous{error.digest ? ` en indiquant le code ${error.digest}` : ""}.</p>
        <Button className="mt-6" onClick={reset}>Réessayer</Button>
      </div>
    </div>
  );
}

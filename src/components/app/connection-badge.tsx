"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** État réseau du navigateur. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/** Indicateur de connexion toujours visible (cahier §20). */
export function ConnectionBadge({ compact = false }: { compact?: boolean }) {
  const online = useOnline();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        online ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", online ? "bg-green-500" : "bg-red-500")} />
      {compact ? (online ? "En ligne" : "Hors ligne") : online ? "Connecté au serveur" : "Hors connexion — saisie locale"}
    </span>
  );
}

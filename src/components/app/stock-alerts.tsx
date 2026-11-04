"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session-provider";
import { cn } from "@/lib/utils";

// Nombre d'alertes de stock non lues, partagé par la cloche, le menu et le
// tableau de bord (une seule requête toutes les 60 s, relancée à la demande).

let count = 0;
let started = false;
const subs = new Set<(n: number) => void>();

export async function refreshStockAlertCount() {
  try {
    const r = await fetch("/api/stock-alerts", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    count = j?.data?.unread ?? 0;
    subs.forEach((s) => s(count));
  } catch {
    /* hors connexion : on garde le dernier chiffre */
  }
}

export function useStockAlertCount(): number {
  const { can, session } = useSession();
  const enabled = !!session?.company && can("stock:view");
  const [n, setN] = useState(count);
  useEffect(() => {
    if (!enabled) return;
    subs.add(setN);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!started) {
      started = true;
      void refreshStockAlertCount();
      timer = setInterval(() => void refreshStockAlertCount(), 60_000);
    }
    return () => {
      subs.delete(setN);
      if (timer && subs.size === 0) {
        clearInterval(timer);
        started = false;
      }
    };
  }, [enabled]);
  return enabled ? n : 0;
}

/** Cloche des alertes de stock (barre du haut). */
export function StockAlertBell({ className }: { className?: string }) {
  const n = useStockAlertCount();
  const { can } = useSession();
  if (!can("stock:view")) return null;
  return (
    <Link
      href="/alertes"
      aria-label={n ? `${n} alerte(s) de stock non lue(s)` : "Alertes de stock"}
      title="Alertes de stock"
      className={cn("relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg hover:bg-gray-50", className)}
    >
      <span aria-hidden>🔔</span>
      {n > 0 && (
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white ring-2 ring-white">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </Link>
  );
}

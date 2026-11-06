"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/client/api";

interface Notif {
  id: string;
  createdAt: string;
  type: string;
  title: string;
  message: string;
  data: { link?: string | null } | null;
  isRead: boolean;
}

const ICONS: Record<string, string> = {
  STOCK_ADDED: "🚚",
  PRICE_CHANGED: "🏷️",
  PRODUCT_CREATED: "✨",
  CANCEL_REQUESTED: "↩️",
  CANCEL_DECIDED: "✅",
  CASH_CLOSED: "💰",
};

function ago(iso: string) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24 && d.toDateString() === new Date().toDateString()) return `il y a ${h} h`;
  return `${d.toLocaleDateString("fr-FR")} à ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Cloche (façon Facebook) : ajouts de stock, prix changés, demandes d'annulation,
 * caisses fermées… Rien ne s'efface : « Vu » marque seulement comme lu.
 * Interroge le serveur toutes les 30 s (ce qui garde aussi l'utilisateur « en ligne »).
 */
export function NotificationBell({ align = "right" }: { align?: "left" | "right" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ data: { items: Notif[]; unread: number } }>("/api/notifications?take=30");
      setItems((old) => {
        // Garde les plus anciennes déjà chargées (« Voir plus »)
        const fresh = new Set(r.data.items.map((i) => i.id));
        return [...r.data.items, ...old.filter((o) => !fresh.has(o.id) && new Date(o.createdAt) < new Date(r.data.items.at(-1)?.createdAt ?? 0))];
      });
      setUnread(r.data.unread);
      if (r.data.items.length < 30) setMore(false);
    } catch {
      // hors ligne : on réessaiera
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const markRead = async (ids: string[] | "all") => {
    setItems((list) => list.map((i) => (ids === "all" || ids.includes(i.id) ? { ...i, isRead: true } : i)));
    setUnread((u) => (ids === "all" ? 0 : Math.max(0, u - items.filter((i) => ids.includes(i.id) && !i.isRead).length)));
    await apiSend("/api/notifications", ids === "all" ? { all: true } : { ids }, "POST").catch(() => undefined);
  };

  const loadMore = async () => {
    const last = items.at(-1);
    if (!last) return;
    const r = await apiGet<{ data: { items: Notif[] } }>(`/api/notifications?take=30&before=${encodeURIComponent(last.createdAt)}`).catch(() => null);
    if (!r) return;
    setItems((list) => [...list, ...r.data.items]);
    if (r.data.items.length < 30) setMore(false);
  };

  const openItem = (n: Notif) => {
    if (!n.isRead) void markRead([n.id]);
    setOpen(false);
    if (n.data?.link) router.push(n.data.link);
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg hover:bg-gray-50"
        aria-label={`Notifications${unread ? ` (${unread} non lues)` : ""}`}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className={`absolute z-50 mt-2 w-[22rem] max-w-[92vw] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl ${align === "right" ? "right-0" : "left-0"}`}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="font-semibold text-gray-900">Notifications</p>
            {unread > 0 && (
              <button className="text-sm text-blue-600 hover:underline" onClick={() => void markRead("all")}>
                Tout marquer comme vu
              </button>
            )}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-500">Aucune notification pour le moment.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-gray-50 ${n.isRead ? "" : "bg-blue-50/60"}`}
                    >
                      <span className="text-xl" aria-hidden>
                        {ICONS[n.type] ?? "🔔"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${n.isRead ? "text-gray-800" : "font-semibold text-gray-900"}`}>{n.title}</span>
                        <span className="block text-sm text-gray-600">{n.message}</span>
                        <span className="mt-0.5 block text-xs text-gray-400">{ago(n.createdAt)}</span>
                      </span>
                      {!n.isRead && <span className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full bg-blue-600" aria-label="Non lue" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {more && items.length >= 30 && (
              <button className="w-full border-t border-gray-100 py-3 text-sm text-blue-600 hover:bg-gray-50" onClick={() => void loadMore()}>
                Voir plus anciennes
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

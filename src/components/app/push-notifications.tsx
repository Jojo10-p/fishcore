"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card } from "@/components/ui";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/app/session-provider";
import { LOW_STOCK_THRESHOLD } from "@/lib/app-config";

// Carte « Alertes de stock sur ce téléphone » (gérant et patron uniquement).
// Android : notification avec vibreur, même application fermée.
// iPhone : il faut d'abord installer l'application sur l'écran d'accueil.

type State = "loading" | "hidden" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "server-off";

interface PushInfo {
  allowed: boolean;
  configured: boolean;
  publicKey: string | null;
  devices: number;
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  // En développement, le service worker n'est pas enregistré automatiquement
  return navigator.serviceWorker.register("/sw.js?v=push", { scope: "/" }).catch(() => null);
}

export function PushNotificationsCard() {
  const { session } = useSession();
  const [state, setState] = useState<State>("loading");
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<{ data: PushInfo }>("/api/push");
      const i = res.data;
      setInfo(i);
      if (!i.allowed) return setState("hidden");
      if (!i.configured || !i.publicKey) return setState("server-off");
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
        return setState(ios && !standalone ? "ios-install" : "unsupported");
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await registration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub && Notification.permission === "granted") {
        // On renvoie l'abonnement au serveur (il a pu être retiré entre-temps)
        await apiSend("/api/push", sub.toJSON()).catch(() => undefined);
        return setState("on");
      }
      setState("off");
    } catch {
      setState("hidden");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const enable = async () => {
    if (!info?.publicKey) return;
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registration();
      if (!reg) throw new Error("Service worker indisponible");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) }));
      await apiSend("/api/push", sub.toJSON());
      setState("on");
      await apiSend("/api/push/test", {}).catch(() => undefined);
      setMsg({ tone: "green", text: "C'est activé. Une notification d'essai vient d'être envoyée." });
    } catch (e) {
      setMsg({ tone: "red", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await apiSend("/api/push/test", {});
      setMsg({ tone: "green", text: "Notification d'essai envoyée." });
    } catch (e) {
      setMsg({ tone: "red", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await registration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await apiSend("/api/push", { endpoint: sub.endpoint }, "DELETE").catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
      setMsg(null);
    } finally {
      setBusy(false);
    }
  };

  if (!session || state === "loading" || state === "hidden") return null;

  if (state === "on") {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3 sm:px-5">
        <p className="text-sm text-gray-700">
          🔔 <strong>Alertes de stock activées</strong> sur cet appareil.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={test} loading={busy}>
            Tester
          </Button>
          <Button variant="ghost" onClick={disable} disabled={busy}>
            Désactiver
          </Button>
        </div>
        {msg && <div className="w-full"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 bg-blue-50 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-800">
          <p className="text-base font-semibold text-gray-900">🔔 Recevoir les alertes de stock sur ce téléphone</p>
          <p className="mt-1">
            Notification avec vibreur quand un article descend à {LOW_STOCK_THRESHOLD}, puis à chaque vente, et quand la moitié du stock est vendue.
          </p>
          {state === "denied" && (
            <p className="mt-2 text-red-700">
              Les notifications sont bloquées pour ce site. Ouvrez les réglages du navigateur (cadenas à côté de l&apos;adresse) › Notifications › Autoriser, puis rechargez la page.
            </p>
          )}
          {state === "ios-install" && (
            <p className="mt-2 text-amber-800">Sur iPhone : touchez Partager › « Sur l&apos;écran d&apos;accueil », ouvrez l&apos;application installée, puis activez ici.</p>
          )}
          {state === "unsupported" && <p className="mt-2 text-amber-800">Ce navigateur ne gère pas les notifications. Sur Android, utilisez Chrome.</p>}
          {state === "server-off" && <p className="mt-2 text-amber-800">Les notifications ne sont pas encore configurées sur le serveur.</p>}
        </div>
        {state === "off" && (
          <Button onClick={enable} loading={busy} className="shrink-0">
            Activer les alertes
          </Button>
        )}
      </div>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </Card>
  );
}

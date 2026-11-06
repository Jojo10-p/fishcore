/* GJH Gestion — Service worker (cahier §11, §19)
 *
 * Objectif : après une coupure d'Internet ou un redémarrage sans réseau,
 * l'application (et surtout la caisse) doit encore s'ouvrir.
 *
 * Stratégies :
 *  - Pages (navigation)      : réseau d'abord, copie en cache ; sans réseau → copie en cache, sinon /offline.html
 *  - /_next/static, /icons   : cache d'abord (fichiers versionnés, immuables)
 *  - /api/brand/*.png?v=…    : cache d'abord (logo de l'entreprise, adresse versionnée)
 *  - /api/*                  : JAMAIS mis en cache (les données hors ligne sont dans IndexedDB)
 *
 * Version : celle du déploiement (/sw.js?v=<commit>). Chaque mise en production
 * installe un cache neuf et supprime l'ancien. À l'installation, la caisse ET
 * ses fichiers JavaScript/CSS sont mis en cache : elle s'ouvre hors ligne même
 * si personne ne l'a rouverte depuis la mise à jour.
 */
const VERSION = `fishcore-${new URL(self.location.href).searchParams.get("v") || "v1"}`;
const PAGES_CACHE = `${VERSION}-pages`;
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE_PAGES = ["/caisse", "/offline.html"];
const PRECACHE_FILES = ["/icons/gjh-logo.png", "/icons/gjh-ticket.png", "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

async function precache() {
  const pages = await caches.open(PAGES_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  await Promise.allSettled(PRECACHE_FILES.map((f) => statics.add(f)));
  await Promise.allSettled(
    PRECACHE_PAGES.map(async (url) => {
      const response = await fetch(url, { credentials: "include" });
      // Une page protégée renvoie vers /login : on ne la garde pas
      if (!response.ok || response.redirected) return;
      await pages.put(url, response.clone());
      // Fichiers de la page (JS, CSS) : cachés tout de suite
      const html = await response.text();
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) || [])];
      await Promise.allSettled(assets.map((a) => statics.add(a)));
    })
  );
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Logo de l'entreprise : adresse versionnée, donc immuable → disponible hors ligne
  if (url.pathname.startsWith("/api/brand/") && url.pathname.endsWith(".png") && url.searchParams.has("v")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.pathname.startsWith("/api/")) return; // données : toujours le réseau

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    // On ne garde que les vraies pages (pas les redirections vers /login)
    if (response.ok && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (await cache.match("/offline.html"));
    return cached || new Response("Hors connexion", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

// ── Notifications (alertes de stock pour le gérant et le patron) ──────────
// « Presque épuisé » : vibre, reste affichée jusqu'à « Bien reçu ».
// « Moitié vendue »  : vibre brièvement et disparaît d'elle-même.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: "GJH Gestion", body: event.data ? event.data.text() : "" };
  }
  const ack = !!d.requireAck;
  const options = {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    vibrate: ack ? [500, 200, 500, 200, 500] : [250, 120, 250],
    requireInteraction: ack,
    actions: ack ? [{ action: "ack", title: "Bien reçu" }] : [],
    data: { url: d.url || "/dashboard" },
    timestamp: Date.now(),
  };
  const show = self.registration.showNotification(d.title || "GJH Gestion", options);
  if (ack || !d.tag) {
    event.waitUntil(show);
    return;
  }
  // Simple information : retirée au bout de quelques secondes
  event.waitUntil(
    show
      .then(() => new Promise((r) => setTimeout(r, 15000)))
      .then(() => self.registration.getNotifications({ tag: d.tag }))
      .then((list) => list.forEach((n) => n.close()))
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "ack") return; // « Bien reçu » : la notification part, c'est tout
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          if ("navigate" in c) c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

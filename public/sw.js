/* GJH Gestion — Service worker (cahier §11, §19)
 *
 * Objectif : sans Internet (coupure, ou application ouverte hors réseau), l'application
 * s'ouvre quand même : tableau de bord avec les derniers chiffres connus, caisse
 * (vente, ouverture de caisse), et les pages déjà consultées.
 *
 * Stratégies :
 *  - Pages (navigation)      : réseau d'abord (4 s au plus), copie en cache ; sinon la copie,
 *                              sinon /offline.html. « / » hors ligne → /dashboard.
 *  - /_next/static, /icons   : cache d'abord (fichiers versionnés, immuables)
 *  - /api/brand/*.png?v=…    : cache d'abord (logo de l'entreprise, adresse versionnée)
 *  - Quelques lectures /api  : réseau d'abord, dernière réponse gardée pour le hors ligne
 *                              (tableau de bord, notifications, stock, ventes…). Effacées
 *                              à la déconnexion. Les ventes hors ligne restent dans IndexedDB.
 *
 * « warm » (message de la page, une fois connecté) : met en cache les pages principales
 * et leurs fichiers, pour qu'elles s'ouvrent hors ligne même jamais visitées sur l'appareil.
 */
const VERSION = `fishcore-${new URL(self.location.href).searchParams.get("v") || "v1"}`;
const PAGES_CACHE = `${VERSION}-pages`;
const STATIC_CACHE = `${VERSION}-static`;
// Données : pas liées à la version (on garde les derniers chiffres après une mise à jour)
const DATA_CACHE = "fishcore-data";
const PRECACHE_PAGES = ["/caisse", "/offline.html"];
const WARM_PAGES = ["/dashboard", "/caisse", "/ventes", "/stock", "/receptions", "/depenses", "/rapport-journalier"];
const PRECACHE_FILES = ["/icons/gjh-logo.png", "/icons/gjh-ticket.png", "/icons/icon-192.png", "/manifest.webmanifest"];
// Lectures gardées pour le hors ligne (GET seulement)
const DATA_PATHS = [
  "/api/auth/me",
  "/api/reports/dashboard",
  "/api/notifications",
  "/api/stock",
  "/api/products",
  "/api/sales",
  "/api/cash/registers",
  "/api/cash/sessions",
  "/api/centers",
  "/api/expenses",
];
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(precache(PRECACHE_PAGES).then(() => self.skipWaiting()));
});

/** Met en cache des pages (avec la session de l'utilisateur) et leurs fichiers JS/CSS. */
async function precache(urls) {
  const pages = await caches.open(PAGES_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  await Promise.allSettled(PRECACHE_FILES.map((f) => statics.add(f)));
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url, { credentials: "include", cache: "no-store" });
      // Une page protégée renvoie vers /login : on ne la garde pas
      if (!response.ok || response.redirected) return false;
      await pages.put(url, response.clone());
      const html = await response.text();
      const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
      await Promise.allSettled(assets.map(async (a) => (await statics.match(a)) || statics.add(a)));
      return true;
    })
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "warm") {
    event.waitUntil(
      precache(WARM_PAGES).then((count) => {
        if (event.source && "postMessage" in event.source) event.source.postMessage({ type: "warmed", count });
      })
    );
  } else if (msg.type === "logout") {
    // Données de l'utilisateur : effacées à la déconnexion
    event.waitUntil(caches.delete(DATA_CACHE));
  }
});

// Nouvelle version : on garde aussi la précédente, au cas où le réseau tomberait
// avant que la nouvelle ait mis ses pages de côté ; les plus anciennes sont effacées.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const versions = [...new Set(keys.filter((k) => k !== DATA_CACHE).map((k) => k.replace(/-(pages|static)$/, "")))];
        const previous = versions.filter((v) => v !== VERSION).pop();
        const keep = new Set([VERSION, previous]);
        return Promise.all(keys.filter((k) => k !== DATA_CACHE && !keep.has(k.replace(/-(pages|static)$/, ""))).map((k) => caches.delete(k)));
      })
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
  if (url.pathname.startsWith("/api/")) {
    if (DATA_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"))) event.respondWith(networkFirstData(request));
    return; // autres données : toujours le réseau
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request, event));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    // Hors ligne : peut-être gardé par la version précédente
    const old = await caches.match(request);
    if (old) return old;
    throw error;
  }
}

/** Données : réseau d'abord ; sans réseau, la dernière réponse (marquée « x-offline-cache »). */
async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (!cached) throw error;
    const headers = new Headers(cached.headers);
    headers.set("x-offline-cache", cached.headers.get("date") || "1");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
}

/** Page : réseau d'abord, mais pas plus de 4 s (réseau très lent = comme hors ligne). */
async function networkFirstPage(request, event) {
  const cache = await caches.open(PAGES_CACHE);
  const url = new URL(request.url);
  const network = fetch(request).then((response) => {
    // On ne garde que les vraies pages (pas les redirections vers /login)
    if (response.ok && !response.redirected) cache.put(url.pathname, response.clone());
    return response;
  });
  // La page en cache reçoit quand même la version à jour en arrière-plan
  event.waitUntil(network.catch(() => undefined));
  const fallback = async () => {
    // Accueil hors ligne : on ouvre le tableau de bord
    if (url.pathname === "/") {
      const dash = (await cache.match("/dashboard")) || (await caches.match("/dashboard"));
      if (dash) return Response.redirect("/dashboard", 302);
    }
    return (
      (await cache.match(url.pathname)) ||
      (await cache.match(request, { ignoreSearch: true })) ||
      (await caches.match(url.pathname)) || // version précédente
      (await caches.match(request, { ignoreSearch: true })) ||
      (await cache.match("/offline.html")) ||
      new Response("Hors connexion", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    );
  };
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    // Trop lent : la copie si on l'a, sinon on attend quand même le réseau
    const cached = await cache.match(url.pathname);
    return cached || (await network);
  } catch {
    return fallback();
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

/* fishcore — Service worker (cahier §11, §19)
 *
 * Objectif : après une coupure d'Internet ou un redémarrage sans réseau,
 * l'application (et surtout la caisse) doit encore s'ouvrir.
 *
 * Stratégies :
 *  - Pages (navigation)      : réseau d'abord, copie en cache ; sans réseau → copie en cache, sinon /offline.html
 *  - /_next/static, /icons   : cache d'abord (fichiers versionnés, immuables)
 *  - /api/*                  : JAMAIS mis en cache (les données hors ligne sont dans IndexedDB)
 */
const VERSION = "fishcore-v1";
const PAGES_CACHE = `${VERSION}-pages`;
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE_PAGES = ["/caisse", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES_CACHE)
      // allSettled : une page protégée (redirection vers /login) ne bloque pas l'installation
      .then((cache) => Promise.allSettled(PRECACHE_PAGES.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

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

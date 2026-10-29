/* fishcore — Service worker (cahier §11, §19)
 *
 * Objectif : après une coupure d'Internet ou un redémarrage sans réseau,
 * l'application (et surtout la caisse) doit encore s'ouvrir.
 *
 * Stratégies :
 *  - Pages (navigation)      : réseau d'abord, copie en cache ; sans réseau → copie en cache, sinon /offline.html
 *  - /_next/static, /icons   : cache d'abord (fichiers versionnés, immuables)
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

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

async function precache() {
  const pages = await caches.open(PAGES_CACHE);
  const statics = await caches.open(STATIC_CACHE);
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

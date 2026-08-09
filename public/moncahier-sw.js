/* Mon Cahier — shell hors ligne stable + cache des assets + notifications push. */
const VERSION = "2026-08-09-pwa-stable-v5-5";
const OFFLINE_SCHEMA_VERSION = 1;
const CACHE_VERSION = "v2";
const CACHE_PREFIX = "moncahier-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-${CACHE_VERSION}`;
const OFFLINE_URL = "/moncahier-offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/login",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/badge-72.png",
];
const OFFLINE_PAGE_PATHS = new Set([
  "/login",
  "/choose-book",
  "/attendance",
  "/class",
  "/grades",
  "/grades/class-device",
  "/enseignant/cahier-de-texte",
  "/parents",
  "/admin/bulletins",
  "/admin/communication",
  "/admin/dashboard",
  "/admin/absences/appels",
  "/admin/absences/appels-matrice",
  "/founder/attendance-slots",
]);

function isOfflinePagePath(pathname) {
  return OFFLINE_PAGE_PATHS.has(pathname) || /^\/v\/[^/]+$/.test(pathname);
}

function isAssetPath(pathname) {
  return (
    pathname.startsWith("/_next/") ||
    /\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico|webmanifest)$/i.test(pathname)
  );
}

function isCacheable(response) {
  return Boolean(response && response.ok && response.type !== "opaque");
}

async function precacheApplicationFiles() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);

  await Promise.allSettled(
    PRECACHE_URLS.map(async (rawUrl) => {
      const request = new Request(rawUrl, { cache: "reload" });
      const response = await fetch(request);
      if (!isCacheable(response)) return;
      const target = isAssetPath(new URL(request.url).pathname) ? assets : shell;
      await target.put(request, response.clone());
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheApplicationFiles();
      // La page de connexion et ses chunks doivent être réellement utilisables
      // sans réseau, pas seulement son document HTML.
      await warmDocument("/login").catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

function isLegacyMonCahierCache(name) {
  return (
    name !== SHELL_CACHE &&
    name !== ASSET_CACHE &&
    (name.startsWith("moncahier-") || name.startsWith("moncahier:"))
  );
}

async function migrateLegacyCaches() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);
  const names = await caches.keys();
  const legacyNames = names.filter(isLegacyMonCahierCache);

  for (const name of legacyNames) {
    const source = await caches.open(name);
    const requests = await source.keys();
    for (const request of requests) {
      const response = await source.match(request);
      if (!response) continue;
      const pathname = new URL(request.url).pathname;
      const target = isAssetPath(pathname) ? assets : shell;
      if (!(await target.match(request))) {
        await target.put(request, response.clone());
      }
    }
  }

  await Promise.all(legacyNames.map((name) => caches.delete(name)));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Les pages déjà préparées sont copiées avant le nettoyage des anciens
      // caches. Un déploiement ne peut donc pas retirer l'écran /class hors ligne.
      await migrateLegacyCaches();
      await self.clients.claim();
    })(),
  );
});

async function fetchWithTimeout(request, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function navigationResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetchWithTimeout(request);
    if (response.status >= 500) throw new Error(`HTTP_${response.status}`);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(OFFLINE_URL)) ||
      new Response("Application indisponible hors connexion.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function assetResponse(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    return (
      cached ||
      new Response(null, { status: 504, statusText: "Application hors connexion" })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Les réponses API et toutes les mutations restent gérées par IndexedDB et
  // leurs contrats métier. Le service worker ne les met jamais en cache.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    if (isOfflinePagePath(url.pathname)) {
      event.respondWith(navigationResponse(request));
    }
    return;
  }

  if (isAssetPath(url.pathname)) {
    event.respondWith(assetResponse(request));
  }
});

async function warmDocument(rawUrl) {
  const url = new URL(rawUrl, self.location.origin);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (!isOfflinePagePath(url.pathname)) {
    throw new Error(`Page non autorisée dans le cache hors ligne : ${url.pathname}`);
  }

  const request = new Request(url.href, {
    method: "GET",
    credentials: "include",
    cache: "reload",
  });
  const response = await fetch(request);
  if (!isCacheable(response)) {
    throw new Error(`HTTP ${response.status} pour ${url.pathname}`);
  }
  if (response.redirected && new URL(response.url).pathname !== url.pathname) {
    throw new Error(`Session invalide pour ${url.pathname}`);
  }

  const shell = await caches.open(SHELL_CACHE);
  await shell.put(request, response.clone());

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return { pathname: url.pathname, asset_count: 0 };
  }

  const html = await response.text();
  const assetUrls = new Set();
  const attr = /(?:src|href)=["']([^"']+)["']/gi;
  let match;
  while ((match = attr.exec(html))) {
    try {
      const asset = new URL(match[1], url);
      if (asset.origin === self.location.origin && isAssetPath(asset.pathname)) {
        assetUrls.add(asset.href);
      }
    } catch {
      // Attribut non URL : ignoré.
    }
  }

  const assetCache = await caches.open(ASSET_CACHE);
  await Promise.all(
    Array.from(assetUrls).map(async (assetUrl) => {
      const assetRequest = new Request(assetUrl, { credentials: "include" });
      const assetResponseValue = await fetch(assetRequest);
      if (!isCacheable(assetResponseValue)) {
        throw new Error(
          `Ressource essentielle indisponible (${assetResponseValue.status}) : ${new URL(assetUrl).pathname}`,
        );
      }
      await assetCache.put(assetRequest, assetResponseValue.clone());
    }),
  );

  if (!(await shell.match(request))) {
    throw new Error(`Page essentielle absente du cache : ${url.pathname}`);
  }
  const missingAsset = (
    await Promise.all(
      Array.from(assetUrls).map(async (assetUrl) => {
        const cached = await assetCache.match(assetUrl);
        return cached ? null : new URL(assetUrl).pathname;
      }),
    )
  ).find(Boolean);
  if (missingAsset) {
    throw new Error(`Ressource essentielle absente du cache : ${missingAsset}`);
  }

  return { pathname: url.pathname, asset_count: assetUrls.size };
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "MON_CAHIER_GET_RELEASE") {
    event.ports?.[0]?.postMessage({
      ok: true,
      release: VERSION,
      offline_schema_version: OFFLINE_SCHEMA_VERSION,
      cache_version: CACHE_VERSION,
    });
    return;
  }

  if (event.data?.type === "MON_CAHIER_PURGE_ADMIN_LOCAL") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const requests = await cache.keys();
        const protectedPaths = new Set([
          "/admin/dashboard",
          "/admin/absences/appels",
          "/admin/absences/appels-matrice",
          "/founder/attendance-slots",
        ]);
        await Promise.all(
          requests.map((request) =>
            protectedPaths.has(new URL(request.url).pathname)
              ? cache.delete(request)
              : Promise.resolve(false),
          ),
        );
      })(),
    );
    return;
  }

  if (event.data?.type === "MON_CAHIER_PURGE_PARENT") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const requests = await cache.keys();
        await Promise.all(
          requests.map((request) => {
            const pathname = new URL(request.url).pathname;
            return pathname === "/parents" || /^\/v\/[^/]+$/.test(pathname)
              ? cache.delete(request)
              : Promise.resolve(false);
          }),
        );
      })(),
    );
    return;
  }

  if (event.data?.type !== "MON_CAHIER_WARM_SHELL") return;
  const port = event.ports?.[0];
  const urls = Array.isArray(event.data.urls) ? event.data.urls : [];

  event.waitUntil(
    (async () => {
      try {
        const verified = [];
        for (const url of urls) verified.push(await warmDocument(url));
        port?.postMessage({ ok: true, verified });
      } catch (error) {
        port?.postMessage({ ok: false, error: String(error?.message || error) });
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "Nouvelle notification" };
  }

  const title = payload.title || "Mon Cahier";
  const options = {
    body: payload.body || payload.message || "Nouvelle notification",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/badge-72.png",
    tag: payload.tag || undefined,
    data: { url: payload.url || payload.data?.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === targetUrl && "focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    })(),
  );
});

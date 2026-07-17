/* Mon Cahier — shell hors ligne + cache des assets + notifications push. */
const VERSION = "2026-07-17-offline-textbook-v3";
const CACHE_PREFIX = "moncahier-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-${VERSION}`;
const OFFLINE_URL = "/moncahier-offline.html";
const OFFLINE_PAGE_PATHS = new Set([
  "/attendance",
  "/class",
  "/grades",
  "/grades/class-device",
  "/enseignant/cahier-de-texte",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(CACHE_PREFIX) &&
              name !== SHELL_CACHE &&
              name !== ASSET_CACHE
          )
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function isCacheable(response) {
  return Boolean(response && response.ok && response.type !== "opaque");
}

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

  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Les réponses API sont gérées par IndexedDB avec leurs règles métier.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Ne jamais conserver automatiquement les pages parent/admin personnalisées.
    // Seuls les écrans pédagogiques explicitement préparés sont servis hors connexion.
    if (OFFLINE_PAGE_PATHS.has(url.pathname)) {
      event.respondWith(navigationResponse(request));
    }
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(assetResponse(request));
  }
});

async function warmDocument(rawUrl) {
  const url = new URL(rawUrl, self.location.origin);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (!OFFLINE_PAGE_PATHS.has(url.pathname)) {
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
  if (!contentType.includes("text/html")) return;

  const html = await response.text();
  const assets = new Set();
  const attr = /(?:src|href)=["']([^"']+)["']/gi;
  let match;
  while ((match = attr.exec(html))) {
    try {
      const asset = new URL(match[1], url);
      if (
        asset.origin === self.location.origin &&
        (asset.pathname.startsWith("/_next/") ||
          /\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)$/i.test(asset.pathname))
      ) {
        assets.add(asset.href);
      }
    } catch {
      // Attribut non URL : ignoré.
    }
  }

  const assetCache = await caches.open(ASSET_CACHE);
  await Promise.all(
    Array.from(assets).map(async (assetUrl) => {
      const assetRequest = new Request(assetUrl, { credentials: "include" });
      try {
        const assetResponseValue = await fetch(assetRequest);
        if (isCacheable(assetResponseValue)) {
          await assetCache.put(assetRequest, assetResponseValue.clone());
        }
      } catch {
        // Un asset déjà présent pourra toujours être servi par le cache runtime.
      }
    })
  );
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "MON_CAHIER_WARM_SHELL") return;
  const port = event.ports?.[0];
  const urls = Array.isArray(event.data.urls) ? event.data.urls : [];

  event.waitUntil(
    (async () => {
      try {
        for (const url of urls) await warmDocument(url);
        port?.postMessage({ ok: true });
      } catch (error) {
        port?.postMessage({ ok: false, error: String(error?.message || error) });
      }
    })()
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
    icon: payload.icon || "/icon.png",
    badge: payload.badge || "/icon.png",
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
    })()
  );
});

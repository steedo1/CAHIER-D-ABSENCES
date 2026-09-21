/* Mon Cahier — shell hors ligne stable + cache des assets + notifications push. */
const VERSION = "2026-09-21-attendance-background-sync-v1";
const OFFLINE_SCHEMA_VERSION = 1;
const CACHE_VERSION = "v2";
const CACHE_PREFIX = "moncahier-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-${CACHE_VERSION}`;
const OFFLINE_URL = "/moncahier-offline.html";
const OFFLINE_DB_NAME = "moncahier_offline_v1";
const OFFLINE_KV_STORE = "kv";
const OFFLINE_META_STORE = "meta";
const OFFLINE_OUTBOX_STORE = "outbox";
const ATTENDANCE_BACKGROUND_SYNC_TAG = "moncahier-attendance-outbox-v1";
const ATTENDANCE_CALL_OPERATION_TYPES = new Set([
  "session-start",
  "attendance",
  "session-end",
]);
const PRECACHE_URLS = [
  OFFLINE_URL,
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
  "/admin/notes/conseil-classe",
  "/admin/parents",
  "/admin/communication",
  "/admin/dashboard",
  "/admin/absences/appels",
  "/admin/absences/appels-matrice",
  "/founder/attendance-slots",
]);

function isOfflinePagePath(pathname) {
  return (
    OFFLINE_PAGE_PATHS.has(pathname) ||
    /^\/admin\/classes\/liste\/[^/]+$/.test(pathname) ||
    /^\/v\/[^/]+$/.test(pathname)
  );
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
      // La nouvelle version ne prend la main que si /login et tous ses assets
      // statiques ont été préparés. En cas d'échec, l'ancien worker complet
      // reste actif au lieu d'installer une version partielle.
      await warmDocument("/login");
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

      // Les appareils qui possèdent déjà une ancienne outbox bénéficient du
      // nouveau rejeu sans devoir créer une nouvelle mutation après la mise à jour.
      try {
        const syncManager = self.registration?.sync;
        if (syncManager && typeof syncManager.register === "function") {
          await syncManager.register(ATTENDANCE_BACKGROUND_SYNC_TAG);
        }
      } catch {
        // Background Sync n'est pas disponible partout ; les événements de page
        // restent le fallback.
      }
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

async function readOfflineKv(key) {
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value ?? null);
    };

    let request;
    try {
      request = indexedDB.open(OFFLINE_DB_NAME);
    } catch {
      finish(null);
      return;
    }

    request.onerror = () => finish(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_KV_STORE)) {
        db.close();
        finish(null);
        return;
      }

      let transaction;
      try {
        transaction = db.transaction([OFFLINE_KV_STORE], "readonly");
      } catch {
        db.close();
        finish(null);
        return;
      }

      const storeRequest = transaction.objectStore(OFFLINE_KV_STORE).get(key);
      storeRequest.onsuccess = () => finish(storeRequest.result?.value ?? null);
      storeRequest.onerror = () => finish(null);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        finish(null);
      };
      transaction.onabort = () => {
        db.close();
        finish(null);
      };
    };
  });
}


function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexeddb_request_failed"));
  });
}

function idbTransactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("indexeddb_transaction_failed"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("indexeddb_transaction_aborted"));
  });
}

async function openOfflineDbForAttendance() {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("offline_db_open_failed"));
  });
}

async function readAttendanceOutboxRows() {
  const db = await openOfflineDbForAttendance();
  try {
    if (!db.objectStoreNames.contains(OFFLINE_OUTBOX_STORE)) return [];
    const transaction = db.transaction([OFFLINE_OUTBOX_STORE], "readonly");
    const rows = await idbRequest(
      transaction.objectStore(OFFLINE_OUTBOX_STORE).getAll(),
    );
    await idbTransactionDone(transaction);
    return (Array.isArray(rows) ? rows : []).sort(
      (left, right) => Number(left?.createdAt || 0) - Number(right?.createdAt || 0),
    );
  } finally {
    db.close();
  }
}

async function patchAttendanceOutboxRow(id, patch) {
  const db = await openOfflineDbForAttendance();
  try {
    if (!db.objectStoreNames.contains(OFFLINE_OUTBOX_STORE)) return;
    const transaction = db.transaction([OFFLINE_OUTBOX_STORE], "readwrite");
    const store = transaction.objectStore(OFFLINE_OUTBOX_STORE);
    const current = await idbRequest(store.get(id));
    if (current) store.put({ ...current, ...patch });
    await idbTransactionDone(transaction);
  } finally {
    db.close();
  }
}

async function deleteAttendanceOutboxRow(id) {
  const db = await openOfflineDbForAttendance();
  try {
    if (!db.objectStoreNames.contains(OFFLINE_OUTBOX_STORE)) return;
    const transaction = db.transaction([OFFLINE_OUTBOX_STORE], "readwrite");
    transaction.objectStore(OFFLINE_OUTBOX_STORE).delete(id);
    await idbTransactionDone(transaction);
  } finally {
    db.close();
  }
}

async function readAttendanceSessionMap() {
  const db = await openOfflineDbForAttendance();
  try {
    if (!db.objectStoreNames.contains(OFFLINE_META_STORE)) return {};
    const transaction = db.transaction([OFFLINE_META_STORE], "readonly");
    const row = await idbRequest(
      transaction.objectStore(OFFLINE_META_STORE).get("sessionIdMap"),
    );
    await idbTransactionDone(transaction);
    return row?.value && typeof row.value === "object" ? { ...row.value } : {};
  } finally {
    db.close();
  }
}

async function writeAttendanceSessionMap(map) {
  const db = await openOfflineDbForAttendance();
  try {
    if (!db.objectStoreNames.contains(OFFLINE_META_STORE)) return;
    const transaction = db.transaction([OFFLINE_META_STORE], "readwrite");
    transaction.objectStore(OFFLINE_META_STORE).put({
      key: "sessionIdMap",
      value: map,
    });
    await idbTransactionDone(transaction);
  } finally {
    db.close();
  }
}

function attendanceOperationType(row) {
  const explicit = String(row?.meta?.operationType || "").trim();
  if (ATTENDANCE_CALL_OPERATION_TYPES.has(explicit)) return explicit;
  const url = String(row?.url || "");
  if (/\/api\/(?:class|teacher)\/sessions\/start(?:[/?]|$)/.test(url)) {
    return "session-start";
  }
  if (/\/api\/teacher\/attendance\/bulk(?:[/?]|$)/.test(url)) {
    return "attendance";
  }
  if (/\/api\/(?:class|teacher)\/sessions\/end(?:[/?]|$)/.test(url)) {
    return "session-end";
  }
  return null;
}

function attendancePathMatchesType(url, operationType) {
  if (url.origin !== self.location.origin) return false;
  if (operationType === "session-start") {
    return /^\/api\/(?:class|teacher)\/sessions\/start$/.test(url.pathname);
  }
  if (operationType === "attendance") {
    return url.pathname === "/api/teacher/attendance/bulk";
  }
  if (operationType === "session-end") {
    return /^\/api\/(?:class|teacher)\/sessions\/end$/.test(url.pathname);
  }
  return false;
}

function attendanceDependencyKey(row, body) {
  return String(
    row?.meta?.clientSessionId ||
      body?.client_session_id ||
      body?.session_id ||
      row?.body?.client_session_id ||
      row?.body?.session_id ||
      "",
  ).trim() || null;
}

function normalizedAttendanceDependency(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.startsWith("client:") ? text : `client:${text}`;
}

function rewriteAttendanceBodyWithMap(body, map) {
  if (!body || typeof body !== "object") return body;

  if (typeof body.session_id === "string" && body.session_id.startsWith("client:")) {
    const mapped = map[body.session_id];
    if (mapped) return { ...body, session_id: mapped };
  }

  if (typeof body.client_session_id === "string") {
    const key = body.client_session_id.startsWith("client:")
      ? body.client_session_id
      : `client:${body.client_session_id}`;
    const mapped = map[key];
    if (mapped) return { ...body, session_id: mapped };
  }

  return body;
}

function attendanceResponseOperationId(payload) {
  return String(
    payload?.operation_id ||
      payload?.item?.operation_id ||
      payload?.data?.operation_id ||
      payload?.data?.item?.operation_id ||
      "",
  ).trim();
}

function attendanceResponseSessionId(payload) {
  return String(
    payload?.session_id ||
      payload?.item?.id ||
      payload?.data?.session_id ||
      payload?.data?.item?.id ||
      "",
  ).trim();
}

async function responseJsonSafe(response) {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function attendanceRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function notifyAttendanceSyncClients(summary) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of windows) {
    client.postMessage({
      type: "MON_CAHIER_ATTENDANCE_BACKGROUND_SYNC",
      ...summary,
    });
  }
}

/**
 * Rejoue uniquement le journal des appels. Aucune note, sanction ou autre
 * mutation n'est envoyée par ce chemin.
 */
async function replayAttendanceOutboxFromWorker() {
  const rows = await readAttendanceOutboxRows();
  const callRows = rows.filter((row) =>
    ATTENDANCE_CALL_OPERATION_TYPES.has(attendanceOperationType(row)),
  );
  if (!callRows.length) {
    await notifyAttendanceSyncClients({ flushed: 0, remaining: 0 });
    return { flushed: 0, remaining: 0 };
  }

  const map = await readAttendanceSessionMap();
  const sessionsWaitingForStart = new Set(
    callRows
      .filter((row) => attendanceOperationType(row) === "session-start")
      .map((row) =>
        normalizedAttendanceDependency(attendanceDependencyKey(row, row.body)),
      )
      .filter(Boolean),
  );
  const blockedSessions = new Set();
  let flushed = 0;

  for (const row of callRows) {
    const operationType = attendanceOperationType(row);
    if (!operationType) continue;

    const originalBody = row?.body && typeof row.body === "object" ? row.body : row?.body;
    const body = rewriteAttendanceBodyWithMap(originalBody, map);
    const dependency = attendanceDependencyKey(row, body);
    const normalizedDependency = normalizedAttendanceDependency(dependency);

    // Un appel déjà bloqué lors d'une passe antérieure continue de protéger sa
    // fermeture. On ne doit jamais certifier une fin de séance si l'ouverture
    // ou les présences de cette même séance sont encore en conflit.
    if (row?.state === "blocked") {
      if (
        normalizedDependency &&
        (operationType === "session-start" || operationType === "attendance")
      ) {
        blockedSessions.add(normalizedDependency);
      }
      continue;
    }

    if (
      normalizedDependency &&
      blockedSessions.has(normalizedDependency) &&
      (operationType === "attendance" || operationType === "session-end")
    ) {
      continue;
    }
    if (
      normalizedDependency &&
      sessionsWaitingForStart.has(normalizedDependency) &&
      (operationType === "attendance" || operationType === "session-end")
    ) {
      continue;
    }

    let url;
    try {
      url = new URL(String(row?.url || ""), self.location.origin);
    } catch {
      await patchAttendanceOutboxRow(row.id, {
        state: "blocked",
        lastStatus: 400,
        lastError: "background_sync_invalid_url",
        lastAttemptAt: Date.now(),
      });
      continue;
    }

    if (!attendancePathMatchesType(url, operationType)) {
      await patchAttendanceOutboxRow(row.id, {
        state: "blocked",
        lastStatus: 400,
        lastError: "background_sync_operation_scope_mismatch",
        lastAttemptAt: Date.now(),
      });
      continue;
    }

    const headers = new Headers(row?.headers || {});
    headers.set("Accept", "application/json");
    if (body !== undefined && body !== null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (row?.operationId && !headers.has("X-Mon-Cahier-Operation-Id")) {
      headers.set("X-Mon-Cahier-Operation-Id", String(row.operationId));
    }

    let response;
    try {
      response = await fetch(url.href, {
        method: String(row?.method || "POST").toUpperCase(),
        credentials: "include",
        cache: "no-store",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      await patchAttendanceOutboxRow(row.id, {
        state: "pending",
        attempts: Number(row?.attempts || 0) + 1,
        lastAttemptAt: Date.now(),
        lastStatus: 0,
        lastError: String(error?.message || "background_sync_network_error"),
      });
      throw error;
    }

    const payload = await responseJsonSafe(response);
    if (!response.ok) {
      const errorCode = String(
        payload?.error || payload?.message || `HTTP_${response.status}`,
      ).slice(0, 256);
      const patch = {
        attempts: Number(row?.attempts || 0) + 1,
        lastAttemptAt: Date.now(),
        lastStatus: response.status,
        lastError: errorCode,
      };

      if (response.status === 401) {
        await patchAttendanceOutboxRow(row.id, {
          ...patch,
          state: "pending",
        });
        // Une nouvelle authentification utilisateur est nécessaire.
        break;
      }

      if (attendanceRetryableStatus(response.status)) {
        await patchAttendanceOutboxRow(row.id, {
          ...patch,
          state: "pending",
        });
        throw new Error(`attendance_background_retry_${response.status}`);
      }

      await patchAttendanceOutboxRow(row.id, {
        ...patch,
        state: "blocked",
      });
      if (
        normalizedDependency &&
        (operationType === "session-start" || operationType === "attendance")
      ) {
        blockedSessions.add(normalizedDependency);
      }
      continue;
    }

    const acknowledgedOperationId = attendanceResponseOperationId(payload);
    if (
      row?.operationId &&
      acknowledgedOperationId !== String(row.operationId)
    ) {
      await patchAttendanceOutboxRow(row.id, {
        state: "blocked",
        attempts: Number(row?.attempts || 0) + 1,
        lastAttemptAt: Date.now(),
        lastStatus: 409,
        lastError: acknowledgedOperationId
          ? "background_sync_operation_id_mismatch"
          : "background_sync_operation_id_missing",
      });
      if (normalizedDependency) blockedSessions.add(normalizedDependency);
      continue;
    }

    if (operationType === "session-start") {
      const serverSessionId = attendanceResponseSessionId(payload);
      if (normalizedDependency && serverSessionId) {
        const existing = String(map[normalizedDependency] || "").trim();
        if (existing && existing !== serverSessionId) {
          await patchAttendanceOutboxRow(row.id, {
            state: "blocked",
            attempts: Number(row?.attempts || 0) + 1,
            lastAttemptAt: Date.now(),
            lastStatus: 409,
            lastError: "background_sync_session_mapping_conflict",
          });
          blockedSessions.add(normalizedDependency);
          continue;
        }
        map[normalizedDependency] = serverSessionId;
        await writeAttendanceSessionMap(map);
        sessionsWaitingForStart.delete(normalizedDependency);
      }
    }

    await deleteAttendanceOutboxRow(row.id);
    flushed += 1;
  }

  const remaining = (await readAttendanceOutboxRows()).filter((row) =>
    ATTENDANCE_CALL_OPERATION_TYPES.has(attendanceOperationType(row)),
  ).length;
  await notifyAttendanceSyncClients({ flushed, remaining });
  return { flushed, remaining };
}

self.addEventListener("sync", (event) => {
  if (event.tag !== ATTENDANCE_BACKGROUND_SYNC_TAG) return;
  event.waitUntil(replayAttendanceOutboxFromWorker());
});

function jsonResponse(payload, status = 200, source = null) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store, max-age=0",
  };
  if (source) headers["X-Mon-Cahier-Offline-Source"] = source;
  return new Response(JSON.stringify(payload), { status, headers });
}

function requestPathFromReferrer(request) {
  try {
    return request.referrer ? new URL(request.referrer).pathname : "";
  } catch {
    return "";
  }
}

async function classDeviceSubjectsResponse(request, url) {
  const classId = String(url.searchParams.get("class_id") || "").trim();
  const slot = String(url.searchParams.get("slot") || "").trim();
  const fromClassDevice = requestPathFromReferrer(request) === "/class";

  if (!classId) return await fetch(request);

  // Le téléphone de classe ne doit jamais retomber sur la liste générale de
  // toutes les matières : sans créneau précis, aucune discipline n'est sûre.
  if (!slot && fromClassDevice) {
    return jsonResponse(
      { items: [], diagnostic: "class_device_subject_slot_required" },
      200,
      "class-device-fail-closed",
    );
  }

  if (!slot) return await fetch(request);

  let networkResponse = null;
  try {
    networkResponse = await fetchWithTimeout(request, 2500);
    // Les erreurs métier explicites restent l'autorité du Cloud. Seules les
    // pannes temporaires (5xx) basculent vers la préparation PWA du créneau.
    if (networkResponse.status < 500) return networkResponse;
  } catch {
    networkResponse = null;
  }

  const canonicalKey = `classDevice:subjects:${classId}:${slot}`;
  const prepared = await readOfflineKv(canonicalKey);
  if (prepared && Array.isArray(prepared.items)) {
    return jsonResponse(prepared, 200, "class-device-slot-cache");
  }

  // Fail-closed : un créneau non préparé ne doit surtout pas déclencher le
  // fallback historique qui affichait toutes les matières de la classe.
  if (fromClassDevice) {
    return jsonResponse(
      { items: [], diagnostic: "class_device_subject_slot_not_prepared" },
      200,
      "class-device-slot-missing",
    );
  }

  return (
    networkResponse ||
    jsonResponse(
      { error: "class_device_subject_slot_unavailable" },
      503,
      "class-device-slot-unavailable",
    )
  );
}

async function navigationResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetchWithTimeout(request);
    if (response.status >= 500) throw new Error(`HTTP_${response.status}`);

    // Une navigation en ligne ne publie jamais directement un nouveau HTML
    // dans le cache hors ligne. Les pages PWA sont publiées uniquement par
    // warmDocument(), après téléchargement et vérification de tous leurs chunks.
    // Cela évite qu'un retour sur /login remplace un shell complet par un HTML
    // dont un chunk Next dynamique n'a pas encore été conservé.
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

  // Exception bornée : le téléphone de classe peut relire dans IndexedDB la
  // matière déjà préparée pour LE créneau demandé. Aucune autre API n'est mise
  // en cache par le service worker.
  if (url.pathname === "/api/class/subjects") {
    event.respondWith(classDeviceSubjectsResponse(request, url));
    return;
  }

  // Les autres réponses API et toutes les mutations restent gérées par
  // IndexedDB et leurs contrats métier. Le service worker ne les met pas en cache.
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

function addDocumentAssetUrl(assetUrls, rawValue, documentUrl) {
  const value = String(rawValue || "").trim();
  if (!value) return;
  try {
    const asset = new URL(value, documentUrl);
    if (asset.origin === self.location.origin && isAssetPath(asset.pathname)) {
      assetUrls.add(asset.href);
    }
  } catch {
    // Référence non URL : ignorée.
  }
}

function extractDocumentAssetUrls(html, documentUrl) {
  const assetUrls = new Set();

  // 1) Ressources HTML classiques : <script src>, <link href>, images, etc.
  const attr = /(?:src|href)=["']([^"']+)["']/gi;
  let match;
  while ((match = attr.exec(html))) {
    addDocumentAssetUrl(assetUrls, match[1], documentUrl);
  }

  // 2) Next App Router annonce aussi des chunks dans les données Flight/RSC
  // intégrées aux <script> inline, sans src/href. Après un premier cycle
  // login -> class -> logout, ces chunks peuvent être redemandés au second
  // login. On normalise les slashs JSON échappés puis on collecte les chemins.
  const normalized = String(html || "")
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/");

  const absoluteNextAsset = /(?:https?:\/\/[^"'`\s<>]+)?\/_next\/static\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)(?:\?[^"'`\s<>]*)?/gi;
  while ((match = absoluteNextAsset.exec(normalized))) {
    addDocumentAssetUrl(assetUrls, match[0], documentUrl);
  }

  const flightAsset = /\bstatic\/(?:chunks|css|media)\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)(?:\?[^"'`\s<>]*)?/gi;
  while ((match = flightAsset.exec(normalized))) {
    addDocumentAssetUrl(assetUrls, `/_next/${match[0]}`, documentUrl);
  }

  return assetUrls;
}

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

  const responseForCache = response.clone();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    const shell = await caches.open(SHELL_CACHE);
    await shell.put(request, responseForCache);
    return { pathname: url.pathname, asset_count: 0 };
  }

  const html = await response.text();
  const assetUrls = extractDocumentAssetUrls(html, url);

  const downloadedAssets = await Promise.all(
    Array.from(assetUrls).map(async (assetUrl) => {
      const assetRequest = new Request(assetUrl, { credentials: "include" });
      const assetResponseValue = await fetch(assetRequest);
      if (!isCacheable(assetResponseValue)) {
        throw new Error(
          `Ressource essentielle indisponible (${assetResponseValue.status}) : ${new URL(assetUrl).pathname}`,
        );
      }
      return { assetRequest, assetResponseValue };
    }),
  );

  // Publication en deux temps : tous les assets doivent être téléchargés avant
  // que le nouveau document HTML remplace la dernière version fonctionnelle.
  const assetCache = await caches.open(ASSET_CACHE);
  await Promise.all(
    downloadedAssets.map(({ assetRequest, assetResponseValue }) =>
      assetCache.put(assetRequest, assetResponseValue),
    ),
  );
  const shell = await caches.open(SHELL_CACHE);
  await shell.put(request, responseForCache);

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
  if (event.data?.type === "MON_CAHIER_ATTENDANCE_SYNC_NOW") {
    event.waitUntil(
      replayAttendanceOutboxFromWorker().catch(() => {
        // Le journal reste intact ; Background Sync ou le prochain réveil retentera.
      }),
    );
    return;
  }

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
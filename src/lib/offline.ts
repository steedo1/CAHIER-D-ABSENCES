// src/lib/offline.ts
// Helpers Offline (client only) : cache JSON + outbox (mutations) + flush on reconnect.

type JsonValue = any;

import { MON_CAHIER_SERVICE_WORKER_RELEASE } from "@/lib/offline-release";

type KVRow = {
  key: string;
  value: JsonValue;
  updatedAt: number;
};

type OutboxRow = {
  id: string;
  operationId: string;
  url: string;
  method: string;
  body?: JsonValue;
  headers?: Record<string, string>;
  mergeKey?: string;
  createdAt: number;
  meta?: Record<string, any>;
  state?: "pending" | "blocked";
  attempts?: number;
  lastAttemptAt?: number;
  lastStatus?: number;
  lastError?: string;
};

export type LegacyTeacherAttendanceMutation = {
  id: string;
  operationId: string;
  body: JsonValue;
  state: "pending" | "blocked";
  lastStatus: number | null;
  lastError: string | null;
  createdAt: number;
};

type MutateInit = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: JsonValue;
  headers?: Record<string, string>;
};

type MutateOpts = {
  mergeKey?: string;
  meta?: Record<string, any>;
  operationId?: string;
};

export type MutateResult<T = any> =
  | { ok: true; data: T; status: number }
  | {
      ok: false;
      queued: true;
      offline: boolean;
      status: number;
      error?: string;
    }
  | { ok: false; queued: false; offline: false; status: number; error: string; data?: any };

export type OutboxStats = {
  total: number;
  pending: number;
  blocked: number;
  lastError: string | null;
  lastStatus: number | null;
};

export type FlushResult = {
  flushed: number;
  remaining: number;
  blocked: number;
  authRequired: boolean;
  retryableFailure: boolean;
  lastError: string | null;
  lastStatus: number | null;
};

const DB_NAME = "moncahier_offline_v1";
const DB_VERSION = 2;
const SW_BUILD = MON_CAHIER_SERVICE_WORKER_RELEASE;
export { MON_CAHIER_SERVICE_WORKER_RELEASE };
export const MON_CAHIER_SW_URL = `/moncahier-sw.js?v=${encodeURIComponent(SW_BUILD)}`;

let _dbPromise: Promise<IDBDatabase> | null = null;

function isBrowser() {
  return typeof window !== "undefined";
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function openDB(): Promise<IDBDatabase> {
  if (!isBrowser()) throw new Error("offline.ts must run in the browser");
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        const out = db.createObjectStore("outbox", { keyPath: "id" });
        out.createIndex("mergeKey", "mergeKey", { unique: false });
        out.createIndex("createdAt", "createdAt", { unique: false });
        out.createIndex("state", "state", { unique: false });
      } else {
        const out = req.transaction?.objectStore("outbox");
        if (out) {
          if (!out.indexNames.contains("mergeKey"))
            out.createIndex("mergeKey", "mergeKey", { unique: false });
          if (!out.indexNames.contains("createdAt"))
            out.createIndex("createdAt", "createdAt", { unique: false });
          if (!out.indexNames.contains("state"))
            out.createIndex("state", "state", { unique: false });
        }
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return _dbPromise;
}

/* ───────────────────────── KV cache ───────────────────────── */

export async function cacheGet<T = any>(key: string): Promise<T | null> {
  const db = await openDB();
  const tx = db.transaction(["kv"], "readonly");
  const store = tx.objectStore("kv");
  const row = await reqToPromise<KVRow | undefined>(store.get(key));
  await txDone(tx);
  return row ? (row.value as T) : null;
}

export async function cacheSet(key: string, value: any): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["kv"], "readwrite");
  const store = tx.objectStore("kv");
  const row: KVRow = { key, value, updatedAt: Date.now() };
  store.put(row);
  await txDone(tx);
}

export async function cacheDeleteByPrefixes(prefixes: string[]): Promise<void> {
  const normalized = Array.from(
    new Set(prefixes.map((value) => String(value || "").trim()).filter(Boolean)),
  );
  if (!normalized.length) return;

  const db = await openDB();
  const tx = db.transaction(["kv"], "readwrite");
  const store = tx.objectStore("kv");
  const keys = await reqToPromise<IDBValidKey[]>(store.getAllKeys());
  for (const key of keys) {
    if (
      typeof key === "string" &&
      normalized.some((prefix) => key.startsWith(prefix))
    ) {
      store.delete(key);
    }
  }
  await txDone(tx);
}

/* ───────────────────────── META (maps) ───────────────────────── */

async function metaGet<T = any>(key: string): Promise<T | null> {
  const db = await openDB();
  const tx = db.transaction(["meta"], "readonly");
  const store = tx.objectStore("meta");
  const row = await reqToPromise<{ key: string; value: any } | undefined>(store.get(key));
  await txDone(tx);
  return row ? (row.value as T) : null;
}

async function metaSet(key: string, value: any): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["meta"], "readwrite");
  const store = tx.objectStore("meta");
  store.put({ key, value });
  await txDone(tx);
}

async function getSessionIdMap(): Promise<Record<string, string>> {
  return (await metaGet<Record<string, string>>("sessionIdMap")) || {};
}

async function setSessionIdMap(next: Record<string, string>): Promise<void> {
  await metaSet("sessionIdMap", next);
}

export async function resolveOfflineSessionReference(sessionId: string): Promise<{
  sessionReference: string;
  serverSessionId: string | null;
}> {
  const normalized = String(sessionId || "").trim();
  if (!normalized) return { sessionReference: "", serverSessionId: null };

  const map = await getSessionIdMap();
  if (normalized.startsWith("client:")) {
    return {
      sessionReference: normalized,
      serverSessionId: String(map[normalized] || "").trim() || null,
    };
  }

  const clientEntry = Object.entries(map).find(([, serverId]) => serverId === normalized);
  return {
    sessionReference: clientEntry?.[0] || normalized,
    serverSessionId: normalized,
  };
}

/* ───────────────────────── Service Worker ───────────────────────── */

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isBrowser()) return null;
  if (!("serviceWorker" in navigator)) return null;

  try {
    // Une seule URL versionnée pour éviter que plusieurs écrans se remplacent
    // mutuellement le service worker avec des versions différentes.
    const registration = await navigator.serviceWorker.register(MON_CAHIER_SW_URL, { scope: "/" });
    await navigator.serviceWorker.ready;
    return registration;
  } catch {
    // Ne casse rien si SW indisponible
    return null;
  }
}

async function waitForOfflineWorker(
  registration: ServiceWorkerRegistration
): Promise<ServiceWorker | null> {
  const expectedScriptUrl = new URL(MON_CAHIER_SW_URL, window.location.href).href;
  const isExpected = (worker: ServiceWorker | null) =>
    Boolean(worker && worker.scriptURL === expectedScriptUrl);
  const findExpectedWorker = () =>
    [registration.installing, registration.waiting, registration.active].find(
      (worker): worker is ServiceWorker => isExpected(worker)
    ) || null;

  let candidate = findExpectedWorker();
  if (!candidate) {
    await registration.update();
    candidate = findExpectedWorker();
  }
  if (!candidate) return null;

  // Un worker installe et en attente peut deja recevoir la commande de
  // preparation. Cela permet de remplir son propre cache avant la fermeture
  // des pages encore controlees par l'ancienne version.
  if (candidate.state === "installed" || candidate.state === "activated") {
    return candidate;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Installation du service hors ligne trop longue.")),
      15_000
    );
    const check = () => {
      if (candidate.state === "installed" || candidate.state === "activated") {
        window.clearTimeout(timeout);
        resolve();
      } else if (candidate.state === "redundant") {
        window.clearTimeout(timeout);
        reject(new Error("Le service hors ligne n’a pas pu être activé."));
      }
    };
    candidate.addEventListener("statechange", check);
    check();
  });

  return isExpected(candidate) ? candidate : null;
}

/**
 * Demande au service worker de mettre en cache les pages et leurs chunks.
 * La préparation échoue explicitement si le shell ne peut pas être confirmé.
 */
export async function warmOfflineShell(urls: string[]): Promise<void> {
  if (!isBrowser()) return;
  if (!("serviceWorker" in navigator)) {
    throw new Error("Le mode hors ligne n’est pas pris en charge par ce navigateur.");
  }

  const registration = await registerServiceWorker();
  if (!registration) throw new Error("Le service hors ligne n’a pas pu être enregistré.");
  const worker = await waitForOfflineWorker(registration);
  if (!worker) throw new Error("Le service hors ligne n’est pas encore actif.");

  const normalized = Array.from(
    new Set(
      urls
        .map((url) => String(url || "").trim())
        .filter((url) => url.startsWith("/"))
    )
  );
  if (!normalized.length) return;

  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error("La préparation de l’application a expiré."));
    }, 30_000);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.ok) resolve();
      else {
        reject(
          new Error(String(event.data?.error || "Préparation de l’application impossible."))
        );
      }
    };

    worker.postMessage(
      { type: "MON_CAHIER_WARM_SHELL", urls: normalized },
      [channel.port2]
    );
  });
}

export async function getActiveOfflineWorkerRelease(): Promise<string | null> {
  if (!isBrowser() || !("serviceWorker" in navigator)) return null;
  const registration = await registerServiceWorker();
  if (!registration) return null;
  const worker = await waitForOfflineWorker(registration);
  if (!worker) return null;

  return await new Promise<string | null>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, 3_000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(
        event.data?.ok === true && typeof event.data?.release === "string"
          ? event.data.release
          : null,
      );
    };
    worker.postMessage({ type: "MON_CAHIER_GET_RELEASE" }, [channel.port2]);
  });
}

/* ───────────────────────── Fetch helpers ───────────────────────── */

function buildHeaders(extra?: Record<string, string>) {
  const h: Record<string, string> = {
    Accept: "application/json",
    ...extra,
  };
  // Content-Type JSON si body object
  if (!h["Content-Type"]) h["Content-Type"] = "application/json";
  return h;
}

async function safeJson(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

class HttpResponseError extends Error {
  status: number;
  allowCache: boolean;

  constructor(message: string, status: number, allowCache: boolean) {
    super(message);
    this.name = "HttpResponseError";
    this.status = status;
    this.allowCache = allowCache;
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function responseErrorMessage(payload: any, status: number) {
  return String(payload?.error || payload?.message || `HTTP ${status}`);
}

/**
 * GET JSON avec fallback cache (kv).
 * - Online OK -> met à jour le cache.
 * - Offline/network error -> renvoie le cache si disponible.
 * - HTTP error (401/403/500) -> essaie cache, sinon throw.
 */
export async function offlineGetJson<T = any>(url: string, cacheKey: string): Promise<T> {
  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: buildHeaders({ "Content-Type": "application/json" }),
    });

    if (!res.ok) {
      const j = await safeJson(res);
      const msg = responseErrorMessage(j, res.status);

      // Un 401/403/404/422 ne doit jamais être masqué par une ancienne donnée
      // locale. Le cache n'est toléré que pour une panne serveur temporaire.
      if (isRetryableStatus(res.status)) {
        const cached = await cacheGet<T>(cacheKey);
        if (cached != null) return cached;
      }

      throw new HttpResponseError(msg, res.status, isRetryableStatus(res.status));
    }

    const j = (await safeJson(res)) as T;
    await cacheSet(cacheKey, j);
    return j;
  } catch (error) {
    if (error instanceof HttpResponseError && !error.allowCache) {
      throw error;
    }
    const cached = await cacheGet<T>(cacheKey);
    if (cached != null) return cached;
    throw new Error("Hors connexion : aucune donnée en cache pour cette page.");
  }
}

/* ───────────────────────── Outbox (mutations) ───────────────────────── */

function uid() {
  // id stable et unique
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

let _lastMutationCreatedAt = 0;

function nextMutationCreatedAt() {
  const now = Date.now();
  _lastMutationCreatedAt = Math.max(now, _lastMutationCreatedAt + 1);
  return _lastMutationCreatedAt;
}

async function outboxAdd(row: OutboxRow): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["outbox"], "readwrite");
  const store = tx.objectStore("outbox");

  // MergeKey: on remplace l’ancienne action (ex: plusieurs "save" d'une même séance)
  if (row.mergeKey) {
    const idx = store.index("mergeKey");
    const existing = await reqToPromise<OutboxRow[]>(idx.getAll(row.mergeKey));
    for (const e of existing) {
      store.delete(e.id);
    }
  }

  store.put(row);
  await txDone(tx);
}

async function outboxUpdate(id: string, patch: Partial<OutboxRow>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["outbox"], "readwrite");
  const store = tx.objectStore("outbox");
  const current = await reqToPromise<OutboxRow | undefined>(store.get(id));
  if (current) store.put({ ...current, ...patch });
  await txDone(tx);
}

async function outboxAll(): Promise<OutboxRow[]> {
  const db = await openDB();
  const tx = db.transaction(["outbox"], "readonly");
  const store = tx.objectStore("outbox");
  const rows = await reqToPromise<OutboxRow[]>(store.getAll());
  await txDone(tx);
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}

export async function findLegacyTeacherAttendanceMutation(
  sessionIds: string[],
): Promise<LegacyTeacherAttendanceMutation | null> {
  const acceptedIds = new Set(
    sessionIds.map((value) => String(value || "").trim()).filter(Boolean),
  );
  if (!acceptedIds.size) return null;

  const rows = await outboxAll();
  const row = [...rows].reverse().find((candidate) => {
    if (!/^\/api\/teacher\/attendance\/bulk(?:[/?]|$)/.test(candidate.url)) return false;
    const sessionId = String(candidate.body?.session_id || "").trim();
    const clientId = String(candidate.body?.client_session_id || "").trim();
    return acceptedIds.has(sessionId) || acceptedIds.has(clientId) || acceptedIds.has(`client:${clientId}`);
  });
  if (!row) return null;

  return {
    id: row.id,
    operationId: row.operationId,
    body: row.body,
    state: row.state === "blocked" ? "blocked" : "pending",
    lastStatus: typeof row.lastStatus === "number" ? row.lastStatus : null,
    lastError: row.lastError || null,
    createdAt: row.createdAt,
  };
}

export async function removeLegacyTeacherAttendanceMutation(id: string): Promise<void> {
  await outboxDelete(String(id || "").trim());
}

async function outboxDelete(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["outbox"], "readwrite");
  tx.objectStore("outbox").delete(id);
  await txDone(tx);
}

export async function outboxCount(): Promise<number> {
  const db = await openDB();
  const tx = db.transaction(["outbox"], "readonly");
  const store = tx.objectStore("outbox");
  const count = await reqToPromise<number>(store.count());
  await txDone(tx);
  return count;
}

export async function outboxStats(): Promise<OutboxStats> {
  const rows = await outboxAll();
  const blocked = rows.filter((row) => row.state === "blocked").length;
  const lastIssue = [...rows]
    .reverse()
    .find((row) => !!row.lastError || typeof row.lastStatus === "number");

  return {
    total: rows.length,
    pending: rows.length - blocked,
    blocked,
    lastError: lastIssue?.lastError || null,
    lastStatus:
      typeof lastIssue?.lastStatus === "number" ? lastIssue.lastStatus : null,
  };
}

/**
 * Mutations JSON :
 * - succès serveur -> réponse immédiate ;
 * - réseau, authentification expirée ou panne temporaire -> mise en attente ;
 * - validation métier immédiate -> erreur visible, sans mise en attente.
 */
export async function offlineMutateJson<T = any>(
  url: string,
  init: MutateInit,
  opts?: MutateOpts
): Promise<MutateResult<T>> {
  const method = init.method;
  const bodyObj = init.body ?? undefined;
  const operationId = opts?.operationId || uid();
  const operationHeaders = {
    ...init.headers,
    "X-Mon-Cahier-Operation-Id": operationId,
  };

  const queueMutation = async (details: {
    offline: boolean;
    status: number;
    error?: string;
  }): Promise<MutateResult<T>> => {
    const row: OutboxRow = {
      id: operationId,
      operationId,
      url,
      method,
      body: bodyObj,
      headers: operationHeaders,
      mergeKey: opts?.mergeKey,
      createdAt: nextMutationCreatedAt(),
      meta: opts?.meta,
      state: "pending",
      attempts: 0,
      lastStatus: details.status || undefined,
      lastError: details.error,
    };
    await outboxAdd(row);
    return {
      ok: false,
      queued: true,
      offline: details.offline,
      status: details.status,
      error: details.error,
    };
  };

  try {
    const res = await fetch(url, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: buildHeaders(operationHeaders),
      body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj),
    });

    const status = res.status;
    const j = await safeJson(res);

    // Les erreurs temporaires sont conservées ; les validations métier restent visibles.
    if (!res.ok) {
      const msg = responseErrorMessage(j, status);

      // Auth expirée ou panne temporaire : on conserve l'action au lieu de
      // demander à l'utilisateur de tout ressaisir.
      if (status === 401 || isRetryableStatus(status)) {
        return await queueMutation({ offline: false, status, error: msg });
      }

      return { ok: false, queued: false, offline: false, status, error: msg, data: j };
    }

    // ✅ OK
    return { ok: true, data: j as T, status };
  } catch (error: any) {
    // Erreur réseau : l'identifiant d'opération reste le même, même si le
    // serveur avait traité la requête avant la coupure de la réponse.
    return await queueMutation({
      offline: true,
      status: 0,
      error: String(error?.message || "network_error"),
    });
  }
}

/* ───────────────────────── Flush outbox ───────────────────────── */

function rewriteBodyWithSessionMap(body: any, map: Record<string, string>) {
  if (!body || typeof body !== "object") return body;

  // attendance bulk: { session_id, marks }
  if (typeof body.session_id === "string" && body.session_id.startsWith("client:")) {
    const mapped = map[body.session_id];
    if (mapped) return { ...body, session_id: mapped };
  }

  // Une fin de séance enseignant peut ne contenir que client_session_id.
  if (typeof body.client_session_id === "string") {
    const clientKey = body.client_session_id.startsWith("client:")
      ? body.client_session_id
      : `client:${body.client_session_id}`;
    const mapped = map[clientKey];
    if (mapped) return { ...body, session_id: mapped };
  }

  return body;
}

async function maybeUpdateSessionMapFromStart(row: OutboxRow, responseJson: any) {
  // start session returns { item: { id, ... } } (supposé)
  const clientSessionId = row?.meta?.clientSessionId || row?.body?.client_session_id;
  const serverId = responseJson?.item?.id || responseJson?.data?.item?.id;

  if (!clientSessionId || !serverId) return;

  const rawClientKey = String(clientSessionId);
  const clientKey = rawClientKey.startsWith("client:")
    ? rawClientKey
    : `client:${rawClientKey}`;
  const map = await getSessionIdMap();
  if (map[clientKey] === serverId) return;

  map[clientKey] = serverId;
  await setSessionIdMap(map);
}

function isSessionStartRow(row: OutboxRow) {
  if (row?.meta?.operationType === "session-start") return true;
  return /\/api\/(?:class|teacher)\/sessions\/start(?:[/?]|$)/.test(row.url);
}

/**
 * Rejoue les actions en attente (dans l'ordre).
 * Stoppe au premier échec réseau (pour éviter de vider l'outbox partiellement).
 */
async function flushOutboxInternal(): Promise<FlushResult> {
  const empty: FlushResult = {
    flushed: 0,
    remaining: 0,
    blocked: 0,
    authRequired: false,
    retryableFailure: false,
    lastError: null,
    lastStatus: null,
  };

  if (!isBrowser()) return empty;

  const rows = await outboxAll();
  if (rows.length === 0) return empty;

  let flushed = 0;
  let authRequired = false;
  let retryableFailure = false;
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  const map = await getSessionIdMap();

  for (const row of rows) {
    // Une action invalide reste visible et récupérable. Elle ne bloque pas les
    // autres actions indépendantes de la file.
    if (row.state === "blocked") continue;

    // Prépare body potentiellement réécrit (session_id)
    const body = rewriteBodyWithSessionMap(row.body, map);

    try {
      const res = await fetch(row.url, {
        method: row.method,
        credentials: "include",
        cache: "no-store",
        headers: buildHeaders(row.headers),
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (!res.ok) {
        const j = await safeJson(res);
        const msg = responseErrorMessage(j, res.status);
        const attempts = Number(row.attempts || 0) + 1;
        lastError = msg;
        lastStatus = res.status;

        if (res.status === 401) {
          authRequired = true;
          await outboxUpdate(row.id, {
            state: "pending",
            attempts,
            lastAttemptAt: Date.now(),
            lastStatus: res.status,
            lastError: msg,
          });
          break;
        }

        if (isRetryableStatus(res.status)) {
          retryableFailure = true;
          await outboxUpdate(row.id, {
            state: "pending",
            attempts,
            lastAttemptAt: Date.now(),
            lastStatus: res.status,
            lastError: msg,
          });
          break;
        }

        // Validation/conflit : surtout ne pas supprimer silencieusement.
        await outboxUpdate(row.id, {
          state: "blocked",
          attempts,
          lastAttemptAt: Date.now(),
          lastStatus: res.status,
          lastError: msg,
        });
        continue;
      }

      const j = await safeJson(res);

      // Si c'était un startSession, on mémorise le mapping client -> server
      if (isSessionStartRow(row)) {
        await maybeUpdateSessionMapFromStart(row, j);
        // refresh local map (au cas où)
        const next = await getSessionIdMap();
        Object.assign(map, next);
      }

      await outboxDelete(row.id);
      flushed += 1;
    } catch (error: any) {
      // réseau encore instable : on stoppe et on garde le reste
      retryableFailure = true;
      lastStatus = 0;
      lastError = String(error?.message || "network_error");
      await outboxUpdate(row.id, {
        state: "pending",
        attempts: Number(row.attempts || 0) + 1,
        lastAttemptAt: Date.now(),
        lastStatus: 0,
        lastError,
      });
      break;
    }
  }

  const stats = await outboxStats();
  return {
    flushed,
    remaining: stats.total,
    blocked: stats.blocked,
    authRequired,
    retryableFailure,
    lastError: lastError || stats.lastError,
    lastStatus: lastStatus ?? stats.lastStatus,
  };
}

let _flushPromise: Promise<FlushResult> | null = null;

/**
 * Un seul rejeu à la fois, même lorsque deux composants (ou deux onglets sur
 * les navigateurs compatibles) détectent simultanément le retour du réseau.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (!isBrowser()) return await flushOutboxInternal();
  if (_flushPromise) return await _flushPromise;

  const locks = (
    navigator as unknown as {
      locks?: {
        request(
          name: string,
          callback: () => Promise<FlushResult>,
        ): Promise<FlushResult>;
      };
    }
  ).locks;

  _flushPromise = locks
    ? locks.request("moncahier-offline-outbox", () => flushOutboxInternal())
    : flushOutboxInternal();

  try {
    return await _flushPromise;
  } finally {
    _flushPromise = null;
  }
}

/* ───────────────────────── Clear all offline data ───────────────────────── */

export async function clearOfflineAll(): Promise<void> {
  if (!isBrowser()) return;

  // 1) caches (Cache API)
  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      // ignore
    }
  }

  // 2) IndexedDB stores
  try {
    const db = await openDB();
    db.close();
  } catch {
    // ignore
  }

  // delete database entirely
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

  _dbPromise = null;
}

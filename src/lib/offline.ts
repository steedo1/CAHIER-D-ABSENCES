// src/lib/offline.ts
// Helpers Offline (client only) : cache JSON + outbox (mutations) + flush on reconnect.

type JsonValue = any;

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
// Conserver la version du /public/sw.js livré avec ce src. Elle sera relevée
// uniquement après audit du fichier public/sw.js, absent de l'archive reçue.
const SW_BUILD = "2025-11-05T19:59:59Z";
export const MON_CAHIER_SW_URL = `/sw.js?v=${encodeURIComponent(SW_BUILD)}`;

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

/* ───────────────────────── Service Worker ───────────────────────── */

export async function registerServiceWorker(): Promise<void> {
  if (!isBrowser()) return;
  if (!("serviceWorker" in navigator)) return;

  try {
    // Une seule URL versionnée pour éviter que plusieurs écrans se remplacent
    // mutuellement le service worker avec des versions différentes.
    await navigator.serviceWorker.register(MON_CAHIER_SW_URL, { scope: "/" });
    await navigator.serviceWorker.ready;
  } catch {
    // Ne casse rien si SW indisponible
  }
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
      createdAt: Date.now(),
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
    navigator as Navigator & {
      locks?: {
        request<T>(name: string, callback: () => Promise<T>): Promise<T>;
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

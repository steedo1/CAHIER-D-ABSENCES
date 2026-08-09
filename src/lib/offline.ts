// src/lib/offline.ts
// Helpers Offline (client only) : cache JSON + outbox (mutations) + flush on reconnect.

type JsonValue = any;

import {
  MON_CAHIER_OFFLINE_SCHEMA_VERSION,
  MON_CAHIER_SERVICE_WORKER_RELEASE,
} from "@/lib/offline-release";

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

export type LegacyTeacherSessionEndMutation =
  LegacyTeacherAttendanceMutation;

type MutateInit = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: JsonValue;
  headers?: Record<string, string>;
};

type MutateOpts = {
  mergeKey?: string;
  meta?: Record<string, any>;
  operationId?: string;
  timeoutMs?: number;
  queueOnly?: boolean;
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

export type FlushedMutationAcknowledgement = {
  operationId: string;
  operationType: string | null;
  clientSessionId: string | null;
  sessionId: string | null;
  institutionId: string | null;
  classId: string | null;
  status: number;
};

export type FlushResult = {
  flushed: number;
  remaining: number;
  blocked: number;
  authRequired: boolean;
  retryableFailure: boolean;
  lastError: string | null;
  lastStatus: number | null;
  acknowledged: FlushedMutationAcknowledgement[];
};

const DB_NAME = "moncahier_offline_v1";
const DB_VERSION = 2;
export {
  MON_CAHIER_OFFLINE_SCHEMA_VERSION,
  MON_CAHIER_SERVICE_WORKER_RELEASE,
};

// URL volontairement stable : le navigateur compare le contenu du script et
// met à jour la même inscription au lieu de créer des variantes par commit.
export const MON_CAHIER_SW_URL = "/moncahier-sw.js";

export type OfflineWorkerInfo = {
  release: string;
  offlineSchemaVersion: number;
};

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

/**
 * Publie un paquet cohérent dans le cache local.
 *
 * IndexedDB garantit qu'une transaction est soit entièrement validée, soit
 * entièrement annulée. Les écrans d'appel ne peuvent donc jamais observer un
 * nouvel emploi du temps avec d'anciennes listes d'élèves (ou l'inverse).
 */
export async function cacheSetMany(
  entries: ReadonlyArray<readonly [key: string, value: any]>,
): Promise<void> {
  if (!entries.length) return;

  const normalized = new Map<string, any>();
  for (const [rawKey, value] of entries) {
    const key = String(rawKey || "").trim();
    if (!key) throw new Error("offline_cache_key_required");
    normalized.set(key, value);
  }

  const db = await openDB();
  const tx = db.transaction(["kv"], "readwrite");
  const store = tx.objectStore("kv");
  const updatedAt = Date.now();
  for (const [key, value] of normalized) {
    const row: KVRow = { key, value, updatedAt };
    store.put(row);
  }
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

export async function registerOfflineSessionReference(
  clientSessionId: string,
  serverSessionId: string,
) {
  const clientKey = String(clientSessionId || "").trim();
  const serverId = String(serverSessionId || "").trim();
  if (!clientKey.startsWith("client:") || !serverId) {
    throw new Error("offline_session_mapping_invalid");
  }
  const map = await getSessionIdMap();
  const existing = String(map[clientKey] || "").trim();
  if (existing && existing !== serverId) {
    throw new Error("offline_session_mapping_conflict");
  }
  map[clientKey] = serverId;
  await setSessionIdMap(map);
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

const SERVICE_WORKER_READY_TIMEOUT_MS = 12_000;

async function withBrowserTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isBrowser()) return null;
  if (!("serviceWorker" in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register(
      MON_CAHIER_SW_URL,
      { scope: "/", updateViaCache: "none" },
    );

    // La recherche de mise à jour reste asynchrone : une connexion absente ne
    // doit jamais retenir l'écran de préparation.
    void registration.update().catch(() => undefined);
    await withBrowserTimeout(
      navigator.serviceWorker.ready,
      SERVICE_WORKER_READY_TIMEOUT_MS,
      "Activation du service hors ligne trop longue.",
    );
    return registration;
  } catch {
    // Ne casse rien si le service worker est momentanément indisponible.
    return null;
  }
}

function isMonCahierWorker(worker: ServiceWorker | null) {
  if (!worker) return false;
  try {
    return new URL(worker.scriptURL).pathname === MON_CAHIER_SW_URL;
  } catch {
    return false;
  }
}

async function waitForOfflineWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorker | null> {
  const findWorker = () =>
    [registration.waiting, registration.installing, registration.active].find(
      (worker): worker is ServiceWorker => isMonCahierWorker(worker),
    ) || null;

  let candidate = findWorker();
  if (!candidate) {
    await withBrowserTimeout(
      registration.update(),
      5_000,
      "Recherche de mise à jour du service hors ligne trop longue.",
    ).catch(() => undefined);
    candidate = findWorker();
  }
  if (!candidate) return null;

  // Un worker installé ou déjà actif peut préparer son propre cache sans
  // imposer un rechargement de page ni interrompre une séance en cours.
  if (candidate.state === "installed" || candidate.state === "activated") {
    return candidate;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Installation du service hors ligne trop longue.")),
      15_000,
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

  return isMonCahierWorker(candidate) ? candidate : null;
}

async function requestOfflineWorkerInfo(
  worker: ServiceWorker,
): Promise<OfflineWorkerInfo | null> {
  return await new Promise<OfflineWorkerInfo | null>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, 3_000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.ok !== true || typeof event.data?.release !== "string") {
        resolve(null);
        return;
      }
      const rawSchema = Number(event.data?.offline_schema_version);
      resolve({
        release: event.data.release,
        // Les workers Mon Cahier antérieurs à ce lot utilisaient déjà le
        // schéma initial. L'absence du champ est donc migrée vers la version 1.
        offlineSchemaVersion:
          Number.isSafeInteger(rawSchema) && rawSchema > 0 ? rawSchema : 1,
      });
    };
    worker.postMessage({ type: "MON_CAHIER_GET_RELEASE" }, [channel.port2]);
  });
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
        .filter((url) => url.startsWith("/")),
    ),
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
          new Error(String(event.data?.error || "Préparation de l’application impossible.")),
        );
      }
    };

    worker.postMessage(
      { type: "MON_CAHIER_WARM_SHELL", urls: normalized },
      [channel.port2],
    );
  });
}

export async function getActiveOfflineWorkerInfo(): Promise<OfflineWorkerInfo | null> {
  if (!isBrowser() || !("serviceWorker" in navigator)) return null;
  const registration = await registerServiceWorker();
  if (!registration) return null;
  const worker = await waitForOfflineWorker(registration);
  if (!worker) return null;
  return await requestOfflineWorkerInfo(worker);
}

export async function getActiveOfflineWorkerRelease(): Promise<string | null> {
  return (await getActiveOfflineWorkerInfo())?.release || null;
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

const DEFAULT_MUTATION_TIMEOUT_MS = 6_000;
const DEFAULT_READ_TIMEOUT_MS = 6_000;
const OUTBOX_REPLAY_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("request_timeout", "TimeoutError")),
    Math.max(500, timeoutMs),
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function outboxRetryDelayMs(attempts: number) {
  const exponent = Math.max(0, Math.min(6, Math.floor(attempts || 0)));
  return Math.min(60_000, 1_000 * 2 ** exponent);
}

/**
 * GET JSON avec fallback cache (kv).
 * - Online OK -> met à jour le cache.
 * - Offline/network error -> renvoie le cache si disponible.
 * - HTTP error (401/403/500) -> essaie cache, sinon throw.
 */
export async function offlineGetJson<T = any>(url: string, cacheKey: string): Promise<T> {
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: buildHeaders({ "Content-Type": "application/json" }),
      },
      DEFAULT_READ_TIMEOUT_MS,
    );

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

export async function findLegacyTeacherSessionEndMutation(
  sessionIds: string[],
): Promise<LegacyTeacherSessionEndMutation | null> {
  const acceptedIds = new Set(
    sessionIds.map((value) => String(value || "").trim()).filter(Boolean),
  );
  if (!acceptedIds.size) return null;
  const rows = await outboxAll();
  const row = [...rows].reverse().find((candidate) => {
    if (!/^\/api\/(?:class|teacher)\/sessions\/end(?:[/?]|$)/.test(candidate.url)) {
      return false;
    }
    const sessionId = String(candidate.body?.session_id || "").trim();
    const clientId = String(candidate.body?.client_session_id || "").trim();
    return (
      acceptedIds.has(sessionId) ||
      acceptedIds.has(clientId) ||
      acceptedIds.has(`client:${clientId}`)
    );
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

export async function removeQueuedOfflineMutation(id: string) {
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
function mutationOperationType(
  url: string,
  explicit?: string | null,
) {
  const normalizedExplicit = String(explicit || "").trim();
  if (normalizedExplicit) return normalizedExplicit;
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

  if (opts?.queueOnly) {
    return await queueMutation({
      offline: true,
      status: 0,
      error: "queued_by_client",
    });
  }

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method,
        credentials: "include",
        cache: "no-store",
        headers: buildHeaders(operationHeaders),
        body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj),
      },
      opts?.timeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS,
    );

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

    const operationType = mutationOperationType(
      url,
      opts?.meta?.operationType,
    );
    if (operationType) {
      const acknowledgedOperationId = responseOperationId(j);
      if (acknowledgedOperationId !== operationId) {
        return await queueMutation({
          offline: false,
          status: 409,
          error: acknowledgedOperationId
            ? "offline_operation_id_mismatch"
            : "offline_operation_id_missing",
        });
      }
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

function responseOperationId(responseJson: any) {
  return String(
    responseJson?.operation_id ||
      responseJson?.item?.operation_id ||
      responseJson?.data?.operation_id ||
      responseJson?.data?.item?.operation_id ||
      "",
  ).trim();
}

async function maybeUpdateSessionMapFromStart(row: OutboxRow, responseJson: any) {
  const acknowledgedOperationId = responseOperationId(responseJson);
  if (
    acknowledgedOperationId &&
    acknowledgedOperationId !== row.operationId
  ) {
    throw new Error("offline_start_operation_id_mismatch");
  }

  const clientSessionId = row?.meta?.clientSessionId || row?.body?.client_session_id;
  const serverId = responseJson?.item?.id || responseJson?.data?.item?.id;

  if (!clientSessionId || !serverId) return;

  const rawClientKey = String(clientSessionId);
  const clientKey = rawClientKey.startsWith("client:")
    ? rawClientKey
    : `client:${rawClientKey}`;
  await registerOfflineSessionReference(clientKey, String(serverId));
}

function outboxOperationType(row: OutboxRow) {
  return mutationOperationType(row.url, row?.meta?.operationType);
}

function outboxSessionDependencyKey(row: OutboxRow, body: any) {
  const candidate =
    row?.meta?.clientSessionId ||
    body?.client_session_id ||
    body?.session_id ||
    row?.body?.client_session_id ||
    row?.body?.session_id ||
    "";
  const normalized = String(candidate || "").trim();
  return normalized || null;
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
    acknowledged: [],
  };

  if (!isBrowser()) return empty;

  const rows = await outboxAll();
  if (rows.length === 0) return empty;

  let flushed = 0;
  let authRequired = false;
  let retryableFailure = false;
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  const acknowledged: FlushedMutationAcknowledgement[] = [];
  const blockedSessions = new Set<string>();
  const map = await getSessionIdMap();

  for (const row of rows) {
    const body = rewriteBodyWithSessionMap(row.body, map);
    const operationType = outboxOperationType(row);
    const dependencyKey = outboxSessionDependencyKey(row, body);

    // Une ouverture ou un appel bloqué ne doit jamais être dépassé par la
    // fermeture de la même séance. Les cours indépendants restent rejouables.
    if (row.state === "blocked") {
      if (
        dependencyKey &&
        (operationType === "session-start" || operationType === "attendance")
      ) {
        blockedSessions.add(dependencyKey);
      }
      continue;
    }
    if (
      dependencyKey &&
      blockedSessions.has(dependencyKey) &&
      (operationType === "attendance" || operationType === "session-end")
    ) {
      continue;
    }

    const attemptsBeforeRun = Number(row.attempts || 0);
    if (
      row.lastAttemptAt &&
      Date.now() - row.lastAttemptAt < outboxRetryDelayMs(attemptsBeforeRun)
    ) {
      retryableFailure = true;
      lastError = row.lastError || "retry_backoff";
      lastStatus =
        typeof row.lastStatus === "number" ? row.lastStatus : null;
      break;
    }

    try {
      const res = await fetchWithTimeout(
        row.url,
        {
          method: row.method,
          credentials: "include",
          cache: "no-store",
          headers: buildHeaders(row.headers),
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        OUTBOX_REPLAY_TIMEOUT_MS,
      );

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
        if (
          dependencyKey &&
          (operationType === "session-start" || operationType === "attendance")
        ) {
          blockedSessions.add(dependencyKey);
        }
        continue;
      }

      const j = await safeJson(res);
      const acknowledgedOperationId = responseOperationId(j);
      if (
        operationType &&
        acknowledgedOperationId !== row.operationId
      ) {
        const msg = acknowledgedOperationId
          ? "offline_operation_id_mismatch"
          : "offline_operation_id_missing";
        await outboxUpdate(row.id, {
          state: "blocked",
          attempts: Number(row.attempts || 0) + 1,
          lastAttemptAt: Date.now(),
          lastStatus: 409,
          lastError: msg,
        });
        if (dependencyKey) blockedSessions.add(dependencyKey);
        lastError = msg;
        lastStatus = 409;
        continue;
      }

      // Si c'était un startSession, on mémorise le mapping client -> server.
      // Un mapping déjà lié à une autre séance est un conflit métier, jamais
      // une raison d'écraser silencieusement l'ancien cours.
      if (isSessionStartRow(row)) {
        try {
          await maybeUpdateSessionMapFromStart(row, j);
          const next = await getSessionIdMap();
          Object.assign(map, next);
        } catch (error: any) {
          const msg = String(error?.message || "offline_session_mapping_conflict");
          await outboxUpdate(row.id, {
            state: "blocked",
            attempts: Number(row.attempts || 0) + 1,
            lastAttemptAt: Date.now(),
            lastStatus: 409,
            lastError: msg,
          });
          if (dependencyKey) blockedSessions.add(dependencyKey);
          lastError = msg;
          lastStatus = 409;
          continue;
        }
      }

      const resolvedSessionId = String(
        j?.session_id ||
          j?.item?.id ||
          j?.data?.session_id ||
          j?.data?.item?.id ||
          body?.session_id ||
          "",
      ).trim() || null;
      acknowledged.push({
        operationId: row.operationId,
        operationType,
        clientSessionId: dependencyKey,
        sessionId: resolvedSessionId,
        institutionId: String(row?.meta?.institutionId || "").trim() || null,
        classId: String(row?.meta?.classId || "").trim() || null,
        status: res.status,
      });
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
    acknowledged,
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

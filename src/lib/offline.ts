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
  url: string;
  method: string;
  body?: JsonValue;
  headers?: Record<string, string>;
  mergeKey?: string;
  createdAt: number;
  meta?: Record<string, any>;
};

type MutateInit = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: JsonValue;
  headers?: Record<string, string>;
};

type MutateOpts = {
  mergeKey?: string;
  meta?: Record<string, any>;
};

export type MutateResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; queued: true };

const DB_NAME = "moncahier_offline_v1";
const DB_VERSION = 1;

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
      } else {
        const out = req.transaction?.objectStore("outbox");
        if (out) {
          if (!out.indexNames.contains("mergeKey")) out.createIndex("mergeKey", "mergeKey", { unique: false });
          if (!out.indexNames.contains("createdAt")) out.createIndex("createdAt", "createdAt", { unique: false });
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
    // On enregistre /sw.js (dans /public)
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
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
      const cached = await cacheGet<T>(cacheKey);
      if (cached != null) return cached;

      const j = await safeJson(res);
      const msg = j?.error || j?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const j = (await safeJson(res)) as T;
    await cacheSet(cacheKey, j);
    return j;
  } catch {
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

/**
 * Mutations JSON:
 * - Si online et HTTP ok -> { ok:true, data }
 * - Si online et HTTP error -> throw (ne queue pas)
 * - Si offline/network error -> queue + { ok:false, queued:true }
 */
export async function offlineMutateJson<T = any>(
  url: string,
  init: MutateInit,
  opts?: MutateOpts
): Promise<MutateResult<T>> {
  const method = init.method;
  const bodyObj = init.body ?? undefined;

  try {
    const res = await fetch(url, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: buildHeaders(init.headers),
      body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj),
    });

    if (!res.ok) {
      const j = await safeJson(res);
      const msg = j?.error || j?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const j = (await safeJson(res)) as T;
    return { ok: true, data: j };
  } catch {
    // Network/offline -> on met en outbox
    const row: OutboxRow = {
      id: uid(),
      url,
      method,
      body: bodyObj,
      headers: init.headers,
      mergeKey: opts?.mergeKey,
      createdAt: Date.now(),
      meta: opts?.meta,
    };
    await outboxAdd(row);
    return { ok: false, queued: true };
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

  return body;
}

async function maybeUpdateSessionMapFromStart(row: OutboxRow, responseJson: any) {
  // start session returns { item: { id, ... } } (supposé)
  const clientSessionId = row?.meta?.clientSessionId || row?.body?.client_session_id;
  const serverId = responseJson?.item?.id || responseJson?.data?.item?.id;

  if (!clientSessionId || !serverId) return;

  const clientKey = `client:${String(clientSessionId)}`;
  const map = await getSessionIdMap();
  if (map[clientKey] === serverId) return;

  map[clientKey] = serverId;
  await setSessionIdMap(map);
}

/**
 * Rejoue les actions en attente (dans l'ordre).
 * Stoppe au premier échec réseau (pour éviter de vider l'outbox partiellement).
 */
export async function flushOutbox(): Promise<{ flushed: number; remaining: number }> {
  if (!isBrowser()) return { flushed: 0, remaining: 0 };

  const rows = await outboxAll();
  if (rows.length === 0) return { flushed: 0, remaining: 0 };

  let flushed = 0;
  const map = await getSessionIdMap();

  for (const row of rows) {
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
        // si c'est un vrai HTTP error (validation/forbidden), on supprime l'item
        // pour éviter une boucle infinie.
        await outboxDelete(row.id);
        continue;
      }

      const j = await safeJson(res);

      // Si c'était un startSession, on mémorise le mapping client -> server
      if (row.url.includes("/api/class/sessions/start")) {
        await maybeUpdateSessionMapFromStart(row, j);
        // refresh local map (au cas où)
        const next = await getSessionIdMap();
        Object.assign(map, next);
      }

      await outboxDelete(row.id);
      flushed += 1;
    } catch {
      // réseau encore instable : on stoppe et on garde le reste
      break;
    }
  }

  const remaining = await outboxCount();
  return { flushed, remaining };
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
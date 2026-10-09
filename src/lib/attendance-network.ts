"use client";

/**
 * Budget réseau court réservé aux gestes interactifs d'appel.
 * Les files de rejeu de fond gardent volontairement des délais plus longs.
 */
export const ATTENDANCE_INTERACTIVE_NETWORK_TIMEOUT_MS = 1_800;
export const ATTENDANCE_SYNC_NETWORK_TIMEOUT_MS = 8_000;

type ConnectionLike = {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  saveData?: boolean;
};

type AttendanceWindow = typeof window & {
  __MON_CAHIER_ATTENDANCE_FETCH_V1__?: boolean;
};

type FetchLike = typeof fetch;

let originalBrowserFetch: FetchLike | null = null;

const ATTENDANCE_INTERACTIVE_READ_PATHS = [
  /^\/api\/teacher\/classes$/,
  /^\/api\/teacher\/roster$/,
  /^\/api\/teacher\/sessions\/open$/,
  /^\/api\/teacher\/institution\/(?:basics|settings|periods)$/,
  /^\/api\/class\/(?:my-classes|roster|subjects)$/,
  /^\/api\/institution\/(?:settings|periods)$/,
] as const;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  const explicit = String(init?.method || "").trim();
  if (explicit) return explicit.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return String(input.method || "GET").toUpperCase();
  }
  return "GET";
}

function requestPath(input: RequestInfo | URL) {
  try {
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://mon-cahier.invalid";
    return new URL(requestUrl(input), base).pathname;
  } catch {
    return "";
  }
}

export function attendanceInteractiveReadRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  if (requestMethod(input, init) !== "GET") return false;
  const path = requestPath(input);
  return ATTENDANCE_INTERACTIVE_READ_PATHS.some((pattern) => pattern.test(path));
}

export function attendanceConnectionConstrained() {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: ConnectionLike;
    mozConnection?: ConnectionLike;
    webkitConnection?: ConnectionLike;
  }).connection ||
    (navigator as Navigator & { mozConnection?: ConnectionLike }).mozConnection ||
    (navigator as Navigator & { webkitConnection?: ConnectionLike }).webkitConnection;
  if (!connection) return false;

  const effectiveType = String(connection.effectiveType || "").toLowerCase();
  const rtt = Number(connection.rtt);
  const downlink = Number(connection.downlink);
  return connection.saveData === true ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    (Number.isFinite(rtt) && rtt >= 900) ||
    (Number.isFinite(downlink) && downlink > 0 && downlink <= 0.5);
}

async function fetchWithAttendanceTimeout(
  baseFetch: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const external = init.signal;
  let rejectAborted: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
  const abortFromExternal = () => {
    const reason = external?.reason || new DOMException("request_aborted", "AbortError");
    controller.abort(reason);
    rejectAborted(reason);
  };
  if (external) {
    if (external.aborted) abortFromExternal();
    else external.addEventListener("abort", abortFromExternal, { once: true });
  }
  const timeout = setTimeout(
    () => {
      const reason = new DOMException("attendance_network_timeout", "TimeoutError");
      controller.abort(reason);
      rejectAborted(reason);
    },
    Math.max(500, timeoutMs),
  );
  try {
    return await Promise.race([
      (async () => {
        const response = await baseFetch(input, { ...init, signal: controller.signal });
        // These API responses are JSON. Keep the budget through the body,
        // then give callers a readable response with the original metadata.
        if (!response.body) return response;
        const body = await response.arrayBuffer();
        const buffered = new Response(body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
        for (const key of ["url", "redirected", "type"] as const) {
          Object.defineProperty(buffered, key, { value: response[key] });
        }
        return buffered;
      })(),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener("abort", abortFromExternal);
  }
}

function nativeFetch(): FetchLike {
  if (originalBrowserFetch) return originalBrowserFetch;
  return globalThis.fetch.bind(globalThis);
}

export async function fetchAttendanceInteractive(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = ATTENDANCE_INTERACTIVE_NETWORK_TIMEOUT_MS,
) {
  return await fetchWithAttendanceTimeout(
    nativeFetch(),
    input,
    init,
    timeoutMs,
  );
}

/** Replays must try a usable slow connection, independently of the input fast path. */
export async function fetchAttendanceBackground(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetchWithAttendanceTimeout(nativeFetch(), input, init, ATTENDANCE_SYNC_NETWORK_TIMEOUT_MS);
}

let syncProbe: Promise<boolean> | null = null;
let lastSyncProbe: { checkedAt: number; available: boolean } | null = null;
let syncProbeFailures = 0;
export function resetAttendanceCloudProbe() {
  lastSyncProbe = null;
  syncProbeFailures = 0;
}
if (typeof window !== "undefined") window.addEventListener("online", resetAttendanceCloudProbe);
export async function attendanceCloudAvailableForSync(): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.onLine === false) return false;
  if (syncProbe) return syncProbe;
  const ttl = lastSyncProbe?.available ? 15_000 : Math.min(60_000, 5_000 * 2 ** Math.min(syncProbeFailures, 4));
  if (lastSyncProbe && Date.now() - lastSyncProbe.checkedAt < ttl) return lastSyncProbe.available;
  syncProbe = (async () => {
    let available = false;
    try {
      const response = await fetchAttendanceBackground("/api/auth/role", {
        credentials: "include", cache: "no-store", headers: { Accept: "application/json" },
      });
      // A 401 is reachable: the replay reports authentication required without deleting data.
      available = response.status < 500 && response.status !== 402 && response.status !== 429;
      return available;
    } catch { return false; }
    finally {
      syncProbeFailures = available ? 0 : syncProbeFailures + 1;
      lastSyncProbe = { checkedAt: Date.now(), available };
      syncProbe = null;
    }
  })();
  return syncProbe;
}

/**
 * Les écrans d'appel utilisent déjà offlineGetJson(), qui sait retomber sur
 * IndexedDB en cas d'erreur réseau. Ce garde borne uniquement les GET qui sont
 * sur le chemin critique de l'appel : une connexion "vivante mais morte" ne
 * peut donc plus retenir une liste/EDT pendant le timeout général de 6 s.
 *
 * Les mutations et les synchronisations de fond ne sont jamais interceptées.
 */
function installAttendanceInteractiveReadGuard() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const scopedWindow = window as AttendanceWindow;
  if (scopedWindow.__MON_CAHIER_ATTENDANCE_FETCH_V1__) return;

  const baseFetch = window.fetch.bind(window) as FetchLike;
  originalBrowserFetch = baseFetch;
  scopedWindow.__MON_CAHIER_ATTENDANCE_FETCH_V1__ = true;

  window.fetch = (async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    if (!attendanceInteractiveReadRequest(input, init)) {
      return await baseFetch(input, init);
    }

    // Hors ligne explicite : ne lançons même pas une requête vouée à échouer.
    // offlineGetJson() récupérera immédiatement le cache préparé.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new DOMException("attendance_offline_fast_path", "NetworkError");
    }

    return await fetchWithAttendanceTimeout(
      baseFetch,
      input,
      init,
      ATTENDANCE_INTERACTIVE_NETWORK_TIMEOUT_MS,
    );
  }) as typeof window.fetch;
}

installAttendanceInteractiveReadGuard();

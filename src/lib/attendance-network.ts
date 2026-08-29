"use client";

/**
 * Budget réseau court réservé aux gestes interactifs d'appel.
 * Les files de rejeu de fond gardent volontairement des délais plus longs.
 */
export const ATTENDANCE_INTERACTIVE_NETWORK_TIMEOUT_MS = 1_800;

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
  const abortFromExternal = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) abortFromExternal();
    else external.addEventListener("abort", abortFromExternal, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(new DOMException("attendance_network_timeout", "TimeoutError")),
    Math.max(500, timeoutMs),
  );
  try {
    return await baseFetch(input, { ...init, signal: controller.signal });
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

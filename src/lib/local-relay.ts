"use client";

import { cacheDeleteByPrefixes, cacheGet, cacheSet } from "@/lib/offline";

export type LocalDataSource = "cloud" | "relay" | "cache";

export type LocalReadResult<T> = {
  data: T;
  source: LocalDataSource;
  saved_at: string;
};

type CacheEnvelope<T> = LocalReadResult<T>;

type RelayConfig = {
  baseUrl: string;
  token: string | null;
};

const DEFAULT_RELAY_URL =
  process.env.NEXT_PUBLIC_MONCAHIER_RELAY_URL || "http://127.0.0.1:4317";
const RELAY_URL_KEY = "moncahier:relay:url";
const RELAY_TOKEN_KEY = "moncahier:relay:token";
const INSTITUTION_ID_KEY = "moncahier:relay:institution-id";
const LAST_BOOTSTRAP_KEY = "moncahier:relay:last-bootstrap-at";
const BOOTSTRAP_THROTTLE_MS = 5 * 60 * 1000;
const RELAY_TIMEOUT_MS = 5_000;
const RELAY_PERMISSION_TIMEOUT_MS = 15_000;
const RELAY_BOOTSTRAP_TIMEOUT_MS = 60_000;
const RELAY_PRESENCE_TIMEOUT_MS = 5_000;
let bootstrapInFlight: Promise<any> | null = null;

function browser() {
  return typeof window !== "undefined";
}

function normalizeBaseUrl(raw: string) {
  const fallback = DEFAULT_RELAY_URL;
  try {
    const url = new URL(String(raw || fallback).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

type RelayTargetAddressSpace = "local" | "loopback";

function relayTargetAddressSpace(baseUrl: string): RelayTargetAddressSpace {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127(?:\.|$)/.test(hostname);
  return loopback ? "loopback" : "local";
}

export function getRelayConfig(): RelayConfig {
  if (!browser()) return { baseUrl: normalizeBaseUrl(DEFAULT_RELAY_URL), token: null };
  return {
    baseUrl: normalizeBaseUrl(window.localStorage.getItem(RELAY_URL_KEY) || DEFAULT_RELAY_URL),
    token: String(window.localStorage.getItem(RELAY_TOKEN_KEY) || "").trim() || null,
  };
}

export function saveRelayConfig(input: { baseUrl?: string; token?: string | null }) {
  if (!browser()) return;
  if (input.baseUrl !== undefined) {
    window.localStorage.setItem(RELAY_URL_KEY, normalizeBaseUrl(input.baseUrl));
  }
  if (input.token !== undefined) {
    const token = String(input.token || "").trim();
    if (token) window.localStorage.setItem(RELAY_TOKEN_KEY, token);
    else window.localStorage.removeItem(RELAY_TOKEN_KEY);
  }
}

export function rememberRelayInstitution(institutionId: string | null | undefined) {
  if (!browser()) return;
  const value = String(institutionId || "").trim();
  if (value) window.localStorage.setItem(INSTITUTION_ID_KEY, value);
}

export function getRememberedRelayInstitution() {
  if (!browser()) return null;
  return String(window.localStorage.getItem(INSTITUTION_ID_KEY) || "").trim() || null;
}

export async function clearRelayUserState() {
  if (!browser()) return;
  window.localStorage.removeItem(INSTITUTION_ID_KEY);
  window.localStorage.removeItem(LAST_BOOTSTRAP_KEY);
  await cacheDeleteByPrefixes(["relay:"]).catch(() => {});
  const worker = navigator.serviceWorker?.controller;
  worker?.postMessage({ type: "MON_CAHIER_PURGE_ADMIN_LOCAL" });
}

function mergeSignals(external?: AbortSignal, timeoutMs = RELAY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new Error("Le relais local n'a pas répondu dans le délai prévu.")),
    timeoutMs,
  );
  const onAbort = () => controller.abort(external?.reason || "aborted");
  external?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timeout);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

async function safeJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function relayJson<T>(
  path: string,
  init: RequestInit = {},
  options: {
    baseUrl?: string;
    includeConfiguredToken?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  if (!browser()) throw new Error("relay_browser_only");
  const config = getRelayConfig();
  const baseUrl = normalizeBaseUrl(options.baseUrl || config.baseUrl);
  const merged = mergeSignals(init.signal || undefined, options.timeoutMs);
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");
  if (options.includeConfiguredToken !== false && config.token) {
    headers.set("Authorization", `Bearer ${config.token}`);
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    const relayRequest: RequestInit & { targetAddressSpace?: RelayTargetAddressSpace } = {
      ...init,
      headers,
      signal: merged.signal,
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      targetAddressSpace: relayTargetAddressSpace(baseUrl),
    };
    const response = await fetch(`${baseUrl}${path}`, relayRequest as RequestInit);
    const payload = await safeJson(response);
    if (!response.ok) throw new Error(String(payload?.error || `RELAY_HTTP_${response.status}`));
    return payload as T;
  } finally {
    merged.cleanup();
  }
}

async function readEnvelope<T>(key: string): Promise<CacheEnvelope<T> | null> {
  try {
    const value = await cacheGet<CacheEnvelope<T>>(key);
    if (!value || typeof value !== "object" || !("data" in value)) return null;
    return value;
  } catch {
    return null;
  }
}

async function writeEnvelope<T>(key: string, data: T, source: LocalDataSource) {
  const envelope: CacheEnvelope<T> = { data, source, saved_at: new Date().toISOString() };
  try {
    await cacheSet(key, envelope);
  } catch {
    // IndexedDB peut être indisponible en navigation privée ; la lecture reste utilisable.
  }
  return envelope;
}

async function cloudJson<T>(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(String(payload?.error || payload?.message || `HTTP_${response.status}`));
  return payload as T;
}

export async function resolveRelayInstitutionId(signal?: AbortSignal) {
  if (!browser()) return null;

  if (navigator.onLine) {
    try {
      const role = await cloudJson<{ institution_id?: string | null }>("/api/auth/role", signal);
      const institutionId = String(role?.institution_id || "").trim();
      if (institutionId) rememberRelayInstitution(institutionId);
      if (institutionId) return institutionId;
    } catch {
      // En cas de coupure pendant la requête, on reprend l'établissement mémorisé.
    }
  }

  return getRememberedRelayInstitution();
}

export async function fetchAdminAttendanceMonitor<T>(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<LocalReadResult<{ rows: T[] }>> {
  const key = `relay:admin:attendance:${from}:${to}`;
  try {
    const cloud = await cloudJson<{ rows: T[] }>(
      `/api/admin/attendance/monitor?${new URLSearchParams({ from, to }).toString()}`,
      signal,
    );
    return await writeEnvelope(key, cloud, "cloud");
  } catch (cloudError) {
    if (signal?.aborted) throw cloudError;
    const institutionId = await resolveRelayInstitutionId(signal);
    if (institutionId) {
      try {
        const relay = await relayJson<{ rows: T[] }>(
          `/v1/admin/attendance/monitor?${new URLSearchParams({
            institution_id: institutionId,
            from,
            to,
          }).toString()}`,
          { signal },
        );
        return await writeEnvelope(key, relay, "relay");
      } catch {
        // Dernier niveau : vue locale connue.
      }
    }
    const cached = await readEnvelope<{ rows: T[] }>(key);
    if (cached) return { ...cached, source: "cache" };
    throw cloudError;
  }
}

export async function fetchDashboardMetrics<T extends Record<string, any>>(
  days: number,
  signal?: AbortSignal,
): Promise<LocalReadResult<T>> {
  const key = `relay:admin:dashboard:metrics:${days}`;
  try {
    const cloud = await cloudJson<T>(`/api/admin/dashboard/metrics?days=${days}`, signal);
    return await writeEnvelope(key, cloud, "cloud");
  } catch (cloudError) {
    if (signal?.aborted) throw cloudError;
    const cached = await readEnvelope<T>(key);
    const institutionId = await resolveRelayInstitutionId(signal);
    if (institutionId) {
      try {
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Abidjan",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        const relay = await relayJson<any>(
          `/v1/admin/dashboard?${new URLSearchParams({
            institution_id: institutionId,
            date: today,
          }).toString()}`,
          { signal },
        );
        const previous = (cached?.data || {}) as any;
        const merged = {
          ...previous,
          ok: true,
          counts: {
            ...(previous?.counts || {}),
            classes: Number(relay?.counts?.classes || 0),
            teachers: Number(relay?.counts?.teachers || 0),
            parents: Number(previous?.counts?.parents || 0),
            students: Number(relay?.counts?.students || 0),
            students_total: Number(relay?.counts?.students || 0),
            assigned_students: Number(previous?.counts?.assigned_students || 0),
            not_assigned_students: Number(previous?.counts?.not_assigned_students || 0),
            assignment_unknown: Number(previous?.counts?.assignment_unknown || 0),
            boarder_students: Number(previous?.counts?.boarder_students || 0),
            not_boarder_students: Number(previous?.counts?.not_boarder_students || 0),
            boarding_unknown: Number(previous?.counts?.boarding_unknown || 0),
            boys: Number(previous?.counts?.boys || 0),
            girls: Number(previous?.counts?.girls || 0),
            gender_unknown: Number(previous?.counts?.gender_unknown || 0),
          },
          kpis: previous?.kpis || { absences: 0, retards: 0 },
          meta: {
            ...(previous?.meta || {}),
            days,
            source: "relay",
            generated_at: relay?.generated_at || new Date().toISOString(),
            relay_sync: relay?.sync || null,
          },
        } as T;
        return await writeEnvelope(key, merged, "relay");
      } catch {
        // Cache ci-dessous.
      }
    }
    if (cached) return { ...cached, source: "cache" };
    throw cloudError;
  }
}

export async function fetchInstitutionSettings<T extends Record<string, any>>(
  signal?: AbortSignal,
): Promise<LocalReadResult<T>> {
  const key = "relay:admin:institution:settings";
  try {
    const cloud = await cloudJson<T>("/api/admin/institution/settings", signal);
    return await writeEnvelope(key, cloud, "cloud");
  } catch (cloudError) {
    if (signal?.aborted) throw cloudError;
    const cached = await readEnvelope<T>(key);
    const institutionId = await resolveRelayInstitutionId(signal);
    if (institutionId) {
      try {
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Abidjan",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        const relay = await relayJson<any>(
          `/v1/admin/dashboard?${new URLSearchParams({
            institution_id: institutionId,
            date: today,
          }).toString()}`,
          { signal },
        );
        const previous = (cached?.data || {}) as any;
        const name = String(relay?.institution?.name || previous?.institution_name || "").trim();
        const merged = {
          ...previous,
          institution_name: name || "Votre établissement",
          name: name || "Votre établissement",
          institution_label: name || "Votre établissement",
          institution_code: relay?.institution?.code || previous?.institution_code || "",
          tz: relay?.institution?.timezone || previous?.tz || "Africa/Abidjan",
        } as T;
        return await writeEnvelope(key, merged, "relay");
      } catch {
        // Cache ci-dessous.
      }
    }
    if (cached) return { ...cached, source: "cache" };
    throw cloudError;
  }
}

export async function fetchFounderAttendanceSlots<T>(
  signal?: AbortSignal,
): Promise<LocalReadResult<T>> {
  const key = "relay:founder:attendance-slots";
  try {
    const cloud = await cloudJson<T>("/api/founder/attendance-slots", signal);
    return await writeEnvelope(key, cloud, "cloud");
  } catch (cloudError) {
    if (signal?.aborted) throw cloudError;
    const institutionId = await resolveRelayInstitutionId(signal);
    if (institutionId) {
      try {
        const relay = await relayJson<T>(
          `/v1/founder/attendance-slots?${new URLSearchParams({
            institution_id: institutionId,
          }).toString()}`,
          { signal },
        );
        return await writeEnvelope(key, relay, "relay");
      } catch {
        // Cache ci-dessous.
      }
    }
    const cached = await readEnvelope<T>(key);
    if (cached) return { ...cached, source: "cache" };
    throw cloudError;
  }
}

export async function syncRelayBootstrap(options: { force?: boolean } = {}) {
  if (!browser() || !navigator.onLine) return { ok: false, skipped: "offline" as const };
  const last = Number(window.localStorage.getItem(LAST_BOOTSTRAP_KEY) || 0);
  if (!options.force && Date.now() - last < BOOTSTRAP_THROTTLE_MS) {
    return { ok: true, skipped: "throttled" as const };
  }
  if (bootstrapInFlight) return bootstrapInFlight;

  bootstrapInFlight = (async () => {
    try {
      await relayJson<{ ok: boolean }>("/health", {}, {
        timeoutMs: RELAY_PERMISSION_TIMEOUT_MS,
      });
      const snapshot = await cloudJson<any>("/api/admin/offline/bootstrap");
      rememberRelayInstitution(snapshot?.institution_id);
      const result = await relayJson<any>("/v1/sync/bootstrap", {
        method: "POST",
        body: JSON.stringify(snapshot),
      }, {
        timeoutMs: RELAY_BOOTSTRAP_TIMEOUT_MS,
      });
      window.localStorage.setItem(LAST_BOOTSTRAP_KEY, String(Date.now()));
      return { ok: true, result };
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error) };
    } finally {
      bootstrapInFlight = null;
    }
  })();

  return bootstrapInFlight;
}

export async function requestRelayAttendancePresenceProof(input: {
  institutionId: string;
  actorProfileId: string;
  clientSessionId: string;
  baseUrl: string;
  accessToken: string;
}) {
  return await relayJson<{
    ok: true;
    proof: string;
    issued_at: string;
    expires_at: string;
    method: "local_relay";
  }>("/v1/attendance/presence-proof", {
    method: "POST",
    body: JSON.stringify({
      institution_id: input.institutionId,
      actor_profile_id: input.actorProfileId,
      client_session_id: input.clientSessionId,
      access_token: input.accessToken,
    }),
  }, {
    baseUrl: input.baseUrl,
    includeConfiguredToken: false,
    timeoutMs: RELAY_PRESENCE_TIMEOUT_MS,
  });
}

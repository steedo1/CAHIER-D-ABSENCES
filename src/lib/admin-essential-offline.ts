"use client";

import { cacheGet, cacheSet } from "@/lib/offline";
import {
  getRelayConfig,
  getRememberedRelayInstitution,
  rememberRelayInstitution,
  resolveRelayInstitutionId,
} from "@/lib/local-relay";

export type AdminEssentialDataSource = "cloud" | "relay" | "cache";

export type AdminEssentialRead<T> = {
  data: T;
  source: AdminEssentialDataSource;
  saved_at: string;
};

export type AdminRosterPayload = {
  academic_year: string | null;
  classes: Array<Record<string, any>>;
  students: Array<Record<string, any>>;
  institution_settings: Record<string, any>;
};

type CachedRoster = AdminEssentialRead<AdminRosterPayload> & {
  institution_id: string;
};

const ROSTER_CACHE_PREFIX = "relay:admin:essential:roster:";
const CLOUD_TIMEOUT_MS = 4_000;
const RELAY_TIMEOUT_MS = 4_000;

function currentAcademicYearFromDate(date = new Date()) {
  const year = date.getFullYear();
  return date.getMonth() + 1 >= 9
    ? `${year}-${year + 1}`
    : `${year - 1}-${year}`;
}

function rosterCacheKey(institutionId: string) {
  return `${ROSTER_CACHE_PREFIX}${institutionId}`;
}

async function responseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const external = init.signal;
  const onAbort = () => controller.abort(external?.reason);
  external?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }
}

async function cloudJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
    CLOUD_TIMEOUT_MS,
  );
  const payload = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.error || payload?.message || `HTTP_${response.status}`));
  }
  return payload as T;
}

async function relayJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const config = getRelayConfig();
  const headers = new Headers({ Accept: "application/json" });
  if (config.token) headers.set("Authorization", `Bearer ${config.token}`);

  const init: RequestInit & { targetAddressSpace?: "local" | "loopback" } = {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers,
    signal,
  };
  try {
    const hostname = new URL(config.baseUrl).hostname.toLowerCase();
    init.targetAddressSpace =
      hostname === "localhost" || hostname === "::1" || /^127(?:\.|$)/.test(hostname)
        ? "loopback"
        : "local";
  } catch {
    // Le fetch standard reste tente si le navigateur ne comprend pas l'espace d'adresse.
  }

  const response = await fetchWithTimeout(
    `${config.baseUrl}${path}`,
    init as RequestInit,
    RELAY_TIMEOUT_MS,
  );
  const payload = await responseJson(response);
  if (!response.ok) {
    throw new Error(String(payload?.error || `RELAY_HTTP_${response.status}`));
  }
  return payload as T;
}

async function writeRoster(
  institutionId: string,
  payload: AdminRosterPayload,
  source: AdminEssentialDataSource,
): Promise<AdminEssentialRead<AdminRosterPayload>> {
  const envelope: CachedRoster = {
    institution_id: institutionId,
    data: payload,
    source,
    saved_at: new Date().toISOString(),
  };
  try {
    await cacheSet(rosterCacheKey(institutionId), envelope);
  } catch {
    // IndexedDB indisponible : la lecture courante reste utilisable.
  }
  return envelope;
}

async function readRosterCache(
  institutionId: string,
): Promise<AdminEssentialRead<AdminRosterPayload> | null> {
  try {
    const cached = await cacheGet<CachedRoster>(rosterCacheKey(institutionId));
    if (!cached || cached.institution_id !== institutionId || !cached.data) return null;
    return { ...cached, source: "cache" };
  } catch {
    return null;
  }
}

function normalizeCloudRoster(input: {
  classes: any;
  students: any;
  settings: any;
  years: any;
}): AdminRosterPayload {
  const years = Array.isArray(input.years?.items) ? input.years.items : [];
  const currentYear = years.find((row: any) => row?.is_current === true)?.code;
  return {
    academic_year:
      String(input.classes?.academic_year || currentYear || "").trim() ||
      currentAcademicYearFromDate(),
    classes: Array.isArray(input.classes?.items) ? input.classes.items : [],
    students: Array.isArray(input.students?.items) ? input.students.items : [],
    institution_settings:
      input.settings && typeof input.settings === "object" ? input.settings : {},
  };
}

export async function fetchAdminEssentialRoster(
  signal?: AbortSignal,
): Promise<AdminEssentialRead<AdminRosterPayload>> {
  let institutionId = getRememberedRelayInstitution();

  try {
    const [role, classes, students, settings, years] = await Promise.all([
      cloudJson<{ institution_id?: string | null }>("/api/auth/role", signal),
      cloudJson<any>("/api/admin/classes?limit=999", signal),
      cloudJson<any>("/api/admin/students", signal),
      cloudJson<any>("/api/admin/institution/settings", signal),
      cloudJson<any>("/api/admin/institution/academic-years", signal),
    ]);
    const cloudInstitutionId = String(role?.institution_id || institutionId || "").trim();
    if (!cloudInstitutionId) throw new Error("institution_id_missing");
    institutionId = cloudInstitutionId;
    rememberRelayInstitution(cloudInstitutionId);
    return await writeRoster(
      cloudInstitutionId,
      normalizeCloudRoster({ classes, students, settings, years }),
      "cloud",
    );
  } catch (cloudError) {
    if (signal?.aborted) throw cloudError;
  }

  institutionId = institutionId || (await resolveRelayInstitutionId(signal));
  if (institutionId) {
    try {
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Abidjan",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const query = new URLSearchParams({ institution_id: institutionId, date });
      const dashboard = await relayJson<any>(
        `/v1/admin/dashboard?${query.toString()}`,
        signal,
      );
      if (!dashboard?.roster || !Array.isArray(dashboard.roster.classes)) {
        throw new Error("relay_roster_unavailable");
      }
      const payload: AdminRosterPayload = {
        academic_year: String(dashboard.roster.academic_year || "").trim() || null,
        classes: Array.isArray(dashboard.roster.classes) ? dashboard.roster.classes : [],
        students: Array.isArray(dashboard.roster.students) ? dashboard.roster.students : [],
        institution_settings:
          dashboard.roster.institution_settings &&
          typeof dashboard.roster.institution_settings === "object"
            ? dashboard.roster.institution_settings
            : {},
      };
      return await writeRoster(institutionId, payload, "relay");
    } catch {
      const cached = await readRosterCache(institutionId);
      if (cached) return cached;
    }
  }

  if (institutionId) {
    const cached = await readRosterCache(institutionId);
    if (cached) return cached;
  }

  throw new Error("admin_roster_unavailable");
}

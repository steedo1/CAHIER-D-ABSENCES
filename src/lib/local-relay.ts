"use client";

import { cacheDeleteByPrefixes, cacheGet, cacheSet } from "@/lib/offline";
import {
  buildEducationScopeSearchParams,
  type EducationScopeValue,
} from "@/lib/education-scope";
import type { TeacherAttendanceRelayPayload } from "@/lib/teacher-attendance-protocol";
import type { TeacherSessionOpenRelayPayload } from "@/lib/teacher-session-protocol";
import type {
  TeacherSessionCloseRelayPayload,
  TeacherSessionTransitionRelayPayload,
} from "@/lib/teacher-session-lifecycle-protocol";
import { probeCloudSchedule } from "@/lib/cloud-availability";
import {
  ADMIN_ATTENDANCE_CLOUD_TIMEOUT_MS,
  adminAttendanceCacheKeys,
  createTimedAbortSignal,
  isInstitutionScopedAdminAttendanceEnvelope,
  readCloudRelayCache,
  type AdminAttendanceDataSource,
} from "@/lib/admin-attendance-monitor";

export type LocalDataSource = AdminAttendanceDataSource;

export type LocalReadResult<T> = {
  data: T;
  source: LocalDataSource;
  saved_at: string;
};

type CacheEnvelope<T> = LocalReadResult<T> & {
  institution_id?: string;
};

type RelayConfig = {
  baseUrl: string;
  token: string | null;
};

export type RelayTeacherConnectivityStatus =
  | "reachable"
  | "access_denied"
  | "permission_denied"
  | "incompatible_browser"
  | "unreachable";

export type RelayTeacherScheduleStatus =
  | "matched"
  | "period_missing"
  | "period_mismatch"
  | "ready"
  | "not_prepared";

export type RelayCapabilities = {
  attendance_session_open?: boolean;
  attendance_write?: boolean;
  attendance_session_close?: boolean;
  attendance_transition?: boolean;
  class_device_scope_v1?: boolean;
  bootstrap_revision_ack_v1?: boolean;
  admin_schedule_status_v1?: boolean;
  grades_workspace_v1?: boolean;
  grades_score_write_v1?: boolean;
};

export type RelayTeacherExpectedPeriod = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

export type RelayTeacherPeriodSummary = {
  id: string;
  weekday: number;
  label: string | null;
  start_time: string;
  end_time: string;
};

export type RelayTeacherConnectivityResult = {
  status: RelayTeacherConnectivityStatus;
  checked_at: string;
  institution_id?: string;
  actor_kind?: "teacher" | "class_device";
  class_id?: string | null;
  actor_profile_id?: string | null;
  relay_time?: string;
  schedule_status?: RelayTeacherScheduleStatus;
  relay_period?: RelayTeacherPeriodSummary | null;
  relay_version?: string;
  schema_version?: number;
  protocol_version?: number;
  teacher_attendance_writes_enabled?: boolean;
  grade_score_writes_enabled?: boolean;
  capabilities?: RelayCapabilities;
  snapshot_revision?: number | null;
  generated_at?: string | null;
};

export class LocalRelayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly payload: Record<string, any> | null = null,
  ) {
    super(code);
    this.name = "LocalRelayHttpError";
  }
}

class RelayBootstrapSyncError extends Error {
  constructor(
    code: string,
    readonly details: Record<string, any> | null = null,
  ) {
    super(code);
    this.name = "RelayBootstrapSyncError";
  }
}

const DEFAULT_RELAY_URL =
  process.env.NEXT_PUBLIC_MONCAHIER_RELAY_URL || "http://127.0.0.1:4317";
const RELAY_URL_KEY = "moncahier:relay:url";
const RELAY_TOKEN_KEY = "moncahier:relay:token";
const INSTITUTION_ID_KEY = "moncahier:relay:institution-id";
const LAST_BOOTSTRAP_KEY = "moncahier:relay:last-bootstrap-at";
const ADMIN_SCHEDULE_SYNC_KEY = "moncahier:relay:schedule-sync-state";
const ADMIN_SCHEDULE_SYNC_EVENT = "moncahier:relay:schedule-sync-state";
const BOOTSTRAP_THROTTLE_MS = 5 * 60 * 1000;
const MIN_RELAY_SCHEMA_VERSION = 8;
const RELAY_PROTOCOL_VERSION = 1;
const RELAY_TIMEOUT_MS = 5_000;
const RELAY_PERMISSION_TIMEOUT_MS = 15_000;
const RELAY_BOOTSTRAP_TIMEOUT_MS = 60_000;
const RELAY_PRESENCE_TIMEOUT_MS = 5_000;
let bootstrapInFlight: Promise<any> | null = null;
let adminScheduleSyncQueue: Promise<any> = Promise.resolve(null);

export type AdminScheduleSyncState = {
  status: "pending" | "syncing" | "synced";
  updated_at: string;
  snapshot_revision?: number | null;
  relay_revision?: number | null;
  error?: string | null;
  error_details?: Record<string, any> | null;
};

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

function supportsRelayTargetAddressSpace() {
  return browser() && typeof Request !== "undefined" && "targetAddressSpace" in Request.prototype;
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

export function getAdminScheduleSyncState(): AdminScheduleSyncState | null {
  if (!browser()) return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(ADMIN_SCHEDULE_SYNC_KEY) || "null",
    );
    return parsed && typeof parsed === "object"
      ? parsed as AdminScheduleSyncState
      : null;
  } catch {
    return null;
  }
}

function setAdminScheduleSyncState(state: AdminScheduleSyncState) {
  if (!browser()) return;
  window.localStorage.setItem(ADMIN_SCHEDULE_SYNC_KEY, JSON.stringify(state));
  window.dispatchEvent(
    new CustomEvent(ADMIN_SCHEDULE_SYNC_EVENT, { detail: state }),
  );
}

export function subscribeAdminScheduleSync(
  listener: (state: AdminScheduleSyncState | null) => void,
) {
  if (!browser()) return () => undefined;
  const handler = (event: Event) => {
    listener((event as CustomEvent<AdminScheduleSyncState>).detail || null);
  };
  window.addEventListener(ADMIN_SCHEDULE_SYNC_EVENT, handler);
  return () => window.removeEventListener(ADMIN_SCHEDULE_SYNC_EVENT, handler);
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
  return createTimedAbortSignal(
    external,
    timeoutMs,
    "Le relais local n'a pas répondu dans le délai prévu.",
  );
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
    };
    if (supportsRelayTargetAddressSpace()) {
      relayRequest.targetAddressSpace = relayTargetAddressSpace(baseUrl);
    }
    const response = await fetch(`${baseUrl}${path}`, relayRequest as RequestInit);
    const payload = await safeJson(response);
    if (!response.ok) {
      throw new LocalRelayHttpError(
        response.status,
        String(payload?.error || `RELAY_HTTP_${response.status}`),
        payload && typeof payload === "object" ? payload : null,
      );
    }
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

async function writeEnvelope<T>(
  key: string,
  data: T,
  source: LocalDataSource,
  institutionId?: string | null,
) {
  const envelope: CacheEnvelope<T> = {
    data,
    source,
    saved_at: new Date().toISOString(),
    ...(institutionId ? { institution_id: institutionId } : {}),
  };
  try {
    await cacheSet(key, envelope);
  } catch {
    // IndexedDB peut être indisponible en navigation privée ; la lecture reste utilisable.
  }
  return envelope;
}

async function cloudJson<T>(url: string, signal?: AbortSignal, timeoutMs?: number) {
  const timed = timeoutMs
    ? createTimedAbortSignal(
        signal,
        timeoutMs,
        "Le Cloud n'a pas répondu dans le délai prévu.",
      )
    : null;
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: timed?.signal || signal,
    });
    const payload = await safeJson(response);
    if (!response.ok) throw new Error(String(payload?.error || payload?.message || `HTTP_${response.status}`));
    return payload as T;
  } finally {
    timed?.cleanup();
  }
}

export async function resolveRelayInstitutionId(signal?: AbortSignal) {
  if (!browser()) return null;

  try {
    const role = await cloudJson<{ institution_id?: string | null }>("/api/auth/role", signal);
    const institutionId = String(role?.institution_id || "").trim();
    if (institutionId) rememberRelayInstitution(institutionId);
    if (institutionId) return institutionId;
  } catch {
    // Le Wi-Fi local peut rester actif sans accès Cloud.
  }

  return getRememberedRelayInstitution();
}

function adminAttendanceMonitorQuery(
  from: string,
  to: string,
  educationScope?: EducationScopeValue,
  includeExpectedStatuses = false,
) {
  const query = new URLSearchParams({ from, to });
  if (educationScope) {
    const scopeParams = buildEducationScopeSearchParams(educationScope);
    scopeParams.forEach((value, key) => query.set(key, value));
  }
  if (includeExpectedStatuses) query.set("include_expected", "1");
  return query;
}

function legacyCompatibleAttendanceMonitorRows<T>(rows: T[], includeExpectedStatuses: boolean) {
  if (includeExpectedStatuses) return rows;
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [row];
    const value = row as Record<string, unknown>;
    if (value.status === "not_started") return [];
    if (value.status !== "started") return [row];
    return [{
      ...value,
      status: typeof value.late_minutes === "number" ? "late" : "ok",
    } as T];
  });
}

export async function hasInstitutionScopedAdminAttendanceMonitorCache(
  institutionId: string,
  from: string,
  to: string,
  educationScope?: EducationScopeValue,
): Promise<boolean> {
  if (!browser()) return false;
  const expectedInstitutionId = String(institutionId || "").trim();
  if (!expectedInstitutionId) return false;

  const queryString = adminAttendanceMonitorQuery(
    from,
    to,
    educationScope,
    true,
  ).toString();
  const key = adminAttendanceCacheKeys(queryString, expectedInstitutionId).scoped;
  const envelope = await readEnvelope<{ rows: unknown[] }>(key);
  return isInstitutionScopedAdminAttendanceEnvelope(envelope, expectedInstitutionId);
}

export async function fetchAdminAttendanceMonitor<T>(
  from: string,
  to: string,
  signal?: AbortSignal,
  educationScope?: EducationScopeValue,
  options: { includeExpectedStatuses?: boolean } = {},
): Promise<LocalReadResult<{ rows: T[] }>> {
  const includeExpectedStatuses = options.includeExpectedStatuses === true;
  const query = adminAttendanceMonitorQuery(
    from,
    to,
    educationScope,
    includeExpectedStatuses,
  );

  const queryString = query.toString();
  let institutionId = getRememberedRelayInstitution();
  const scopedKey = (value: string) =>
    adminAttendanceCacheKeys(queryString, value).scoped;
  const legacyKey = adminAttendanceCacheKeys(queryString, institutionId || "").legacy;

  return await readCloudRelayCache<LocalReadResult<{ rows: T[] }>>({
    signal,
    cloud: async () => {
      const cloud = await cloudJson<{ rows: T[]; institution_id?: string | null }>(
        `/api/admin/attendance/monitor?${queryString}`,
        signal,
        ADMIN_ATTENDANCE_CLOUD_TIMEOUT_MS,
      );
      const cloudInstitutionId = String(cloud.institution_id || institutionId || "").trim();
      if (cloudInstitutionId) {
        institutionId = cloudInstitutionId;
        rememberRelayInstitution(cloudInstitutionId);
        return await writeEnvelope(
          scopedKey(cloudInstitutionId),
          cloud,
          "cloud",
          cloudInstitutionId,
        );
      }
      return {
        data: cloud,
        source: "cloud",
        saved_at: new Date().toISOString(),
      };
    },
    relay: institutionId
      ? async () => {
          const relayInstitutionId = institutionId as string;
          const relayQuery = new URLSearchParams(query);
          relayQuery.set("institution_id", relayInstitutionId);
          const relay = await relayJson<{ rows: T[] }>(
            `/v1/admin/attendance/monitor?${relayQuery.toString()}`,
            { signal },
          );
          const compatibleRelay = {
            ...relay,
            rows: legacyCompatibleAttendanceMonitorRows(
              relay.rows || [],
              includeExpectedStatuses,
            ),
          };
          return await writeEnvelope(
            scopedKey(relayInstitutionId),
            compatibleRelay,
            "relay",
            relayInstitutionId,
          );
        }
      : undefined,
    cache: async () => {
      if (!institutionId) return null;

      const currentKey = scopedKey(institutionId);
      const scoped = await readEnvelope<{ rows: T[] }>(currentKey);
      if (scoped && isInstitutionScopedAdminAttendanceEnvelope(scoped, institutionId)) {
        return { ...scoped, source: "cache" };
      }

      // Compatibilité uniquement avec une enveloppe legacy qui portait déjà
      // une identité vérifiable. Une ancienne vue non scoped n'est jamais attribuée
      // implicitement au compte actuellement mémorisé.
      const legacy = await readEnvelope<{ rows: T[] }>(legacyKey);
      if (!legacy || !isInstitutionScopedAdminAttendanceEnvelope(legacy, institutionId)) return null;
      const migrated: CacheEnvelope<{ rows: T[] }> = {
        ...legacy,
      };
      try {
        await cacheSet(currentKey, migrated);
      } catch {
        // La vue legacy reste lisible même si IndexedDB refuse la migration.
      }
      return { ...migrated, source: "cache" };
    },
  });
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

function safeRelayRevision(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function relayFailureDetails(
  health: Record<string, any>,
  snapshot: Record<string, any>,
  result: Record<string, any>,
) {
  return {
    relay_status: String(result?.status || "unknown"),
    relay_version: String(health?.relay_version || "") || null,
    relay_schema_version: safeRelayRevision(health?.schema_version),
    relay_protocol_version: safeRelayRevision(health?.protocol_version),
    snapshot_id: String(snapshot?.snapshot_id || "") || null,
    expected_revision: safeRelayRevision(
      snapshot?.academic_manifest ? snapshot?.academic_revision : snapshot?.snapshot_revision,
    ),
    applied_revision: safeRelayRevision(result?.applied_snapshot_revision),
    rejected_entities: safeRelayRevision(result?.rejected_entities) || 0,
    source_skipped_entities: safeRelayRevision(result?.source_skipped_entities) || 0,
    diagnostics: Array.isArray(result?.diagnostics)
      ? result.diagnostics.slice(0, 10)
      : [],
  };
}

async function loadCompleteRelaySnapshot() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await cloudJson<any>("/api/admin/offline/bootstrap");
    const snapshotRevision = safeRelayRevision(
      snapshot?.academic_manifest ? snapshot?.academic_revision : snapshot?.snapshot_revision,
    );
    if (
      snapshot?.snapshot_completeness === "complete" &&
      snapshotRevision !== null
    ) {
      return { snapshot, snapshotRevision };
    }
    const changedDuringGeneration =
      snapshot?.diagnostics?.revision_changed_during_generation === true;
    if (attempt === 0 && changedDuringGeneration) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      continue;
    }
    throw new RelayBootstrapSyncError("bootstrap_snapshot_not_complete", {
      snapshot_completeness: snapshot?.snapshot_completeness || null,
      snapshot_revision: snapshotRevision,
      diagnostics: snapshot?.diagnostics || null,
    });
  }
  throw new RelayBootstrapSyncError("bootstrap_snapshot_not_complete");
}

async function verifiedRelayScheduleRevision(institutionId: string) {
  const query = new URLSearchParams({ institution_id: institutionId });
  try {
    const status = await relayJson<any>(
      `/v1/admin/schedule-status?${query.toString()}`,
      {},
      { timeoutMs: RELAY_PERMISSION_TIMEOUT_MS },
    );
    return safeRelayRevision(status?.snapshot_revision);
  } catch {
    try {
      const health = await relayJson<any>("/health", {}, {
        timeoutMs: RELAY_PERMISSION_TIMEOUT_MS,
      });
      return safeRelayRevision(health?.snapshot_revision);
    } catch {
      return null;
    }
  }
}

export function relayBootstrapErrorMessage(
  input: { error?: unknown; details?: Record<string, any> | null } | unknown,
  fallback = "Le relais local n'a pas pu être synchronisé.",
) {
  const value = input && typeof input === "object"
    ? input as { error?: unknown; details?: Record<string, any> | null }
    : { error: input };
  const code = String(value.error || "").trim();
  const details = value.details || {};
  if (code === "relay_update_required") {
    const installed = safeRelayRevision(details.relay_schema_version);
    const suffix = installed === null
      ? ""
      : ` (schéma installé ${installed}, attendu ${MIN_RELAY_SCHEMA_VERSION})`;
    return `Le programme du PC relais est ancien${suffix}. Double-cliquez sur « Mettre-A-Jour-Mon-Cahier.cmd » dans le dossier du relais, puis réessayez.`;
  }
  if (code === "relay_bootstrap_partial") {
    const rejected = safeRelayRevision(details.rejected_entities) || 0;
    const first = Array.isArray(details.diagnostics) ? details.diagnostics[0] : null;
    const diagnostic = first && typeof first === "object"
      ? first as Record<string, unknown>
      : null;
    const reason = diagnostic
      ? String(diagnostic.reason || diagnostic.error || "").trim()
      : "";
    const quantity = rejected > 1 ? `${rejected} données` : "une donnée";
    return `Le relais a refusé ${quantity} du snapshot. L'ancien planning reste protégé${reason ? ` (${reason})` : ""}.`;
  }
  if (code === "relay_revision_ack_missing") {
    return "Le relais a reçu les données mais n'a pas fourni l'accusé de révision attendu. Lancez « Mettre-A-Jour-Mon-Cahier.cmd » sur le PC relais, puis réessayez.";
  }
  if (code === "relay_revision_mismatch" || code === "relay_schedule_revision_not_acknowledged") {
    return "Le relais n'a pas confirmé la dernière révision du planning. L'ancien planning reste actif hors ligne par sécurité.";
  }
  if (code === "relay_sync_required_after_cloud_mutation") {
    return "La modification Cloud attend encore d'être transmise au PC relais.";
  }
  if (code === "bootstrap_snapshot_not_complete") {
    return "Les données Cloud ont changé pendant la préparation du relais. Réessayez dans quelques secondes.";
  }
  if (code === "unauthorized") {
    return "Le jeton administrateur du relais est invalide ou ne correspond pas à cet établissement.";
  }
  if (code === "relay_bootstrap_rejected") {
    return "Le relais a refusé le snapshot reçu. Consultez le diagnostic du relais puis réessayez.";
  }
  if (code === "Failed to fetch" || code.includes("délai") || code.includes("aborted")) {
    return "Le PC relais ne répond pas. Vérifiez qu'il est allumé et que le service Mon Cahier Relay est lancé.";
  }
  return code || fallback;
}

export async function syncRelayBootstrap(options: { force?: boolean } = {}) {
  if (!browser()) return { ok: false, skipped: "server" as const };
  const last = Number(window.localStorage.getItem(LAST_BOOTSTRAP_KEY) || 0);
  if (!options.force && Date.now() - last < BOOTSTRAP_THROTTLE_MS) {
    return { ok: true, skipped: "throttled" as const };
  }
  if (bootstrapInFlight) return bootstrapInFlight;

  bootstrapInFlight = (async () => {
    try {
      const health = await relayJson<any>("/health", {}, {
        timeoutMs: RELAY_PERMISSION_TIMEOUT_MS,
      });
      const schemaVersion = safeRelayRevision(health?.schema_version);
      const protocolVersion = safeRelayRevision(health?.protocol_version);
      if (
        schemaVersion === null ||
        schemaVersion < MIN_RELAY_SCHEMA_VERSION ||
        protocolVersion !== RELAY_PROTOCOL_VERSION
      ) {
        throw new RelayBootstrapSyncError("relay_update_required", {
          relay_version: health?.relay_version || null,
          relay_schema_version: schemaVersion,
          relay_protocol_version: protocolVersion,
          expected_schema_version: MIN_RELAY_SCHEMA_VERSION,
          expected_protocol_version: RELAY_PROTOCOL_VERSION,
        });
      }

      const { snapshot, snapshotRevision } = await loadCompleteRelaySnapshot();
      const institutionId = String(snapshot?.institution_id || "").trim();
      if (!institutionId) {
        throw new RelayBootstrapSyncError("bootstrap_institution_missing");
      }
      rememberRelayInstitution(institutionId);

      const result = await relayJson<any>("/v1/sync/bootstrap", {
        method: "POST",
        body: JSON.stringify(snapshot),
      }, {
        timeoutMs: RELAY_BOOTSTRAP_TIMEOUT_MS,
      });
      const status = String(result?.status || "");
      const details = relayFailureDetails(health, snapshot, result);

      if (status === "partial") {
        throw new RelayBootstrapSyncError("relay_bootstrap_partial", details);
      }
      if (status !== "applied" && status !== "duplicate") {
        throw new RelayBootstrapSyncError("relay_bootstrap_rejected", details);
      }

      let appliedRevision = safeRelayRevision(result?.applied_snapshot_revision);
      let acknowledgementSource = "bootstrap_response";
      if (appliedRevision !== snapshotRevision) {
        if (!snapshot?.academic_manifest) {
          const verifiedRevision = await verifiedRelayScheduleRevision(institutionId);
          if (verifiedRevision === snapshotRevision) {
            appliedRevision = verifiedRevision;
            acknowledgementSource = "schedule_status";
          }
        }
      }
      if (appliedRevision === null) {
        throw new RelayBootstrapSyncError("relay_revision_ack_missing", details);
      }
      if (appliedRevision !== snapshotRevision) {
        throw new RelayBootstrapSyncError("relay_revision_mismatch", {
          ...details,
          applied_revision: appliedRevision,
        });
      }

      const acknowledgedResult = {
        ...result,
        applied_snapshot_revision: appliedRevision,
        acknowledgement_source: acknowledgementSource,
      };
      window.localStorage.setItem(LAST_BOOTSTRAP_KEY, String(Date.now()));
      return {
        ok: true,
        result: acknowledgedResult,
        snapshot_revision: snapshotRevision,
      };
    } catch (error: any) {
      if (error instanceof RelayBootstrapSyncError) {
        return { ok: false, error: error.message, details: error.details };
      }
      if (error instanceof LocalRelayHttpError) {
        return {
          ok: false,
          error: error.code,
          details: {
            http_status: error.status,
            ...(error.payload || {}),
          },
        };
      }
      return { ok: false, error: String(error?.message || error), details: null };
    } finally {
      bootstrapInFlight = null;
    }
  })();

  return bootstrapInFlight;
}

export function syncRelayScheduleAfterMutation() {
  const job = adminScheduleSyncQueue
    .catch(() => null)
    .then(async () => {
      setAdminScheduleSyncState({
        status: "syncing",
        updated_at: new Date().toISOString(),
      });
      const result = await syncRelayBootstrap({ force: true });
      if (result.ok) {
        const revision = Number(result.snapshot_revision);
        setAdminScheduleSyncState({
          status: "synced",
          updated_at: new Date().toISOString(),
          snapshot_revision: revision,
          relay_revision: safeRelayRevision(result.result?.applied_snapshot_revision),
          error: null,
          error_details: null,
        });
      } else {
        setAdminScheduleSyncState({
          status: "pending",
          updated_at: new Date().toISOString(),
          error: String(result.error || "relay_schedule_sync_failed"),
          error_details: result.details || null,
        });
      }
      return result;
    });
  adminScheduleSyncQueue = job;
  return job;
}

export function markRelayScheduleSyncPending() {
  setAdminScheduleSyncState({
    status: "pending",
    updated_at: new Date().toISOString(),
    error: "relay_sync_required_after_cloud_mutation",
    error_details: null,
  });
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

export async function postRelayTeacherAttendanceOperation(input: {
  baseUrl: string;
  accessToken: string;
  payload: TeacherAttendanceRelayPayload;
}) {
  return await relayJson<{
    ok: true;
    operation_id: string;
    state: "secured_on_relay" | "synced_with_cloud" | "blocked" | "conflict";
    idempotent: boolean;
    relay_time: string;
  }>("/v1/teacher/attendance-operations", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify(input.payload),
  }, {
    baseUrl: input.baseUrl,
    includeConfiguredToken: false,
    timeoutMs: RELAY_PRESENCE_TIMEOUT_MS,
  });
}

export async function postRelayTeacherAttendanceSessionOpen(input: {
  baseUrl: string;
  accessToken: string;
  payload: TeacherSessionOpenRelayPayload;
}) {
  return await relayJson<{
    ok: true;
    operation_id: string;
    state: "opened_on_relay" | "synced_with_cloud" | "blocked" | "conflict";
    idempotent: boolean;
    session: {
      id: string;
      client_session_id: string;
      class_id: string;
      subject_id: string;
      period_id: string;
      started_at: string;
      actual_call_at: string | null;
      scheduled_end_at: string | null;
      grace_expires_at: string | null;
      session_state: "open" | "finalizing" | "closed";
    };
    presence_proof: string;
    proof_expires_at: string;
    relay_time: string;
  }>("/v1/teacher/attendance-sessions/open", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify(input.payload),
  }, {
    baseUrl: input.baseUrl,
    includeConfiguredToken: false,
    timeoutMs: RELAY_PRESENCE_TIMEOUT_MS,
  });
}

export async function postRelayTeacherAttendanceSessionClose(input: {
  baseUrl: string;
  accessToken: string;
  payload: TeacherSessionCloseRelayPayload;
}) {
  return await relayJson<{
    ok: true;
    operation_id: string;
    idempotent: boolean;
    already_closed: boolean;
    relay_time: string;
    session: {
      id: string;
      session_state: "closed";
      closed_at: string;
      scheduled_end_at: string;
      payable_end_at: string;
      closure_source: string;
      closure_confirmation: "confirmed" | "unconfirmed";
      requires_payroll_review: boolean;
    };
  }>("/v1/teacher/attendance-sessions/close", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify(input.payload),
  }, {
    baseUrl: input.baseUrl,
    includeConfiguredToken: false,
    timeoutMs: RELAY_PRESENCE_TIMEOUT_MS,
  });
}

export async function postRelayTeacherAttendanceSessionTransition(input: {
  baseUrl: string;
  accessToken: string;
  payload: TeacherSessionTransitionRelayPayload;
}) {
  return await relayJson<{
    ok: true;
    operation_id: string;
    state: string;
    idempotent: boolean;
    requested_start_at: string;
    relay_time: string;
    previous_session: {
      id: string;
      session_state: "closed";
      closure_source: "next_slot_takeover";
      closure_confirmation: "unconfirmed";
      requires_payroll_review: true;
      attendance_snapshot_status: "none" | "partial" | "complete";
    };
    session: {
      id: string;
      client_session_id: string;
      class_id: string;
      subject_id: string;
      period_id: string;
      started_at: string;
      requested_start_at: string;
      actual_call_at: string | null;
      scheduled_end_at: string | null;
      grace_expires_at: string | null;
      session_state: "open" | "finalizing" | "closed";
    };
    presence_proof: string | null;
    proof_expires_at: string | null;
  }>("/v1/teacher/attendance-sessions/transition", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify(input.payload),
  }, {
    baseUrl: input.baseUrl,
    includeConfiguredToken: false,
    timeoutMs: RELAY_PRESENCE_TIMEOUT_MS,
  });
}

async function localNetworkPermissionDenied(baseUrl: string) {
  if (!browser() || !navigator.permissions?.query) return false;
  const permissionName = relayTargetAddressSpace(baseUrl) === "loopback"
    ? "loopback-network"
    : "local-network";
  try {
    const result = await navigator.permissions.query({ name: permissionName } as any);
    return result.state === "denied";
  } catch {
    return false;
  }
}

function requiresLocalHttpException(baseUrl: string) {
  if (!browser() || !window.isSecureContext) return false;
  try {
    return new URL(baseUrl).protocol === "http:";
  } catch {
    return false;
  }
}

export async function checkRelayTeacherConnectivity(input: {
  institutionId: string;
  baseUrl: string;
  accessToken: string;
  expectedPeriod?: RelayTeacherExpectedPeriod | null;
}): Promise<RelayTeacherConnectivityResult> {
  const checkedAt = new Date().toISOString();
  const institutionId = String(input.institutionId || "").trim();
  const accessToken = String(input.accessToken || "").trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!browser() || !institutionId || !accessToken) {
    return { status: "unreachable", checked_at: checkedAt };
  }

  try {
    const response = await relayJson<{
      ok: true;
      institution_id: string;
      actor_kind?: "teacher" | "class_device";
      class_id?: string | null;
      actor_profile_id?: string | null;
      relay_time: string;
      schedule_status?: RelayTeacherScheduleStatus;
      relay_period?: RelayTeacherPeriodSummary | null;
      relay_version?: string;
      schema_version?: number;
      protocol_version?: number;
      teacher_attendance_writes_enabled?: boolean;
      grade_score_writes_enabled?: boolean;
      capabilities?: RelayCapabilities;
      snapshot_revision?: number | null;
      generated_at?: string | null;
    }>("/v1/teacher/connectivity-check", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(
        input.expectedPeriod
          ? {
              expected_period: {
                id: String(input.expectedPeriod.id || "").trim(),
                weekday: Number(input.expectedPeriod.weekday),
                start_time: String(input.expectedPeriod.start_time || "").slice(0, 5),
                end_time: String(input.expectedPeriod.end_time || "").slice(0, 5),
              },
            }
          : {},
      ),
    }, {
      baseUrl,
      includeConfiguredToken: false,
      timeoutMs: RELAY_PERMISSION_TIMEOUT_MS,
    });
    if (response.ok !== true || String(response.institution_id || "").trim() !== institutionId) {
      return { status: "unreachable", checked_at: checkedAt };
    }
    return {
      status: "reachable",
      checked_at: checkedAt,
      institution_id: institutionId,
      actor_kind: response.actor_kind,
      class_id: response.class_id,
      actor_profile_id: response.actor_profile_id,
      relay_time: response.relay_time,
      schedule_status: response.schedule_status,
      relay_period: response.relay_period,
      relay_version: response.relay_version,
      schema_version: response.schema_version,
      protocol_version: response.protocol_version,
      teacher_attendance_writes_enabled:
        response.teacher_attendance_writes_enabled,
      grade_score_writes_enabled: response.grade_score_writes_enabled,
      capabilities: response.capabilities,
      snapshot_revision:
        response.snapshot_revision === null
          ? null
          : Number(response.snapshot_revision),
      generated_at: response.generated_at,
    };
  } catch (error) {
    if (error instanceof LocalRelayHttpError && error.status === 401) {
      return { status: "access_denied", checked_at: checkedAt };
    }
    const permissionDenied =
      (error instanceof DOMException && error.name === "NotAllowedError") ||
      await localNetworkPermissionDenied(baseUrl);
    if (permissionDenied) {
      return { status: "permission_denied", checked_at: checkedAt };
    }
    if (requiresLocalHttpException(baseUrl) && !supportsRelayTargetAddressSpace()) {
      return { status: "incompatible_browser", checked_at: checkedAt };
    }
    return { status: "unreachable", checked_at: checkedAt };
  }
}

export type RelayTeacherOfflineSchedule = {
  version: 1;
  scope_version?: number;
  institution_id: string;
  actor_kind?: "teacher" | "class_device";
  class_id?: string | null;
  actor_profile_id?: string | null;
  schedule_revision: number;
  generated_at: string | null;
  relay_time?: string | null;
  snapshot_completeness: "complete";
  source: "relay" | "cloud";
  slots: Array<{
    key: string;
    period_id: string;
    weekday: number;
    label: string;
    start_time: string;
    end_time: string;
    items: Array<{
      class_id: string;
      class_label: string;
      level: string;
      subject_id: string;
      subject_name: string;
      teacher_id?: string;
    }>;
  }>;
  class_count: number;
  slot_count: number;
  rosters: Record<string, { items: Array<Record<string, unknown>> }>;
  assignments: Array<{
    institution_id?: string;
    class_id?: string;
    teacher_id?: string;
    subject_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  }>;
};

export async function fetchRelayTeacherOfflineSchedule(input: {
  institutionId: string;
  baseUrl: string;
  accessToken: string;
}) {
  const schedule = await relayJson<RelayTeacherOfflineSchedule>(
    "/v1/teacher/offline-schedule",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      body: "{}",
    },
    {
      baseUrl: input.baseUrl,
      includeConfiguredToken: false,
      timeoutMs: RELAY_PERMISSION_TIMEOUT_MS,
    },
  );
  if (
    schedule.snapshot_completeness !== "complete" ||
    String(schedule.institution_id || "").trim() !==
      String(input.institutionId || "").trim() ||
    !Number.isSafeInteger(Number(schedule.schedule_revision))
  ) {
    throw new Error("relay_schedule_snapshot_invalid");
  }
  return schedule;
}

export async function cloudScheduleAvailable() {
  return await probeCloudSchedule();
}

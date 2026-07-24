"use client";

import { cacheGet, cacheSet } from "@/lib/offline";
import {
  LocalRelayHttpError,
  postRelayTeacherAttendanceSessionOpen,
} from "@/lib/local-relay";
import {
  buildTeacherSessionOpenRelayPayload,
  type TeacherSessionOpenRelayPayload,
} from "@/lib/teacher-session-protocol";

export type TeacherSessionDeliveryState =
  | "device_pending"
  | "relay_opened"
  | "blocked";

export type TeacherSessionDeliveryRecord = {
  schema_version: 1;
  institution_id: string;
  operation_id: string;
  class_id: string;
  period_id: string;
  attempt_key: string;
  content_key: string;
  state: TeacherSessionDeliveryState;
  session_id: string | null;
  subject_id: string | null;
  started_at: string | null;
  actual_call_at: string | null;
  scheduled_end_at: string | null;
  grace_expires_at: string | null;
  session_state: "open" | "finalizing" | "closed" | null;
  created_at: string;
  updated_at: string;
  relay_attempted_at: string | null;
  last_status: number | null;
  last_error: string | null;
  last_details?: Record<string, unknown> | null;
  requires_authentication: boolean;
};

export type TeacherSessionOperationStore = {
  list(institutionId: string): Promise<TeacherSessionDeliveryRecord[]>;
  put(record: TeacherSessionDeliveryRecord): Promise<void>;
};

type DeliveryHttpResponse = {
  ok: boolean;
  status: number;
  body?: Record<string, any> | null;
};

export type TeacherSessionDeliveryDependencies = {
  store: TeacherSessionOperationStore;
  now(): Date;
  createOperationId(): string;
  postRelay(input: {
    baseUrl: string;
    accessToken: string;
    payload: TeacherSessionOpenRelayPayload;
  }): Promise<DeliveryHttpResponse>;
};

export type OpenTeacherSessionOnRelayInput = {
  institutionId: string;
  classId: string;
  periodId: string;
  attemptKey?: string | null;
  relayBaseUrl?: string | null;
  relayAccessToken?: string | null;
};

const STORE_PREFIX = "teacher:session-delivery:v1:";
const inFlight = new Map<string, Promise<TeacherSessionDeliveryRecord>>();

function normalizedText(value: unknown) {
  return String(value || "").trim();
}

function contentKey(classId: string, periodId: string, attemptKey: string) {
  return JSON.stringify({ class_id: classId, period_id: periodId, attempt_key: attemptKey });
}

function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createIndexedDbTeacherSessionStore(): TeacherSessionOperationStore {
  return {
    async list(institutionId) {
      const records = await cacheGet<TeacherSessionDeliveryRecord[]>(
        `${STORE_PREFIX}${institutionId}`,
      );
      return Array.isArray(records)
        ? records.filter((record) => record?.schema_version === 1)
        : [];
    },
    async put(record) {
      const key = `${STORE_PREFIX}${record.institution_id}`;
      const records = await cacheGet<TeacherSessionDeliveryRecord[]>(key);
      const next = Array.isArray(records) ? [...records] : [];
      const index = next.findIndex((candidate) =>
        candidate.institution_id === record.institution_id &&
        candidate.operation_id === record.operation_id,
      );
      if (index >= 0) next[index] = record;
      else next.push(record);
      await cacheSet(key, next);
    },
  };
}

async function storePatch(
  deps: TeacherSessionDeliveryDependencies,
  record: TeacherSessionDeliveryRecord,
  patch: Partial<TeacherSessionDeliveryRecord>,
) {
  const next = { ...record, ...patch, updated_at: deps.now().toISOString() };
  await deps.store.put(next);
  return next;
}

async function getOrCreateRecord(
  input: {
    institutionId: string;
    classId: string;
    periodId: string;
    attemptKey: string;
  },
  deps: TeacherSessionDeliveryDependencies,
) {
  const records = await deps.store.list(input.institutionId);
  const expectedContent = contentKey(input.classId, input.periodId, input.attemptKey);
  const existing = records
    .filter((record) => record.content_key === expectedContent)
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .at(-1);
  if (existing) return existing;

  const timestamp = deps.now().toISOString();
  const created: TeacherSessionDeliveryRecord = {
    schema_version: 1,
    institution_id: input.institutionId,
    operation_id: deps.createOperationId(),
    class_id: input.classId,
    period_id: input.periodId,
    attempt_key: input.attemptKey,
    content_key: expectedContent,
    state: "device_pending",
    session_id: null,
    subject_id: null,
    started_at: null,
    actual_call_at: null,
    scheduled_end_at: null,
    grace_expires_at: null,
    session_state: null,
    created_at: timestamp,
    updated_at: timestamp,
    relay_attempted_at: null,
    last_status: null,
    last_error: null,
    requires_authentication: false,
    last_details: null,
  };
  await deps.store.put(created);
  return created;
}

function errorCode(response: DeliveryHttpResponse) {
  const code = normalizedText(response.body?.error || response.body?.message);
  return code && code.length <= 256 ? code : `relay_http_${response.status}`;
}

async function openInternal(
  input: OpenTeacherSessionOnRelayInput,
  deps: TeacherSessionDeliveryDependencies,
) {
  const institutionId = normalizedText(input.institutionId);
  const classId = normalizedText(input.classId);
  const periodId = normalizedText(input.periodId);
  const attemptKey = normalizedText(input.attemptKey) || `${classId}:${periodId}`;
  const relayBaseUrl = normalizedText(input.relayBaseUrl);
  const relayAccessToken = normalizedText(input.relayAccessToken);
  if (!institutionId) throw new Error("institution_id_required");
  if (!classId) throw new Error("class_id_required");
  if (!periodId) throw new Error("period_id_required");

  const current = await getOrCreateRecord({ institutionId, classId, periodId, attemptKey }, deps);
  if (current.state === "relay_opened") return current;
  if (!relayBaseUrl || !relayAccessToken) {
    return await storePatch(deps, current, {
      state: "device_pending",
      last_error: "relay_configuration_missing",
    });
  }

  const attempted = await storePatch(deps, current, {
    relay_attempted_at: deps.now().toISOString(),
    last_status: null,
    last_error: "relay_session_open_in_progress",
    requires_authentication: false,
    last_details: null,
  });
  const payload = buildTeacherSessionOpenRelayPayload({
    operationId: attempted.operation_id,
    classId,
    periodId,
  });

  let response: DeliveryHttpResponse;
  try {
    response = await deps.postRelay({
      baseUrl: relayBaseUrl,
      accessToken: relayAccessToken,
      payload,
    });
  } catch {
    return await storePatch(deps, attempted, {
      state: "device_pending",
      last_status: 0,
      last_error: "relay_unreachable",
    });
  }

  if (response.ok) {
    const session = response.body?.session;
    const operationId = normalizedText(response.body?.operation_id);
    const sessionId = normalizedText(session?.id);
    const responseClassId = normalizedText(session?.class_id);
    const responsePeriodId = normalizedText(session?.period_id);
    if (
      operationId !== attempted.operation_id ||
      !sessionId ||
      responseClassId !== classId ||
      responsePeriodId !== periodId
    ) {
      return await storePatch(deps, attempted, {
        state: "blocked",
        last_status: response.status,
        last_error: "relay_session_open_response_mismatch",
        last_details: null,
      });
    }
    return await storePatch(deps, attempted, {
      state: "relay_opened",
      session_id: sessionId,
      subject_id: normalizedText(session?.subject_id) || null,
      started_at: normalizedText(session?.started_at) || null,
      actual_call_at: normalizedText(session?.actual_call_at) || null,
      scheduled_end_at: normalizedText(session?.scheduled_end_at) || null,
      grace_expires_at: normalizedText(session?.grace_expires_at) || null,
      session_state: session?.session_state === "open" ||
          session?.session_state === "finalizing" || session?.session_state === "closed"
        ? session.session_state
        : null,
      last_status: response.status,
      last_error: null,
      last_details: null,
    });
  }

  const code = errorCode(response);
  const details = response.body?.details && typeof response.body.details === "object"
    ? response.body.details as Record<string, unknown>
    : null;
  if (response.status === 404 && code !== "class_not_found" && code !== "period_not_found") {
    return await storePatch(deps, attempted, {
      state: "device_pending",
      last_status: response.status,
      last_error: "relay_session_open_route_unavailable",
      last_details: null,
    });
  }
  if (response.status === 503 && code === "teacher_attendance_writes_disabled") {
    return await storePatch(deps, attempted, {
      state: "device_pending",
      last_status: response.status,
      last_error: code,
      last_details: details,
    });
  }
  if (response.status === 401) {
    return await storePatch(deps, attempted, {
      state: "device_pending",
      last_status: response.status,
      last_error: "authentication_required",
      last_details: null,
      requires_authentication: true,
    });
  }
  if ([400, 403, 404, 409, 422, 428].includes(response.status)) {
    return await storePatch(deps, attempted, {
      state: "blocked",
      last_status: response.status,
      last_error: code,
      last_details: details,
    });
  }
  return await storePatch(deps, attempted, {
    state: "device_pending",
    last_status: response.status,
    last_error: code,
    last_details: details,
  });
}

export async function openTeacherAttendanceSessionWithDependencies(
  input: OpenTeacherSessionOnRelayInput,
  deps: TeacherSessionDeliveryDependencies,
) {
  const lockKey = [input.institutionId, input.classId, input.periodId, input.attemptKey]
    .map(normalizedText)
    .join(":");
  const running = inFlight.get(lockKey);
  if (running) return await running;
  const promise = openInternal(input, deps);
  inFlight.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(lockKey);
  }
}

function productionDependencies(): TeacherSessionDeliveryDependencies {
  return {
    store: createIndexedDbTeacherSessionStore(),
    now: () => new Date(),
    createOperationId: uuid,
    async postRelay(input) {
      try {
        const body = await postRelayTeacherAttendanceSessionOpen(input);
        return { ok: true, status: body.idempotent ? 200 : 201, body };
      } catch (error) {
        if (error instanceof LocalRelayHttpError) {
          return {
            ok: false,
            status: error.status,
            body: { ...(error.payload || {}), error: error.code },
          };
        }
        throw error;
      }
    },
  };
}

export async function teacherSessionCloudAvailable() {
  if (typeof navigator === "undefined" || navigator.onLine === false) return false;
  try {
    const response = await fetch("/api/auth/role", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function openTeacherAttendanceSessionOnRelay(
  input: OpenTeacherSessionOnRelayInput,
) {
  const run = () => openTeacherAttendanceSessionWithDependencies(
    input,
    productionDependencies(),
  );
  const locks = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & {
        locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
      }).locks;
  return locks
    ? await locks.request(
        `moncahier-teacher-session:${input.institutionId}:${input.classId}:${input.periodId}`,
        run,
      )
    : await run();
}

export function teacherSessionDeliveryMessage(record: TeacherSessionDeliveryRecord) {
  if (record.state === "relay_opened") return "Séance ouverte et sécurisée sur le relais local.";
  if (record.last_error === "relay_session_open_route_unavailable") {
    return "Séance conservée sur cet appareil : le relais doit être mis à jour avant l’ouverture locale.";
  }
  if (record.last_error === "teacher_attendance_writes_disabled") {
    return "Séance conservée sur cet appareil : les écritures du relais restent désactivées.";
  }
  if (record.last_error === "attendance_outside_slot") {
    return "Ouverture refusée : l’appel est hors du créneau autorisé.";
  }
  if (record.last_error === "attendance_sunday_not_allowed") {
    return "Ouverture refusée : aucun appel ne peut être ouvert le dimanche.";
  }
  if (record.last_error === "teacher_not_scheduled_for_slot") {
    return "Ouverture refusée : vous n’êtes pas affecté à ce cours dans l’emploi du temps local.";
  }
  if (record.last_error === "teacher_timetable_ambiguous") {
    return "Ouverture refusée : plusieurs cours locaux correspondent à ce créneau.";
  }
  if (record.last_error === "concurrent_session_open" || record.last_error === "session_slot_conflict") {
    return "Ouverture refusée : une autre séance est déjà ouverte.";
  }
  if (record.requires_authentication) {
    return "Séance conservée sur cet appareil : reconnectez-vous avant de réessayer.";
  }
  return "Séance conservée sur cet appareil : relais local inaccessible.";
}

"use client";

import {
  cacheGet,
  cacheSet,
  resolveOfflineSessionReference,
} from "@/lib/offline";
import {
  LocalRelayHttpError,
  postRelayTeacherAttendanceSessionClose,
  postRelayTeacherAttendanceSessionTransition,
} from "@/lib/local-relay";
import {
  buildTeacherSessionCloseRelayPayload,
  buildTeacherSessionTransitionRelayPayload,
  type TeacherSessionCloseRelayPayload,
  type TeacherSessionTransitionRelayPayload,
} from "@/lib/teacher-session-lifecycle-protocol";

export type TeacherSessionLifecycleDeliveryState =
  | "device_pending"
  | "relay_confirmed"
  | "blocked";

export type TeacherSessionLifecycleDeliveryRecord = {
  schema_version: 1;
  institution_id: string;
  operation_id: string;
  kind: "close" | "transition";
  content_key: string;
  session_id: string | null;
  class_id: string | null;
  period_id: string | null;
  /** Absent sur les enregistrements v1 créés avant la reprise ordonnée appel → fermeture. */
  attendance_operation_id?: string | null;
  /** Heure réelle de fin observée sur le téléphone. */
  actual_end_at?: string | null;
  schedule_revision?: number | null;
  timezone?: string | null;
  scheduled_start_at?: string | null;
  attempt_key: string;
  state: TeacherSessionLifecycleDeliveryState;
  device_requested_at: string;
  relay_requested_at: string | null;
  new_session: Record<string, any> | null;
  previous_session: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  relay_attempted_at: string | null;
  last_status: number | null;
  last_error: string | null;
  last_details: Record<string, unknown> | null;
  requires_authentication: boolean;
};

export type TeacherSessionLifecycleStore = {
  list(institutionId: string): Promise<TeacherSessionLifecycleDeliveryRecord[]>;
  put(record: TeacherSessionLifecycleDeliveryRecord): Promise<void>;
};

type HttpResponse = {
  ok: boolean;
  status: number;
  body: Record<string, any> | null;
};

export type TeacherSessionLifecycleDependencies = {
  store: TeacherSessionLifecycleStore;
  now(): Date;
  createOperationId(): string;
  postClose(input: {
    baseUrl: string;
    accessToken: string;
    payload: TeacherSessionCloseRelayPayload;
  }): Promise<HttpResponse>;
  postTransition(input: {
    baseUrl: string;
    accessToken: string;
    payload: TeacherSessionTransitionRelayPayload;
  }): Promise<HttpResponse>;
};

type BaseInput = {
  institutionId: string;
  relayBaseUrl?: string | null;
  relayAccessToken?: string | null;
};

export type CloseTeacherSessionInput = BaseInput & {
  sessionId: string;
  classId?: string | null;
  attendanceOperationId?: string | null;
  operationId?: string | null;
  actualEndAt?: string | null;
  scheduleRevision?: number | null;
  timezone?: string | null;
  scheduledStartAt?: string | null;
  /** Réservé aux reprises différées ; une fermeture directe reste au protocole v1. */
  replayMode?: boolean;
};
export type TransitionTeacherSessionInput = BaseInput & {
  classId: string;
  periodId: string;
  attemptKey?: string | null;
};

const STORE_PREFIX = "teacher:session-lifecycle:v1:";
const inFlight = new Map<string, Promise<TeacherSessionLifecycleDeliveryRecord>>();

function normalizedText(value: unknown) {
  return String(value || "").trim();
}

function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createIndexedDbTeacherSessionLifecycleStore(): TeacherSessionLifecycleStore {
  return {
    async list(institutionId) {
      const value = await cacheGet<TeacherSessionLifecycleDeliveryRecord[]>(
        `${STORE_PREFIX}${institutionId}`,
      );
      return Array.isArray(value)
        ? value.filter((record) => record?.schema_version === 1)
        : [];
    },
    async put(record) {
      const key = `${STORE_PREFIX}${record.institution_id}`;
      const stored = await cacheGet<TeacherSessionLifecycleDeliveryRecord[]>(key);
      const records = Array.isArray(stored) ? [...stored] : [];
      const index = records.findIndex((candidate) =>
        candidate.institution_id === record.institution_id &&
        candidate.operation_id === record.operation_id,
      );
      if (index >= 0) records[index] = record;
      else records.push(record);
      await cacheSet(key, records);
    },
  };
}

async function getOrCreate(
  deps: TeacherSessionLifecycleDependencies,
  input: {
    institutionId: string;
    kind: "close" | "transition";
    contentKey: string;
    sessionId: string | null;
    classId: string | null;
    periodId: string | null;
    attendanceOperationId: string | null;
    attemptKey: string;
    operationId?: string | null;
    actualEndAt?: string | null;
    scheduleRevision?: number | null;
    timezone?: string | null;
    scheduledStartAt?: string | null;
  },
) {
  const records = await deps.store.list(input.institutionId);
  const requestedOperationId = normalizedText(input.operationId);
  const collision = requestedOperationId
    ? records.find((record) => record.operation_id === requestedOperationId)
    : null;
  if (collision && collision.content_key !== input.contentKey) {
    throw new Error("operation_id_reused_with_different_payload");
  }
  const existing = records
    .filter((record) => record.kind === input.kind && record.content_key === input.contentKey)
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .at(-1);
  if (existing) return existing;
  const now = deps.now().toISOString();
  const created: TeacherSessionLifecycleDeliveryRecord = {
    schema_version: 1,
    institution_id: input.institutionId,
    operation_id: requestedOperationId || deps.createOperationId(),
    kind: input.kind,
    content_key: input.contentKey,
    session_id: input.sessionId,
    class_id: input.classId,
    period_id: input.periodId,
    attendance_operation_id: input.attendanceOperationId,
    actual_end_at: normalizedText(input.actualEndAt) || null,
    schedule_revision:
      Number.isSafeInteger(Number(input.scheduleRevision)) && Number(input.scheduleRevision) >= 0
        ? Number(input.scheduleRevision)
        : null,
    timezone: normalizedText(input.timezone) || null,
    scheduled_start_at: normalizedText(input.scheduledStartAt) || null,
    attempt_key: input.attemptKey,
    state: "device_pending",
    device_requested_at: now,
    relay_requested_at: null,
    new_session: null,
    previous_session: null,
    created_at: now,
    updated_at: now,
    relay_attempted_at: null,
    last_status: null,
    last_error: null,
    last_details: null,
    requires_authentication: false,
  };
  await deps.store.put(created);
  return created;
}

async function patchRecord(
  deps: TeacherSessionLifecycleDependencies,
  record: TeacherSessionLifecycleDeliveryRecord,
  patch: Partial<TeacherSessionLifecycleDeliveryRecord>,
) {
  const next = { ...record, ...patch, updated_at: deps.now().toISOString() };
  await deps.store.put(next);
  return next;
}

function errorCode(response: HttpResponse) {
  const code = normalizedText(response.body?.error || response.body?.message);
  return code && code.length <= 256 ? code : `relay_http_${response.status}`;
}

async function applyResponse(
  deps: TeacherSessionLifecycleDependencies,
  record: TeacherSessionLifecycleDeliveryRecord,
  response: HttpResponse,
) {
  if (response.ok) {
    const responseOperationId = normalizedText(response.body?.operation_id);
    if (responseOperationId !== record.operation_id) {
      return await patchRecord(deps, record, {
        state: "blocked",
        last_status: response.status,
        last_error: "relay_operation_id_mismatch",
      });
    }
    if (record.kind === "close") {
      const expectedSessionId =
        normalizedText(record.last_details?.relay_session_id) || record.session_id;
      if (
        normalizedText(response.body?.session?.id) !== expectedSessionId ||
        response.body?.session?.session_state !== "closed"
      ) {
        return await patchRecord(deps, record, {
          state: "blocked",
          last_status: response.status,
          last_error: "relay_session_close_response_mismatch",
        });
      }
    } else if (
      normalizedText(response.body?.session?.class_id) !== record.class_id ||
      normalizedText(response.body?.session?.period_id) !== record.period_id
    ) {
      return await patchRecord(deps, record, {
        state: "blocked",
        last_status: response.status,
        last_error: "relay_session_transition_response_mismatch",
      });
    }
    return await patchRecord(deps, record, {
      state: "relay_confirmed",
      relay_requested_at: normalizedText(
        response.body?.requested_start_at || response.body?.relay_time,
      ) || null,
      new_session: record.kind === "transition" ? response.body?.session || null : null,
      previous_session: record.kind === "transition"
        ? response.body?.previous_session || null
        : response.body?.session || null,
      last_status: response.status,
      last_error: null,
      last_details: null,
    });
  }

  const code = errorCode(response);
  const details = response.body?.details && typeof response.body.details === "object"
    ? response.body.details as Record<string, unknown>
    : null;
  if (response.status === 404) {
    return await patchRecord(deps, record, {
      state: "device_pending",
      last_status: response.status,
      last_error: `relay_session_${record.kind}_route_unavailable`,
      last_details: null,
    });
  }
  if (response.status === 503 && code === "teacher_attendance_writes_disabled") {
    return await patchRecord(deps, record, {
      state: "device_pending",
      last_status: response.status,
      last_error: code,
      last_details: null,
    });
  }
  if (response.status === 401) {
    return await patchRecord(deps, record, {
      state: "device_pending",
      last_status: response.status,
      last_error: "authentication_required",
      last_details: null,
      requires_authentication: true,
    });
  }
  if ([400, 403, 409, 422, 428].includes(response.status)) {
    return await patchRecord(deps, record, {
      state: "blocked",
      last_status: response.status,
      last_error: code,
      last_details: details,
    });
  }
  return await patchRecord(deps, record, {
    state: "device_pending",
    last_status: response.status,
    last_error: code,
    last_details: details,
  });
}

async function postCloseInternal(
  input: CloseTeacherSessionInput,
  deps: TeacherSessionLifecycleDependencies,
) {
  const institutionId = normalizedText(input.institutionId);
  const sessionId = normalizedText(input.sessionId);
  const classId = normalizedText(input.classId) || null;
  const attendanceOperationId =
    normalizedText(input.attendanceOperationId) || null;
  if (!institutionId) throw new Error("institution_id_required");
  if (!sessionId) throw new Error("session_id_required");
  let current = await getOrCreate(deps, {
    institutionId,
    kind: "close",
    contentKey: JSON.stringify({ session_id: sessionId }),
    sessionId,
    classId,
    periodId: null,
    attendanceOperationId,
    attemptKey: sessionId,
    operationId: input.operationId,
    actualEndAt: input.actualEndAt,
    scheduleRevision: input.scheduleRevision,
    timezone: input.timezone,
    scheduledStartAt: input.scheduledStartAt,
  });
  const suppliedRevision = Number(input.scheduleRevision);
  if (
    (!current.class_id && classId) ||
    (!current.attendance_operation_id && attendanceOperationId) ||
    (!current.actual_end_at && normalizedText(input.actualEndAt)) ||
    (current.schedule_revision == null && Number.isSafeInteger(suppliedRevision) && suppliedRevision >= 0) ||
    (!current.timezone && normalizedText(input.timezone)) ||
    (!current.scheduled_start_at && normalizedText(input.scheduledStartAt))
  ) {
    current = await patchRecord(deps, current, {
      class_id: current.class_id || classId,
      attendance_operation_id:
        current.attendance_operation_id || attendanceOperationId,
      actual_end_at: current.actual_end_at || normalizedText(input.actualEndAt) || null,
      schedule_revision:
        current.schedule_revision ??
        (Number.isSafeInteger(suppliedRevision) && suppliedRevision >= 0
          ? suppliedRevision
          : null),
      timezone: current.timezone || normalizedText(input.timezone) || null,
      scheduled_start_at:
        current.scheduled_start_at || normalizedText(input.scheduledStartAt) || null,
    });
  }
  if (current.state === "relay_confirmed") return current;
  const baseUrl = normalizedText(input.relayBaseUrl);
  const accessToken = normalizedText(input.relayAccessToken);
  if (!baseUrl || !accessToken) {
    return await patchRecord(deps, current, {
      state: "device_pending",
      last_error: "relay_configuration_missing",
    });
  }
  const attempted = await patchRecord(deps, current, {
    relay_attempted_at: deps.now().toISOString(),
    last_status: null,
    last_error: "relay_session_close_in_progress",
    last_details: null,
    requires_authentication: false,
  });
  try {
    const resolvedSession = await resolveOfflineSessionReference(sessionId);
    const relaySessionId = resolvedSession.serverSessionId || sessionId;
    const replayRevision = Number(attempted.schedule_revision);
    const replay =
      input.replayMode === true &&
      normalizedText(attempted.actual_end_at) &&
      Number.isSafeInteger(replayRevision) &&
      replayRevision >= 0 &&
      normalizedText(attempted.timezone) &&
      normalizedText(attempted.scheduled_start_at)
        ? {
            eventAt: normalizedText(attempted.actual_end_at),
            queuedAt: attempted.created_at,
            clientSessionId: (
              resolvedSession.sessionReference || sessionId
            ).startsWith("client:")
              ? resolvedSession.sessionReference || sessionId
              : `client:${resolvedSession.sessionReference || sessionId}`,
            scheduleRevision: replayRevision,
            timezone: normalizedText(attempted.timezone),
            scheduledStartAt: normalizedText(attempted.scheduled_start_at),
          }
        : null;
    const attemptedWithResolvedSession = await patchRecord(deps, attempted, {
      last_details: { relay_session_id: relaySessionId },
    });
    return await applyResponse(deps, attemptedWithResolvedSession, await deps.postClose({
      baseUrl,
      accessToken,
      payload: buildTeacherSessionCloseRelayPayload({
        operationId: attempted.operation_id,
        sessionId: relaySessionId,
        replay,
      }),
    }));
  } catch {
    return await patchRecord(deps, attempted, {
      state: "device_pending",
      last_status: 0,
      last_error: "relay_unreachable",
    });
  }
}

export async function closeTeacherAttendanceSessionWithDependencies(
  input: CloseTeacherSessionInput,
  deps: TeacherSessionLifecycleDependencies,
) {
  return await locked(
    `close:${normalizedText(input.institutionId)}:${normalizedText(input.sessionId)}`,
    () => postCloseInternal(input, deps),
  );
}

export async function stageTeacherAttendanceSessionCloseWithDependencies(
  input: CloseTeacherSessionInput,
  deps: TeacherSessionLifecycleDependencies,
) {
  const institutionId = normalizedText(input.institutionId);
  const sessionId = normalizedText(input.sessionId);
  const classId = normalizedText(input.classId) || null;
  const attendanceOperationId =
    normalizedText(input.attendanceOperationId) || null;
  if (!institutionId) throw new Error("institution_id_required");
  if (!sessionId) throw new Error("session_id_required");
  let current = await getOrCreate(deps, {
    institutionId,
    kind: "close",
    contentKey: JSON.stringify({ session_id: sessionId }),
    sessionId,
    classId,
    periodId: null,
    attendanceOperationId,
    attemptKey: sessionId,
    operationId: input.operationId,
    actualEndAt: input.actualEndAt,
    scheduleRevision: input.scheduleRevision,
    timezone: input.timezone,
    scheduledStartAt: input.scheduledStartAt,
  });
  const suppliedRevision = Number(input.scheduleRevision);
  if (
    (!current.class_id && classId) ||
    (!current.attendance_operation_id && attendanceOperationId) ||
    (!current.actual_end_at && normalizedText(input.actualEndAt)) ||
    (current.schedule_revision == null && Number.isSafeInteger(suppliedRevision) && suppliedRevision >= 0) ||
    (!current.timezone && normalizedText(input.timezone)) ||
    (!current.scheduled_start_at && normalizedText(input.scheduledStartAt))
  ) {
    current = await patchRecord(deps, current, {
      class_id: current.class_id || classId,
      attendance_operation_id:
        current.attendance_operation_id || attendanceOperationId,
      actual_end_at: current.actual_end_at || normalizedText(input.actualEndAt) || null,
      schedule_revision:
        current.schedule_revision ??
        (Number.isSafeInteger(suppliedRevision) && suppliedRevision >= 0
          ? suppliedRevision
          : null),
      timezone: current.timezone || normalizedText(input.timezone) || null,
      scheduled_start_at:
        current.scheduled_start_at || normalizedText(input.scheduledStartAt) || null,
    });
  }
  return current;
}

async function postTransitionInternal(
  input: TransitionTeacherSessionInput,
  deps: TeacherSessionLifecycleDependencies,
) {
  const institutionId = normalizedText(input.institutionId);
  const classId = normalizedText(input.classId);
  const periodId = normalizedText(input.periodId);
  const attemptKey = normalizedText(input.attemptKey) || `${classId}:${periodId}`;
  if (!institutionId) throw new Error("institution_id_required");
  if (!classId) throw new Error("class_id_required");
  if (!periodId) throw new Error("period_id_required");
  const current = await getOrCreate(deps, {
    institutionId,
    kind: "transition",
    contentKey: JSON.stringify({ class_id: classId, period_id: periodId, attempt_key: attemptKey }),
    sessionId: null,
    classId,
    periodId,
    attendanceOperationId: null,
    attemptKey,
  });
  if (current.state === "relay_confirmed") return current;
  const baseUrl = normalizedText(input.relayBaseUrl);
  const accessToken = normalizedText(input.relayAccessToken);
  if (!baseUrl || !accessToken) {
    return await patchRecord(deps, current, {
      state: "device_pending",
      last_error: "relay_configuration_missing",
    });
  }
  const attempted = await patchRecord(deps, current, {
    relay_attempted_at: deps.now().toISOString(),
    last_status: null,
    last_error: "relay_session_transition_in_progress",
    last_details: null,
    requires_authentication: false,
  });
  try {
    return await applyResponse(deps, attempted, await deps.postTransition({
      baseUrl,
      accessToken,
      payload: buildTeacherSessionTransitionRelayPayload({
        operationId: attempted.operation_id,
        classId,
        periodId,
      }),
    }));
  } catch {
    return await patchRecord(deps, attempted, {
      state: "device_pending",
      last_status: 0,
      last_error: "relay_unreachable",
    });
  }
}

export async function transitionTeacherAttendanceSessionWithDependencies(
  input: TransitionTeacherSessionInput,
  deps: TeacherSessionLifecycleDependencies,
) {
  return await locked(
    `transition:${normalizedText(input.institutionId)}:${normalizedText(input.classId)}` +
      `:${normalizedText(input.periodId)}:${normalizedText(input.attemptKey)}`,
    () => postTransitionInternal(input, deps),
  );
}

function responseFromError(error: unknown): HttpResponse {
  if (error instanceof LocalRelayHttpError) {
    return {
      ok: false,
      status: error.status,
      body: { ...(error.payload || {}), error: error.code },
    };
  }
  throw error;
}

function productionDependencies(): TeacherSessionLifecycleDependencies {
  return {
    store: createIndexedDbTeacherSessionLifecycleStore(),
    now: () => new Date(),
    createOperationId: uuid,
    async postClose(input) {
      try {
        const body = await postRelayTeacherAttendanceSessionClose(input);
        return { ok: true, status: body.idempotent ? 200 : 202, body };
      } catch (error) {
        return responseFromError(error);
      }
    },
    async postTransition(input) {
      try {
        const body = await postRelayTeacherAttendanceSessionTransition(input);
        return { ok: true, status: body.idempotent ? 200 : 201, body };
      } catch (error) {
        return responseFromError(error);
      }
    },
  };
}

async function locked(
  key: string,
  run: () => Promise<TeacherSessionLifecycleDeliveryRecord>,
) {
  const existing = inFlight.get(key);
  if (existing) return await existing;
  const promise = run();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

export async function closeTeacherAttendanceSessionOnRelay(input: CloseTeacherSessionInput) {
  return await closeTeacherAttendanceSessionWithDependencies(input, productionDependencies());
}

export async function stageTeacherAttendanceSessionClose(input: CloseTeacherSessionInput) {
  return await locked(
    `close:${normalizedText(input.institutionId)}:${normalizedText(input.sessionId)}`,
    () => stageTeacherAttendanceSessionCloseWithDependencies(
      input,
      productionDependencies(),
    ),
  );
}

export async function listTeacherSessionLifecycleOperations(
  institutionId: string,
) {
  const normalizedInstitutionId = normalizedText(institutionId);
  if (!normalizedInstitutionId) return [];
  return await createIndexedDbTeacherSessionLifecycleStore().list(
    normalizedInstitutionId,
  );
}

export async function isTeacherSessionLocallyFinalized(
  institutionId: string,
  sessionId: string,
) {
  const normalizedInstitutionId = normalizedText(institutionId);
  const normalizedSessionId = normalizedText(sessionId);
  if (!normalizedInstitutionId || !normalizedSessionId) return false;
  const records = await listTeacherSessionLifecycleOperations(
    normalizedInstitutionId,
  );
  return records.some(
    (record) =>
      record.kind === "close" &&
      record.session_id === normalizedSessionId &&
      teacherSessionLifecycleCountsAsFinalized(record),
  );
}

export function teacherSessionLifecycleCountsAsFinalized(
  record: TeacherSessionLifecycleDeliveryRecord,
) {
  return record.kind === "close" && (
    record.state === "device_pending" ||
    record.state === "relay_confirmed"
  );
}

export async function retryTeacherSessionCloseOnRelay(
  record: TeacherSessionLifecycleDeliveryRecord,
  input: Pick<
    CloseTeacherSessionInput,
    "relayBaseUrl" | "relayAccessToken"
  >,
) {
  if (record.kind !== "close" || !record.session_id) return record;
  return await closeTeacherAttendanceSessionOnRelay({
    institutionId: record.institution_id,
    sessionId: record.session_id,
    classId: record.class_id,
    attendanceOperationId: record.attendance_operation_id,
    operationId: record.operation_id,
    actualEndAt: record.actual_end_at,
    scheduleRevision: record.schedule_revision,
    timezone: record.timezone,
    scheduledStartAt: record.scheduled_start_at,
    replayMode: true,
    relayBaseUrl: input.relayBaseUrl,
    relayAccessToken: input.relayAccessToken,
  });
}

export async function retryTeacherSessionLifecycleOperationOnRelay(
  record: TeacherSessionLifecycleDeliveryRecord,
  input: {
    relayBaseUrl?: string | null;
    relayAccessToken?: string | null;
  },
) {
  if (record.state !== "device_pending") return record;
  if (record.kind === "close") {
    return await retryTeacherSessionCloseOnRelay(record, input);
  }
  if (!record.class_id || !record.period_id) return record;
  return await transitionTeacherAttendanceSessionOnRelay({
    institutionId: record.institution_id,
    classId: record.class_id,
    periodId: record.period_id,
    attemptKey: record.attempt_key,
    relayBaseUrl: input.relayBaseUrl,
    relayAccessToken: input.relayAccessToken,
  });
}

export async function transitionTeacherAttendanceSessionOnRelay(
  input: TransitionTeacherSessionInput,
) {
  return await transitionTeacherAttendanceSessionWithDependencies(input, productionDependencies());
}

export function teacherSessionLifecycleDeliveryMessage(
  record: TeacherSessionLifecycleDeliveryRecord,
) {
  if (record.state === "relay_confirmed") {
    return record.kind === "close"
      ? "Séance terminée sur le relais local."
      : "Cours suivant ouvert sur le relais local.";
  }
  if (record.last_error === "teacher_attendance_writes_disabled") {
    return "Opération conservée sur cet appareil : les écritures du relais sont désactivées.";
  }
  if (record.last_error?.endsWith("_route_unavailable")) {
    return "Opération conservée sur cet appareil : le relais doit être mis à jour.";
  }
  if (record.state === "blocked") {
    return "Transition refusée par les règles de séance du relais.";
  }
  return "Opération conservée sur cet appareil : relais local inaccessible.";
}

"use client";

import {
  cacheGet,
  cacheSet,
  findLegacyTeacherAttendanceMutation,
  removeLegacyTeacherAttendanceMutation,
  resolveOfflineSessionReference,
  type LegacyTeacherAttendanceMutation,
} from "@/lib/offline";
import {
  LocalRelayHttpError,
  postRelayTeacherAttendanceOperation,
  requestRelayAttendancePresenceProof,
} from "@/lib/local-relay";
import {
  buildTeacherAttendanceRelayPayload,
  normalizeTeacherAttendanceMarks,
  type TeacherAttendanceMark,
  type TeacherAttendanceRelayPayload,
} from "@/lib/teacher-attendance-protocol";

export type TeacherAttendanceDeliveryState =
  | "device_pending"
  | "relay_secured"
  | "cloud_synced"
  | "delivery_unknown"
  | "blocked"
  | "conflict";

type DeliveryChannel = "cloud" | "relay" | null;

export type TeacherAttendanceDeliveryRecord = {
  schema_version: 1;
  institution_id: string;
  operation_id: string;
  session_reference: string;
  session_id: string;
  class_id: string;
  period_id: string;
  marks: TeacherAttendanceMark[];
  content_key: string;
  state: TeacherAttendanceDeliveryState;
  channel: DeliveryChannel;
  created_at: string;
  updated_at: string;
  cloud_attempted_at: string | null;
  relay_attempted_at: string | null;
  last_status: number | null;
  last_error: string | null;
  requires_authentication: boolean;
};

export type TeacherAttendanceOperationStore = {
  list(institutionId: string): Promise<TeacherAttendanceDeliveryRecord[]>;
  put(record: TeacherAttendanceDeliveryRecord): Promise<void>;
};

type DeliveryHttpResponse = {
  ok: boolean;
  status: number;
  body?: Record<string, unknown> | null;
};

export type TeacherAttendanceDeliveryDependencies = {
  store: TeacherAttendanceOperationStore;
  now(): Date;
  createOperationId(): string;
  cloudManifestAvailable(): Promise<boolean>;
  postCloud(input: {
    operationId: string;
    sessionId: string;
    marks: TeacherAttendanceMark[];
  }): Promise<DeliveryHttpResponse>;
  requestPresenceProof(input: {
    institutionId: string;
    actorProfileId: string;
    clientSessionId: string;
    baseUrl: string;
    accessToken: string;
  }): Promise<{ proof: string; expires_at: string }>;
  postRelay(input: {
    baseUrl: string;
    accessToken: string;
    payload: TeacherAttendanceRelayPayload;
  }): Promise<DeliveryHttpResponse>;
  findLegacy?(sessionIds: string[]): Promise<LegacyTeacherAttendanceMutation | null>;
  removeLegacy?(id: string): Promise<void>;
};

export type DeliverTeacherAttendanceInput = {
  institutionId: string;
  actorProfileId: string;
  sessionReference: string;
  serverSessionId: string | null;
  classId: string;
  periodId: string | null;
  marks: Array<{
    student_id?: unknown;
    status?: unknown;
    comment?: unknown;
    reason?: unknown;
    observed_at?: unknown;
    late_observed_at?: unknown;
  }>;
  relayBaseUrl?: string | null;
  relayAccessToken?: string | null;
  preferredChannel?: "relay" | null;
};

const STORE_PREFIX = "teacher:attendance-delivery:v1:";
const STORE_INSTITUTIONS_KEY = "teacher:attendance-delivery:v1:institutions";
const inFlight = new Map<string, Promise<TeacherAttendanceDeliveryRecord>>();

function normalizedText(value: unknown) {
  return String(value || "").trim();
}

function operationContentKey(classId: string, periodId: string, marks: TeacherAttendanceMark[]) {
  return JSON.stringify({ class_id: classId, period_id: periodId, marks });
}

function latestForSession(
  records: TeacherAttendanceDeliveryRecord[],
  sessionReference: string,
) {
  return records
    .filter((record) => record.session_reference === sessionReference)
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .at(-1) || null;
}

function safeErrorCode(body: DeliveryHttpResponse["body"], fallback: string) {
  const code = normalizedText(body?.error || body?.message);
  return code && code.length <= 256 ? code : fallback;
}

function patchRecord(
  record: TeacherAttendanceDeliveryRecord,
  now: Date,
  patch: Partial<TeacherAttendanceDeliveryRecord>,
) {
  return { ...record, ...patch, updated_at: now.toISOString() };
}

function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createIndexedDbTeacherAttendanceStore(): TeacherAttendanceOperationStore {
  return {
    async list(institutionId) {
      const value = await cacheGet<TeacherAttendanceDeliveryRecord[]>(
        `${STORE_PREFIX}${institutionId}`,
      );
      return Array.isArray(value)
        ? value.filter((record) => record?.schema_version === 1)
        : [];
    },
    async put(record) {
      const key = `${STORE_PREFIX}${record.institution_id}`;
      const records = await cacheGet<TeacherAttendanceDeliveryRecord[]>(key);
      const next = Array.isArray(records) ? [...records] : [];
      const index = next.findIndex((candidate) =>
        candidate.operation_id === record.operation_id &&
        candidate.institution_id === record.institution_id,
      );
      if (index >= 0) next[index] = record;
      else next.push(record);
      await cacheSet(key, next);
      const institutions = await cacheGet<string[]>(STORE_INSTITUTIONS_KEY);
      const nextInstitutions = new Set(Array.isArray(institutions) ? institutions : []);
      nextInstitutions.add(record.institution_id);
      await cacheSet(STORE_INSTITUTIONS_KEY, Array.from(nextInstitutions).sort());
    },
  };
}

async function storePatch(
  deps: TeacherAttendanceDeliveryDependencies,
  record: TeacherAttendanceDeliveryRecord,
  patch: Partial<TeacherAttendanceDeliveryRecord>,
) {
  const next = patchRecord(record, deps.now(), patch);
  await deps.store.put(next);
  return next;
}

function migratedLegacyState(legacy: LegacyTeacherAttendanceMutation) {
  if (legacy.state === "blocked") return "blocked" as const;
  if (legacy.lastStatus === 401) return "device_pending" as const;
  if (legacy.lastStatus === 409) return "conflict" as const;
  if (legacy.lastStatus === 0 || (legacy.lastStatus || 0) >= 500) {
    return "delivery_unknown" as const;
  }
  return "device_pending" as const;
}

async function adoptLegacyOperation(
  input: DeliverTeacherAttendanceInput,
  deps: TeacherAttendanceDeliveryDependencies,
  marks: TeacherAttendanceMark[],
) {
  if (!deps.findLegacy || !deps.removeLegacy) return;
  const sessionIds = [input.sessionReference, input.serverSessionId || ""];
  const legacy = await deps.findLegacy(sessionIds);
  if (!legacy) return;

  const records = await deps.store.list(input.institutionId);
  if (!records.some((record) => record.operation_id === legacy.operationId)) {
    let legacyMarks = marks;
    try {
      legacyMarks = normalizeTeacherAttendanceMarks(
        Array.isArray(legacy.body?.marks) ? legacy.body.marks : marks,
      );
    } catch {
      // Les marques normalisées de l'écran sont conservées si l'ancien format est incomplet.
    }
    const periodId = normalizedText(input.periodId);
    const nowIso = deps.now().toISOString();
    await deps.store.put({
      schema_version: 1,
      institution_id: input.institutionId,
      operation_id: legacy.operationId,
      session_reference: input.sessionReference,
      session_id: input.serverSessionId || input.sessionReference,
      class_id: input.classId,
      period_id: periodId,
      marks: legacyMarks,
      content_key: operationContentKey(input.classId, periodId, legacyMarks),
      state: migratedLegacyState(legacy),
      channel: legacy.lastStatus === 401 ? "cloud" : null,
      created_at: new Date(legacy.createdAt || deps.now().getTime()).toISOString(),
      updated_at: nowIso,
      cloud_attempted_at: legacy.lastStatus == null ? null : nowIso,
      relay_attempted_at: null,
      last_status: legacy.lastStatus,
      last_error: legacy.lastError || "legacy_browser_outbox_migrated",
      requires_authentication: legacy.lastStatus === 401,
    });
  }
  await deps.removeLegacy(legacy.id);
}

async function getOrCreateRecord(
  input: DeliverTeacherAttendanceInput,
  deps: TeacherAttendanceDeliveryDependencies,
  marks: TeacherAttendanceMark[],
) {
  await adoptLegacyOperation(input, deps, marks);
  const records = await deps.store.list(input.institutionId);
  const latest = latestForSession(records, input.sessionReference);
  const periodId = normalizedText(input.periodId);
  const contentKey = operationContentKey(input.classId, periodId, marks);
  const now = deps.now();

  if (latest?.content_key === contentKey) {
    if (
      input.preferredChannel === "relay" &&
      latest.channel === null &&
      !latest.cloud_attempted_at
    ) {
      return await storePatch(deps, latest, { channel: "relay" });
    }
    if (
      input.serverSessionId &&
      latest.session_id !== input.serverSessionId &&
      !latest.cloud_attempted_at &&
      !latest.relay_attempted_at
    ) {
      return await storePatch(deps, latest, { session_id: input.serverSessionId });
    }
    return latest;
  }

  if (
    latest &&
    latest.state === "device_pending" &&
    !latest.cloud_attempted_at &&
    !latest.relay_attempted_at
  ) {
    return await storePatch(deps, latest, {
      session_id: input.serverSessionId || input.sessionReference,
      class_id: input.classId,
      period_id: periodId,
      marks,
      content_key: contentKey,
      channel: input.preferredChannel === "relay" ? "relay" : latest.channel,
      last_error: "attendance_draft_saved_on_device",
    });
  }

  const created: TeacherAttendanceDeliveryRecord = {
    schema_version: 1,
    institution_id: input.institutionId,
    operation_id: deps.createOperationId(),
    session_reference: input.sessionReference,
    session_id: input.serverSessionId || input.sessionReference,
    class_id: input.classId,
    period_id: periodId,
    marks,
    content_key: contentKey,
    state: "device_pending",
    channel: input.preferredChannel === "relay" ? "relay" : null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    cloud_attempted_at: null,
    relay_attempted_at: null,
    last_status: null,
    last_error: null,
    requires_authentication: false,
  };
  await deps.store.put(created);
  return created;
}

function terminalState(state: TeacherAttendanceDeliveryState) {
  return state === "relay_secured" ||
    state === "cloud_synced" ||
    state === "delivery_unknown" ||
    state === "blocked" ||
    state === "conflict";
}

async function deliverToCloud(
  record: TeacherAttendanceDeliveryRecord,
  deps: TeacherAttendanceDeliveryDependencies,
) {
  const current = await storePatch(deps, record, {
    channel: "cloud",
    cloud_attempted_at: deps.now().toISOString(),
    last_status: null,
    last_error: "cloud_attempt_in_progress",
    requires_authentication: false,
  });

  let response: DeliveryHttpResponse;
  try {
    response = await deps.postCloud({
      operationId: current.operation_id,
      sessionId: current.session_id,
      marks: current.marks,
    });
  } catch {
    return await storePatch(deps, current, {
      state: "delivery_unknown",
      last_status: 0,
      last_error: "cloud_delivery_unknown",
    });
  }

  if (response.ok) {
    return await storePatch(deps, current, {
      state: "cloud_synced",
      last_status: response.status,
      last_error: null,
    });
  }
  const error = safeErrorCode(response.body, `cloud_http_${response.status}`);
  if (response.status === 401) {
    return await storePatch(deps, current, {
      state: "device_pending",
      last_status: response.status,
      last_error: "authentication_required",
      requires_authentication: true,
    });
  }
  if (response.status === 409) {
    return await storePatch(deps, current, {
      state: "conflict",
      last_status: response.status,
      last_error: error,
    });
  }
  if ([400, 403, 404, 422].includes(response.status)) {
    return await storePatch(deps, current, {
      state: "blocked",
      last_status: response.status,
      last_error: error,
    });
  }
  return await storePatch(deps, current, {
    state: "delivery_unknown",
    last_status: response.status,
    last_error: "cloud_delivery_unknown",
  });
}

async function deliverToRelay(
  input: DeliverTeacherAttendanceInput,
  record: TeacherAttendanceDeliveryRecord,
  deps: TeacherAttendanceDeliveryDependencies,
) {
  const baseUrl = normalizedText(input.relayBaseUrl);
  const accessToken = normalizedText(input.relayAccessToken);
  if (!baseUrl || !accessToken || !normalizedText(input.actorProfileId)) {
    return await storePatch(deps, record, {
      state: "device_pending",
      last_status: null,
      last_error: "relay_teacher_credentials_unavailable",
    });
  }

  let proof: { proof: string; expires_at: string };
  try {
    proof = await deps.requestPresenceProof({
      institutionId: input.institutionId,
      actorProfileId: input.actorProfileId,
      clientSessionId: record.session_id,
      baseUrl,
      accessToken,
    });
  } catch (error) {
    const auth = error instanceof LocalRelayHttpError && error.status === 401;
    return await storePatch(deps, record, {
      state: "device_pending",
      last_status: error instanceof LocalRelayHttpError ? error.status : 0,
      last_error: auth ? "authentication_required" : "relay_presence_proof_unavailable",
      requires_authentication: auth,
    });
  }
  const expiresAt = new Date(proof.expires_at).getTime();
  if (!normalizedText(proof.proof) || !Number.isFinite(expiresAt) || expiresAt <= deps.now().getTime()) {
    return await storePatch(deps, record, {
      state: "device_pending",
      last_status: null,
      last_error: "relay_presence_proof_expired",
    });
  }

  const payload = buildTeacherAttendanceRelayPayload({
    operationId: record.operation_id,
    sessionId: record.session_id,
    classId: record.class_id,
    periodId: record.period_id,
    marks: record.marks,
    presenceProof: proof.proof,
  });
  const current = await storePatch(deps, record, {
    channel: "relay",
    relay_attempted_at: deps.now().toISOString(),
    last_status: null,
    last_error: "relay_attempt_in_progress",
    requires_authentication: false,
  });

  let response: DeliveryHttpResponse;
  try {
    response = await deps.postRelay({ baseUrl, accessToken, payload });
  } catch {
    return await storePatch(deps, current, {
      state: "device_pending",
      last_status: 0,
      last_error: "relay_unreachable",
    });
  }

  const responseOperationId = normalizedText(response.body?.operation_id);
  if (response.ok && responseOperationId && responseOperationId !== current.operation_id) {
    return await storePatch(deps, current, {
      state: "conflict",
      last_status: response.status,
      last_error: "relay_operation_id_mismatch",
    });
  }
  if (response.ok) {
    return await storePatch(deps, current, {
      state: response.body?.state === "synced_with_cloud" ? "cloud_synced" : "relay_secured",
      last_status: response.status,
      last_error: null,
    });
  }

  const error = safeErrorCode(response.body, `relay_http_${response.status}`);
  if (response.status === 503 && error === "teacher_attendance_writes_disabled") {
    return await storePatch(deps, current, {
      state: "device_pending",
      channel: null,
      last_status: response.status,
      last_error: error,
    });
  }
  if (response.status === 401) {
    return await storePatch(deps, current, {
      state: "device_pending",
      last_status: response.status,
      last_error: "authentication_required",
      requires_authentication: true,
    });
  }
  if (response.status === 409) {
    return await storePatch(deps, current, {
      state: "conflict",
      last_status: response.status,
      last_error: error,
    });
  }
  if (response.status === 404 && error !== "session_not_found") {
    return await storePatch(deps, current, {
      state: "device_pending",
      last_status: response.status,
      last_error: "relay_attendance_route_unavailable",
    });
  }
  if ([400, 403, 404, 422, 428].includes(response.status)) {
    return await storePatch(deps, current, {
      state: "blocked",
      last_status: response.status,
      last_error: error,
    });
  }
  return await storePatch(deps, current, {
    state: "device_pending",
    last_status: response.status,
    last_error: error,
  });
}

async function deliverInternal(
  input: DeliverTeacherAttendanceInput,
  deps: TeacherAttendanceDeliveryDependencies,
) {
  const marks = normalizeTeacherAttendanceMarks(input.marks);
  if (!marks.length) throw new Error("marks_required");
  const record = await getOrCreateRecord(input, deps, marks);

  if (record.state === "device_pending" && record.last_error === "cloud_attempt_in_progress") {
    return await storePatch(deps, record, {
      state: "delivery_unknown",
      last_status: 0,
      last_error: "cloud_delivery_unknown_after_reload",
    });
  }
  const retryAfterSessionBootstrap =
    record.state === "blocked" && record.last_error === "session_not_found";
  if (terminalState(record.state) && !retryAfterSessionBootstrap) return record;
  if (!record.period_id) {
    return await storePatch(deps, record, {
      state: "device_pending",
      last_error: "period_not_initialized",
    });
  }
  if (!input.serverSessionId) {
    return await storePatch(deps, record, {
      state: "device_pending",
      last_error: "session_not_initialized_on_relay",
    });
  }

  if (record.channel === "cloud") return await deliverToCloud(record, deps);
  if (record.channel === "relay") return await deliverToRelay(input, record, deps);

  let cloudAvailable = false;
  try {
    cloudAvailable = await deps.cloudManifestAvailable();
  } catch {
    cloudAvailable = false;
  }
  return cloudAvailable
    ? await deliverToCloud(record, deps)
    : await deliverToRelay(input, record, deps);
}

export async function deliverTeacherAttendanceWithDependencies(
  input: DeliverTeacherAttendanceInput,
  deps: TeacherAttendanceDeliveryDependencies,
) {
  const institutionId = normalizedText(input.institutionId);
  const sessionReference = normalizedText(input.sessionReference);
  const classId = normalizedText(input.classId);
  if (!institutionId) throw new Error("institution_id_required");
  if (!sessionReference) throw new Error("session_reference_required");
  if (!classId) throw new Error("class_id_required");

  const normalizedInput = {
    ...input,
    institutionId,
    sessionReference,
    serverSessionId: normalizedText(input.serverSessionId) || null,
    classId,
  };
  const marks = normalizeTeacherAttendanceMarks(input.marks);
  const lockKey = `${institutionId}\u0000${sessionReference}\u0000${operationContentKey(
    classId,
    normalizedText(input.periodId),
    marks,
  )}`;
  const existing = inFlight.get(lockKey);
  if (existing) return await existing;

  const run = deliverInternal(normalizedInput, deps);
  inFlight.set(lockKey, run);
  try {
    return await run;
  } finally {
    inFlight.delete(lockKey);
  }
}

async function safeResponseJson(response: Response) {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function productionDependencies(): TeacherAttendanceDeliveryDependencies {
  return {
    store: createIndexedDbTeacherAttendanceStore(),
    now: () => new Date(),
    createOperationId: uuid,
    async cloudManifestAvailable() {
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
    },
    async postCloud({ operationId, sessionId, marks }) {
      const response = await fetch("/api/teacher/attendance/bulk", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Mon-Cahier-Operation-Id": operationId,
        },
        body: JSON.stringify({
          session_id: sessionId,
          marks: marks.map((mark) => ({
            student_id: mark.student_id,
            status: mark.status,
            reason: mark.comment,
            observed_at: mark.observed_at,
          })),
        }),
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await safeResponseJson(response),
      };
    },
    async requestPresenceProof(input) {
      return await requestRelayAttendancePresenceProof(input);
    },
    async postRelay(input) {
      try {
        const body = await postRelayTeacherAttendanceOperation(input);
        return { ok: true, status: body.idempotent ? 200 : 202, body };
      } catch (error) {
        if (error instanceof LocalRelayHttpError) {
          return {
            ok: false,
            status: error.status,
            body: { error: error.code },
          };
        }
        throw error;
      }
    },
    findLegacy: findLegacyTeacherAttendanceMutation,
    removeLegacy: removeLegacyTeacherAttendanceMutation,
  };
}

export async function deliverTeacherAttendance(input: {
  institutionId: string;
  actorProfileId: string;
  sessionId: string;
  classId: string;
  periodId: string | null;
  marks: DeliverTeacherAttendanceInput["marks"];
  relayBaseUrl?: string | null;
  relayAccessToken?: string | null;
  forceRelay?: boolean;
}) {
  const resolved = await resolveOfflineSessionReference(input.sessionId);
  const deliveryInput = {
    ...input,
    sessionReference: resolved.sessionReference,
    serverSessionId: resolved.serverSessionId,
    preferredChannel: input.forceRelay ? "relay" as const : null,
  };
  const run = () => deliverTeacherAttendanceWithDependencies(
    deliveryInput,
    productionDependencies(),
  );
  const locks = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & {
        locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
      }).locks;
  return locks
    ? await locks.request(
        `moncahier-teacher-attendance:${input.institutionId}:${resolved.sessionReference}`,
        run,
      )
    : await run();
}

export async function stageTeacherAttendanceDraft(input: {
  institutionId: string;
  actorProfileId: string;
  sessionId: string;
  classId: string;
  periodId: string | null;
  marks: DeliverTeacherAttendanceInput["marks"];
  forceRelay?: boolean;
}) {
  const institutionId = normalizedText(input.institutionId);
  const sessionId = normalizedText(input.sessionId);
  const classId = normalizedText(input.classId);
  if (!institutionId) throw new Error("institution_id_required");
  if (!sessionId) throw new Error("session_id_required");
  if (!classId) throw new Error("class_id_required");
  const resolved = await resolveOfflineSessionReference(sessionId);
  const deps = productionDependencies();
  return await stageTeacherAttendanceDraftWithDependencies({
    institutionId,
    actorProfileId: normalizedText(input.actorProfileId),
    sessionReference: resolved.sessionReference,
    serverSessionId: resolved.serverSessionId,
    classId,
    periodId: normalizedText(input.periodId) || null,
    marks: input.marks,
    preferredChannel: input.forceRelay ? "relay" : null,
  }, deps);
}

export async function stageTeacherAttendanceDraftWithDependencies(
  input: DeliverTeacherAttendanceInput,
  deps: TeacherAttendanceDeliveryDependencies,
) {
  const marks = normalizeTeacherAttendanceMarks(input.marks);
  if (!marks.length) return null;
  return await getOrCreateRecord(input, deps, marks);
}

export async function getLatestTeacherAttendanceOperation(
  institutionId: string,
  sessionId: string,
) {
  const normalizedInstitution = normalizedText(institutionId);
  if (!normalizedInstitution || !normalizedText(sessionId)) return null;
  const resolved = await resolveOfflineSessionReference(sessionId);
  const records = await createIndexedDbTeacherAttendanceStore().list(normalizedInstitution);
  return latestForSession(records, resolved.sessionReference);
}

export async function countUnresolvedTeacherAttendanceOperations(knownInstitutionId?: string | null) {
  if (typeof window === "undefined") return 0;
  const cachedInstitutionId = normalizedText(
    await cacheGet<any>("teacher:inst:basics")
      .then((value) => value?.institution_id)
      .catch(() => ""),
  );
  const indexedInstitutions = await cacheGet<string[]>(STORE_INSTITUTIONS_KEY).catch(() => []);
  const institutionIds = new Set(
    [knownInstitutionId, cachedInstitutionId, ...(indexedInstitutions || [])]
      .map(normalizedText)
      .filter(Boolean),
  );
  const store = createIndexedDbTeacherAttendanceStore();
  const records = (await Promise.all(
    Array.from(institutionIds, (institutionId) => store.list(institutionId)),
  )).flat();
  return records.filter((record) => record.state !== "cloud_synced").length;
}

export function teacherAttendanceDeliveryMessage(record: TeacherAttendanceDeliveryRecord) {
  if (record.state === "cloud_synced") return "Synchronisé.";
  if (record.state === "relay_secured") return "Sécurisé sur le relais local.";
  if (record.state === "delivery_unknown") return "Synchronisation à vérifier.";
  if (record.state === "conflict") return "Action requise : conflit de synchronisation.";
  if (record.state === "blocked") {
    if (record.last_error === "session_not_found") {
      return "Action requise : cette séance doit d’abord être préparée sur le relais.";
    }
    return "Action requise : l’enregistrement a été refusé.";
  }
  if (record.requires_authentication) {
    return "Enregistré sur cet appareil. Reconnectez-vous avant de réessayer.";
  }
  if (record.last_error === "teacher_attendance_writes_disabled") {
    return "Enregistré sur cet appareil. Les écritures du relais restent désactivées.";
  }
  if (record.last_error === "session_not_initialized_on_relay") {
    return "Enregistré sur cet appareil. La séance n’est pas encore disponible sur le relais.";
  }
  if (record.last_error === "period_not_initialized") {
    return "Enregistré sur cet appareil. Actualisez la préparation hors ligne avant l’envoi.";
  }
  return "Enregistré sur cet appareil.";
}

"use client";

import {
  cacheGet,
  flushOutbox,
  listOfflineOutboxEntries,
  offlineMutateJson,
  type FlushedMutationAcknowledgement,
  type FlushResult,
  type OfflineOutboxEntry,
} from "@/lib/offline";
import {
  createIndexedDbTeacherAttendanceStore,
  markTeacherAttendanceSyncedInCloud,
  type TeacherAttendanceDeliveryRecord,
} from "@/lib/teacher-attendance-delivery";
import {
  listTeacherSessionOpenOperations,
  markTeacherSessionOpenedInCloud,
  type TeacherSessionDeliveryRecord,
} from "@/lib/teacher-session-delivery";
import {
  listTeacherSessionLifecycleOperations,
  markTeacherSessionClosedInCloud,
} from "@/lib/teacher-session-lifecycle-delivery";

export type TeacherAttendanceCloudSyncResult = {
  flushed: number;
  remaining: number;
  blocked: number;
  conflicts: number;
  authRequired: boolean;
  retryableFailure: boolean;
  lastError: string | null;
  lastStatus: number | null;
};

export type TeacherAttendanceSyncStatus = {
  total: number;
  pending: number;
  blocked: number;
  conflicts: number;
  authRequired: boolean;
  securedOnRelay: number;
  lastError: string | null;
  lastStatus: number | null;
};

const STORE_INSTITUTIONS_KEY = "teacher:attendance-delivery:v1:institutions";
const ATTENDANCE_OPERATION_TYPES = [
  "session-start",
  "attendance",
  "session-end",
] as const;

function text(value: unknown) {
  return String(value || "").trim();
}

function isConflict(error: unknown) {
  return /(?:conflict|mismatch|operation_id_reused)/i.test(text(error));
}

function retryableAttendance(record: TeacherAttendanceDeliveryRecord) {
  return record.state === "device_pending" ||
    record.state === "delivery_unknown" ||
    record.state === "relay_secured" ||
    (record.state === "blocked" && record.last_error === "session_not_found");
}

async function knownInstitutionIds(preferred?: string | null) {
  const indexed = await cacheGet<string[]>(STORE_INSTITUTIONS_KEY).catch(() => []);
  const teacherInstitution = text(
    await cacheGet<any>("teacher:inst:basics")
      .then((value) => value?.institution_id)
      .catch(() => ""),
  );
  return Array.from(new Set(
    [preferred, teacherInstitution, ...(indexed || [])]
      .map(text)
      .filter(Boolean),
  ));
}

async function cloudAvailable() {
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

function parseTeacherAttemptKey(record: TeacherSessionDeliveryRecord) {
  const parts = record.attempt_key.split("_");
  const subjectId = text(parts[1]);
  const parsedStartedAt = text(parts.slice(2).join("_"));
  const startedAt = text(record.started_at) || parsedStartedAt;
  if (!subjectId || subjectId === "none" || !Number.isFinite(Date.parse(startedAt))) {
    return null;
  }
  return { subjectId, startedAt: new Date(startedAt).toISOString() };
}

async function queueDurableSessionOpen(
  record: TeacherSessionDeliveryRecord,
  existingOperationIds: Set<string>,
) {
  if (record.state !== "device_pending" || existingOperationIds.has(record.operation_id)) {
    return;
  }
  const attempt = parseTeacherAttemptKey(record);
  if (!attempt) return;
  await offlineMutateJson(
    "/api/teacher/sessions/start",
    {
      method: "POST",
      body: {
        class_id: record.class_id,
        subject_id: attempt.subjectId,
        started_at: attempt.startedAt,
        actual_call_at: record.actual_call_at || record.created_at,
        expected_minutes: null,
        client_session_id: record.attempt_key,
        presence: null,
      },
    },
    {
      queueOnly: true,
      operationId: record.operation_id,
      createdAt: Date.parse(record.created_at),
      mergeKey: `teacher:start:${record.attempt_key}`,
      meta: {
        operationType: "session-start",
        clientSessionId: record.attempt_key,
        institutionId: record.institution_id,
        classId: record.class_id,
      },
    },
  );
  existingOperationIds.add(record.operation_id);
}

async function queueDurableAttendance(
  record: TeacherAttendanceDeliveryRecord,
  existingOperationIds: Set<string>,
) {
  if (!retryableAttendance(record)) return;
  // Dès que le payload est publié dans l'outbox, son operation_id devient
  // immuable. Une modification ultérieure créera donc une correction avec un
  // nouvel identifiant au lieu de modifier une requête déjà partie/ambiguë.
  const queuedAt = new Date().toISOString();
  await createIndexedDbTeacherAttendanceStore().put({
    ...record,
    channel: "cloud",
    cloud_attempted_at: record.cloud_attempted_at || queuedAt,
    updated_at: queuedAt,
    last_error: "cloud_replay_queued",
    requires_authentication: false,
  });
  if (existingOperationIds.has(record.operation_id)) return;
  await offlineMutateJson(
    "/api/teacher/attendance/bulk",
    {
      method: "POST",
      body: {
        session_id: record.session_reference,
        captured_at_device: record.captured_at_device || record.created_at,
        marks: record.marks.map((mark) => ({
          student_id: mark.student_id,
          status: mark.status,
          reason: mark.comment,
          observed_at: mark.observed_at,
        })),
      },
    },
    {
      queueOnly: true,
      operationId: record.operation_id,
      createdAt: Date.parse(record.created_at),
      mergeKey: `teacher:attendance:${record.session_reference}`,
      meta: {
        operationType: "attendance",
        clientSessionId: record.session_reference,
        institutionId: record.institution_id,
        classId: record.class_id,
        periodId: record.period_id,
      },
    },
  );
  existingOperationIds.add(record.operation_id);
}

async function durableRecords(institutionIds: string[]) {
  const attendanceStore = createIndexedDbTeacherAttendanceStore();
  const attendance = (await Promise.all(
    institutionIds.map((id) => attendanceStore.list(id)),
  )).flat();
  const opens = (await Promise.all(
    institutionIds.map((id) => listTeacherSessionOpenOperations(id)),
  )).flat();
  const lifecycle = (await Promise.all(
    institutionIds.map((id) => listTeacherSessionLifecycleOperations(id)),
  )).flat();
  return { attendance, opens, lifecycle };
}

async function materializeDurableOperations(institutionIds: string[]) {
  const existing = await listOfflineOutboxEntries();
  const operationIds = new Set(existing.map((entry) => entry.operationId));
  const durable = await durableRecords(institutionIds);
  for (const record of durable.opens) {
    await queueDurableSessionOpen(record, operationIds);
  }
  for (const record of durable.attendance) {
    await queueDurableAttendance(record, operationIds);
  }
}

async function applyAcknowledgements(
  acknowledgements: FlushedMutationAcknowledgement[],
) {
  for (const acknowledgement of acknowledgements) {
    const institutionId = text(acknowledgement.institutionId);
    if (!institutionId) continue;
    if (acknowledgement.operationType === "session-start" && acknowledgement.sessionId) {
      await markTeacherSessionOpenedInCloud({
        institutionId,
        operationId: acknowledgement.operationId,
        sessionId: acknowledgement.sessionId,
      });
    } else if (acknowledgement.operationType === "attendance") {
      await markTeacherAttendanceSyncedInCloud({
        institutionId,
        operationId: acknowledgement.operationId,
        sessionId: acknowledgement.sessionId,
        status: acknowledgement.status,
      });
    } else if (acknowledgement.operationType === "session-end") {
      await markTeacherSessionClosedInCloud({
        institutionId,
        operationId: acknowledgement.operationId,
        status: acknowledgement.status,
      });
    }
  }
}

function combineFlushResults(results: FlushResult[]) {
  return results.reduce(
    (total, result) => ({
      flushed: total.flushed + result.flushed,
      authRequired: total.authRequired || result.authRequired,
      retryableFailure: total.retryableFailure || result.retryableFailure,
      lastError: result.lastError || total.lastError,
      lastStatus: result.lastStatus ?? total.lastStatus,
    }),
    {
      flushed: 0,
      authRequired: false,
      retryableFailure: false,
      lastError: null as string | null,
      lastStatus: null as number | null,
    },
  );
}

function outboxAttendanceEntries(entries: OfflineOutboxEntry[]) {
  return entries.filter((entry) =>
    entry.operationType != null &&
    ATTENDANCE_OPERATION_TYPES.includes(
      entry.operationType as (typeof ATTENDANCE_OPERATION_TYPES)[number],
    )
  );
}

/**
 * Compteur honnête des opérations d'appel encore détenues par cet appareil.
 * Les doublons entre le journal durable et l'outbox sont comptés une seule fois.
 */
export async function getTeacherAttendanceSyncStatus(
  institutionId?: string | null,
): Promise<TeacherAttendanceSyncStatus> {
  if (typeof window === "undefined") {
    return {
      total: 0,
      pending: 0,
      blocked: 0,
      conflicts: 0,
      authRequired: false,
      securedOnRelay: 0,
      lastError: null,
      lastStatus: null,
    };
  }
  const institutionIds = await knownInstitutionIds(institutionId);
  const entries = outboxAttendanceEntries(await listOfflineOutboxEntries());
  const durable = await durableRecords(institutionIds);
  const represented = new Set(entries.map((entry) => entry.operationId));

  let pending = entries.filter((entry) => entry.state === "pending").length;
  let conflicts = entries.filter(
    (entry) => entry.state === "blocked" && isConflict(entry.lastError),
  ).length;
  let blocked = entries.filter(
    (entry) => entry.state === "blocked" && !isConflict(entry.lastError),
  ).length;
  let securedOnRelay = 0;
  let authRequired = entries.some((entry) => entry.lastStatus === 401);
  let lastError = entries.at(-1)?.lastError || null;
  let lastStatus = entries.at(-1)?.lastStatus ?? null;

  const addDurable = (input: {
    operationId: string;
    state: string;
    lastError: string | null;
    lastStatus: number | null;
    requiresAuthentication: boolean;
  }) => {
    if (represented.has(input.operationId)) return;
    represented.add(input.operationId);
    if (/^(?:relay_opened|relay_secured|relay_confirmed)$/.test(input.state)) {
      securedOnRelay += 1;
      return;
    }
    if (/^(?:cloud_opened|cloud_synced|cloud_confirmed|superseded)$/.test(input.state)) {
      return;
    }
    if (input.state === "conflict" || isConflict(input.lastError)) conflicts += 1;
    else if (input.state === "blocked") blocked += 1;
    else pending += 1;
    authRequired ||= input.requiresAuthentication || input.lastStatus === 401;
    if (input.lastError) {
      lastError = input.lastError;
      lastStatus = input.lastStatus;
    }
  };

  durable.opens.forEach((record) => addDurable({
    operationId: record.operation_id,
    state: record.state,
    lastError: record.last_error,
    lastStatus: record.last_status,
    requiresAuthentication: record.requires_authentication,
  }));
  durable.attendance.forEach((record) => addDurable({
    operationId: record.operation_id,
    state: record.state,
    lastError: record.last_error,
    lastStatus: record.last_status,
    requiresAuthentication: record.requires_authentication,
  }));
  durable.lifecycle.forEach((record) => addDurable({
    operationId: record.operation_id,
    state: record.state,
    lastError: record.last_error,
    lastStatus: record.last_status,
    requiresAuthentication: record.requires_authentication,
  }));

  return {
    total: pending + blocked + conflicts,
    pending,
    blocked,
    conflicts,
    authRequired,
    securedOnRelay,
    lastError,
    lastStatus,
  };
}

/**
 * Rejoue toute la transaction PWA dans l'ordre ouverture → appel → fermeture.
 * Chaque phase attend l'ACK exact avant de rendre la suivante éligible.
 */
export async function syncTeacherAttendanceOperationsToCloud(
  institutionId?: string | null,
): Promise<TeacherAttendanceCloudSyncResult> {
  const institutionIds = await knownInstitutionIds(institutionId);
  if (!(await cloudAvailable())) {
    const status = await getTeacherAttendanceSyncStatus(institutionId);
    return {
      flushed: 0,
      remaining: status.total,
      blocked: status.blocked,
      conflicts: status.conflicts,
      authRequired: status.authRequired,
      retryableFailure: status.pending > 0,
      lastError: status.lastError,
      lastStatus: status.lastStatus,
    };
  }

  await materializeDurableOperations(institutionIds);
  const results: FlushResult[] = [];

  const starts = await flushOutbox({
    includeOperationTypes: ["session-start"],
    releaseNetworkBackoff: true,
  });
  results.push(starts);
  await applyAcknowledgements(starts.acknowledged);

  const attendance = await flushOutbox({
    includeOperationTypes: ["attendance"],
    releaseNetworkBackoff: true,
  });
  results.push(attendance);
  await applyAcknowledgements(attendance.acknowledged);

  const attendanceAfter = (await durableRecords(institutionIds)).attendance;
  const remainingAttendanceRows = (await listOfflineOutboxEntries())
    .filter((entry) => entry.operationType === "attendance")
    .map((entry) => entry.sessionDependencyKey)
    .filter((value): value is string => Boolean(value));
  const deferredSessionEnds = Array.from(new Set([
    ...attendanceAfter
      .filter((record) => record.state !== "cloud_synced" && record.state !== "superseded")
      .map((record) => record.session_reference),
    ...remainingAttendanceRows,
  ]));
  const endings = await flushOutbox({
    excludeOperationTypes: ["session-start", "attendance"],
    deferSessionEndKeys: deferredSessionEnds,
    releaseNetworkBackoff: true,
  });
  results.push(endings);
  await applyAcknowledgements(endings.acknowledged);

  const combined = combineFlushResults(results);
  const status = await getTeacherAttendanceSyncStatus(institutionId);
  return {
    ...combined,
    remaining: status.total,
    blocked: status.blocked,
    conflicts: status.conflicts,
    authRequired: combined.authRequired || status.authRequired,
  };
}

import { createHash, randomUUID } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { canonicalJson } from "./json.mjs";
import { issueAttendancePresenceProofForTeacher } from "./presence-proof.mjs";
import { relayActorDeviceId, relayActorKind, type AuthenticatedRelayTeacher } from "./teacher-auth.mjs";
import {
  activePreviousSessionConflict,
  maintainTeacherAttendanceSessions,
} from "./teacher-session-lifecycle.mjs";
import {
  resolveTeacherScheduledSlot,
  TeacherSessionRuleError,
} from "./teacher-session-rules.mjs";
import {
  assertRelayReplayScheduledStart,
  RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION,
  RelayOfflineReplayError,
  validateRelayOfflineReplay,
  type RelayOfflineReplayContext,
  type ValidatedRelayOfflineReplay,
} from "./teacher-session-replay.mjs";

const PROTOCOL_VERSION = 1 as const;
const OPERATION_TYPE = "attendance.session.open" as const;

type TeacherSessionOpenOperation =
  | {
      protocol_version: typeof PROTOCOL_VERSION;
      operation_id: string;
      operation_type: typeof OPERATION_TYPE;
      class_id: string;
      period_id: string;
    }
  | {
      protocol_version: typeof RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION;
      operation_id: string;
      operation_type: typeof OPERATION_TYPE;
      class_id: string;
      period_id: string;
      event_at: string;
      replay_context: RelayOfflineReplayContext;
    };

type PeriodRow = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

type TimetableRow = {
  id: string;
  subject_id: string;
};

type SessionRow = {
  id: string;
  client_session_id: string | null;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  period_id: string | null;
  started_at: string;
  actual_call_at: string | null;
  ended_at: string | null;
  origin: "teacher" | "class_device" | "admin";
  server_version: number;
  updated_at: string;
  deleted_at: string | null;
  session_date: string | null;
  session_state: "open" | "finalizing" | "closed";
  scheduled_start_at: string | null;
  requested_start_at: string | null;
  actual_started_at: string | null;
  scheduled_end_at: string | null;
  finalizing_at: string | null;
  grace_expires_at: string | null;
  closed_at: string | null;
  payable_end_at: string | null;
  closure_source: string | null;
  closure_confirmation: string | null;
  requires_payroll_review: number;
  local_lifecycle_managed: number;
  last_attendance_operation_id: string | null;
  attendance_durable_at: string | null;
  attendance_snapshot_status: string;
};

type StoredReceipt = {
  protocol_version: number;
  operation_type: string;
  teacher_profile_id: string;
  class_id: string;
  period_id: string;
  timetable_id: string;
  subject_id: string;
  local_session_id: string;
  payload_fingerprint: string;
  state: "opened_on_relay" | "synced_with_cloud" | "blocked" | "conflict";
  accepted_at: string;
};

type FaultStage = "after_session" | "after_receipt" | "after_outbox" | "after_sync_record";

export type TeacherSessionOpenResult = {
  ok: true;
  operation_id: string;
  state: StoredReceipt["state"];
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
  delivery_mode?: "live" | "offline_replay";
  event_at?: string;
  received_at?: string;
  schedule_revision_stale?: boolean;
};

export class TeacherSessionOpenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(code);
  }
}

function object(value: unknown, code: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeacherSessionOpenError(400, code);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, code: string, maxLength = 256) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TeacherSessionOpenError(400, code);
  if (normalized.length > maxLength) {
    throw new TeacherSessionOpenError(400, `${code}_too_long`);
  }
  return normalized;
}

function parseOperation(raw: unknown): TeacherSessionOpenOperation {
  const row = object(raw, "operation_must_be_object");
  const protocolVersion = Number(row.protocol_version);
  const accepted = new Set(
    protocolVersion === RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION
      ? [
          "protocol_version",
          "operation_id",
          "operation_type",
          "class_id",
          "period_id",
          "event_at",
          "replay_context",
        ]
      : [
          "protocol_version",
          "operation_id",
          "operation_type",
          "class_id",
          "period_id",
        ],
  );
  if (Object.keys(row).some((key) => !accepted.has(key))) {
    throw new TeacherSessionOpenError(400, "operation_field_not_supported");
  }
  if (row.operation_type !== OPERATION_TYPE) {
    throw new TeacherSessionOpenError(400, "operation_type_not_supported");
  }
  const base = {
    operation_id: text(row.operation_id, "operation_id_required", 128),
    operation_type: OPERATION_TYPE,
    class_id: text(row.class_id, "class_id_required"),
    period_id: text(row.period_id, "period_id_required"),
  };
  if (protocolVersion === PROTOCOL_VERSION) {
    return { protocol_version: PROTOCOL_VERSION, ...base };
  }
  if (protocolVersion === RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION) {
    return {
      protocol_version: RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION,
      ...base,
      event_at: text(row.event_at, "event_at_required", 64),
      replay_context: object(
        row.replay_context,
        "offline_replay_context_invalid",
      ) as RelayOfflineReplayContext,
    };
  }
  throw new TeacherSessionOpenError(400, "protocol_version_not_supported");
}

function fingerprint(
  operation: TeacherSessionOpenOperation,
  teacher: AuthenticatedRelayTeacher,
) {
  return createHash("sha256").update(canonicalJson({
    protocol_version: operation.protocol_version,
    operation_id: operation.operation_id,
    operation_type: operation.operation_type,
    institution_id: teacher.institution_id,
    auth_actor_profile_id: teacher.actor_profile_id,
    auth_actor_kind: relayActorKind(teacher),
    auth_class_id: teacher.class_id || null,
    class_id: operation.class_id,
    period_id: operation.period_id,
    event_at: operation.protocol_version === RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION
      ? operation.event_at
      : null,
    replay_context: operation.protocol_version === RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION
      ? operation.replay_context
      : null,
  })).digest("hex");
}

function storedReceipt(db: RelayDatabase, institutionId: string, operationId: string) {
  return db.prepare(`
    SELECT protocol_version, operation_type, teacher_profile_id, class_id, period_id,
           timetable_id, subject_id, local_session_id, payload_fingerprint,
           state, accepted_at
    FROM teacher_session_open_operations
    WHERE institution_id = ? AND operation_id = ?
  `).get(institutionId, operationId) as StoredReceipt | undefined;
}

function sessionRow(db: RelayDatabase, institutionId: string, sessionId: string) {
  return db.prepare(`
    SELECT id, client_session_id, class_id, subject_id, teacher_id, period_id,
           started_at, actual_call_at, ended_at, origin, server_version,
           updated_at, deleted_at, session_date, session_state,
           scheduled_start_at, requested_start_at, actual_started_at,
           scheduled_end_at, finalizing_at, grace_expires_at, closed_at,
           payable_end_at, closure_source, closure_confirmation,
           requires_payroll_review, local_lifecycle_managed,
           last_attendance_operation_id, attendance_durable_at,
           attendance_snapshot_status
    FROM teacher_sessions
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(institutionId, sessionId) as SessionRow | undefined;
}

function localDateTime(value: Date | string, timezone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TeacherSessionOpenError(409, "session_time_invalid");
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    throw new TeacherSessionOpenError(409, "institution_timezone_invalid");
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  const weekday = new Map([
    ["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3],
    ["Thu", 4], ["Fri", 5], ["Sat", 6],
  ]).get(part("weekday"));
  if (weekday === undefined) {
    throw new TeacherSessionOpenError(409, "institution_timezone_invalid");
  }
  return {
    ymd: `${part("year")}-${part("month")}-${part("day")}`,
    weekday,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

function timeMinutes(value: string) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw new TeacherSessionOpenError(409, "period_time_invalid");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new TeacherSessionOpenError(409, "period_time_invalid");
  }
  return hour * 60 + minute;
}

function weekdayMatches(periodWeekday: number, weekday: number) {
  return periodWeekday === weekday || (weekday === 0 && periodWeekday === 7);
}

function slotStartIso(ymd: string, startTime: string, timezone: string) {
  const dateParts = ymd.split("-");
  const timeParts = startTime.split(":");
  const year = Number(dateParts[0]);
  const month = Number(dateParts[1]);
  const day = Number(dateParts[2]);
  const hour = Number(timeParts[0]);
  const minute = Number(timeParts[1]);
  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    throw new TeacherSessionOpenError(409, "period_time_invalid");
  }
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let index = 0; index < 3; index += 1) {
    const local = localDateTime(guess, timezone);
    const gotParts = local.ymd.split("-");
    const gotYear = Number(gotParts[0]);
    const gotMonth = Number(gotParts[1]);
    const gotDay = Number(gotParts[2]);
    const gotUtc = Date.UTC(
      gotYear,
      gotMonth - 1,
      gotDay,
      Math.floor(local.minutes / 60),
      local.minutes % 60,
      0,
    );
    const wantedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const difference = gotUtc - wantedUtc;
    if (difference === 0) break;
    guess = new Date(guess.getTime() - difference);
  }
  return guess.toISOString();
}

function validateBusinessRules(
  db: RelayDatabase,
  operation: TeacherSessionOpenOperation,
  teacher: AuthenticatedRelayTeacher,
  now: Date,
) {
  let schedule;
  try {
    schedule = resolveTeacherScheduledSlot(db, {
      teacher,
      classId: operation.class_id,
      periodId: operation.period_id,
      now,
    });
  } catch (error) {
    if (error instanceof TeacherSessionRuleError) {
      throw new TeacherSessionOpenError(error.status, error.code, error.details);
    }
    throw error;
  }

  const existingSlot = db.prepare(`
    SELECT id FROM teacher_sessions
    WHERE institution_id = ? AND class_id = ? AND session_date = ? AND period_id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `).get(
    teacher.institution_id,
    operation.class_id,
    schedule.sessionDate,
    operation.period_id,
  ) as { id: string } | undefined;
  let reusable: SessionRow | null = null;
  if (existingSlot) {
    const existing = sessionRow(db, teacher.institution_id, existingSlot.id);
    if (!existing) throw new TeacherSessionOpenError(409, "session_slot_conflict");
    if (existing.session_state === "closed" || existing.ended_at) {
      throw new TeacherSessionOpenError(409, "session_slot_already_closed");
    }
    if (
      existing.teacher_id !== schedule.teacherId ||
      existing.subject_id !== schedule.timetable.subject_id
    ) {
      throw new TeacherSessionOpenError(409, "session_slot_conflict");
    }
    reusable = existing;
  }

  if (!reusable) {
    const effectiveTeacher: AuthenticatedRelayTeacher = {
      institution_id: teacher.institution_id,
      actor_profile_id: schedule.teacherId,
    };
    const previous = activePreviousSessionConflict(db, {
      teacher: effectiveTeacher,
      classId: operation.class_id,
      targetPeriodId: operation.period_id,
      sessionDate: schedule.sessionDate,
      scheduledStartAt: schedule.scheduledStartAt,
    });
    if (previous) {
      throw new TeacherSessionOpenError(409, previous.code, previous.details);
    }
    const residualConcurrent = db.prepare(`
      SELECT id FROM teacher_sessions
      WHERE institution_id = ? AND teacher_id = ?
        AND ended_at IS NULL AND deleted_at IS NULL
        AND (session_date IS NULL OR scheduled_end_at IS NULL)
      ORDER BY started_at, id
      LIMIT 1
    `).get(
      teacher.institution_id,
      schedule.teacherId,
    ) as { id: string } | undefined;
    if (residualConcurrent) {
      throw new TeacherSessionOpenError(409, "concurrent_session_open");
    }
  }

  return {
    localNow: { ymd: schedule.sessionDate, weekday: schedule.weekday },
    period: schedule.period,
    timetable: schedule.timetable,
    reusable,
    startedAt: schedule.scheduledStartAt,
    scheduledEndAt: schedule.scheduledEndAt,
    graceExpiresAt: schedule.graceExpiresAt,
    sessionDate: schedule.sessionDate,
  };
}

function proofForSession(
  db: RelayDatabase,
  teacher: AuthenticatedRelayTeacher,
  session: SessionRow,
  now: Date,
) {
  try {
    return issueAttendancePresenceProofForTeacher(
      db,
      { institution_id: teacher.institution_id, actor_profile_id: session.teacher_id },
      session.client_session_id || session.id,
      now,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "relay_presence_proof_failed";
    throw new TeacherSessionOpenError(403, code);
  }
}

function resultFromReceipt(
  db: RelayDatabase,
  operation: TeacherSessionOpenOperation,
  teacher: AuthenticatedRelayTeacher,
  expectedFingerprint: string,
  receipt: StoredReceipt,
  now: Date,
): TeacherSessionOpenResult {
  const logicalPayloadMatches =
    receipt.operation_type === operation.operation_type &&
    receipt.class_id === operation.class_id &&
    receipt.period_id === operation.period_id;
  const exactPayloadMatches =
    receipt.protocol_version === operation.protocol_version &&
    receipt.payload_fingerprint === expectedFingerprint;
  const liveReceiptReplayedOffline =
    receipt.protocol_version === PROTOCOL_VERSION &&
    operation.protocol_version === RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION;

  if (
    !logicalPayloadMatches ||
    (!exactPayloadMatches && !liveReceiptReplayedOffline)
  ) {
    throw new TeacherSessionOpenError(409, "operation_id_reused_with_different_payload");
  }
  const session = sessionRow(db, teacher.institution_id, receipt.local_session_id);
  if (!session) throw new TeacherSessionOpenError(409, "local_session_mapping_missing");
  if (
    session.class_id !== receipt.class_id ||
    session.period_id !== receipt.period_id ||
    session.subject_id !== receipt.subject_id ||
    session.teacher_id !== receipt.teacher_profile_id
  ) {
    throw new TeacherSessionOpenError(409, "local_session_mapping_conflict");
  }
  if (session.session_state === "closed" || session.ended_at) {
    throw new TeacherSessionOpenError(409, "session_slot_already_closed");
  }
  if (session.session_state === "finalizing") {
    throw new TeacherSessionOpenError(409, "previous_session_owner_must_confirm");
  }
  const proof = proofForSession(db, teacher, session, now);
  return {
    ok: true,
    operation_id: operation.operation_id,
    state: receipt.state,
    idempotent: true,
    session: {
      id: session.id,
      client_session_id: session.client_session_id || session.id,
      class_id: session.class_id,
      subject_id: session.subject_id,
      period_id: session.period_id || operation.period_id,
      started_at: session.started_at,
      actual_call_at: session.actual_call_at,
      scheduled_end_at: session.scheduled_end_at,
      grace_expires_at: session.grace_expires_at,
      session_state: session.session_state,
    },
    presence_proof: proof.proof,
    proof_expires_at: proof.expires_at,
    relay_time: receipt.accepted_at,
  };
}

function sessionPayload(
  session: SessionRow,
  input: { operationId: string; timetableId: string },
) {
  return {
    id: session.id,
    institution_id: undefined,
    client_session_id: session.client_session_id || session.id,
    class_id: session.class_id,
    subject_id: session.subject_id,
    teacher_id: session.teacher_id,
    period_id: session.period_id,
    started_at: session.started_at,
    actual_call_at: session.actual_call_at,
    ended_at: session.ended_at,
    origin: session.origin,
    server_version: session.server_version,
    updated_at: session.updated_at,
    deleted_at: session.deleted_at,
    session_date: session.session_date,
    session_state: session.session_state,
    scheduled_start_at: session.scheduled_start_at,
    requested_start_at: session.requested_start_at,
    actual_started_at: session.actual_started_at,
    scheduled_end_at: session.scheduled_end_at,
    finalizing_at: session.finalizing_at,
    grace_expires_at: session.grace_expires_at,
    closed_at: session.closed_at,
    payable_end_at: session.payable_end_at,
    closure_source: session.closure_source,
    closure_confirmation: session.closure_confirmation,
    requires_payroll_review: session.requires_payroll_review === 1,
    attendance_snapshot_status: session.attendance_snapshot_status,
    local_session_id: session.id,
    remote_session_id: null,
    open_operation_id: input.operationId,
    timetable_id: input.timetableId,
  };
}

export function openTeacherAttendanceSession(
  db: RelayDatabase,
  raw: unknown,
  teacher: AuthenticatedRelayTeacher,
  now = new Date(),
  options: { faultInjector?: (stage: FaultStage) => void } = {},
): TeacherSessionOpenResult {
  const operation = parseOperation(raw);
  const operationFingerprint = fingerprint(operation, teacher);
  const existing = storedReceipt(db, teacher.institution_id, operation.operation_id);
  if (existing) {
    return resultFromReceipt(db, operation, teacher, operationFingerprint, existing, now);
  }

  let replay: ValidatedRelayOfflineReplay | null = null;
  let eventAt = now;
  if (operation.protocol_version === RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION) {
    try {
      replay = validateRelayOfflineReplay({
        db,
        institutionId: teacher.institution_id,
        operationId: operation.operation_id,
        eventAtRaw: operation.event_at,
        rawContext: operation.replay_context,
        now,
        requireOperationBoundClientSession: true,
      });
      if (replay.scheduleRevisionStale) {
        throw new RelayOfflineReplayError(
          "offline_replay_schedule_revision_stale_requires_review",
        );
      }
      eventAt = replay.eventAt;
    } catch (error) {
      const code = error instanceof RelayOfflineReplayError
        ? error.code
        : "offline_replay_invalid";
      throw new TeacherSessionOpenError(409, code);
    }
  }
  maintainTeacherAttendanceSessions(db, now);

  const persist = db.transaction(() => {
    const raced = storedReceipt(db, teacher.institution_id, operation.operation_id);
    if (raced) {
      return resultFromReceipt(db, operation, teacher, operationFingerprint, raced, now);
    }
    const business = validateBusinessRules(db, operation, teacher, eventAt);
    if (replay) {
      try {
        assertRelayReplayScheduledStart(replay, business.startedAt);
      } catch (error) {
        const code = error instanceof RelayOfflineReplayError
          ? error.code
          : "offline_replay_scheduled_start_invalid";
        throw new TeacherSessionOpenError(409, code);
      }
    }
    const acceptedAt = now.toISOString();
    const eventAtIso = eventAt.toISOString();
    const createdLocally = business.reusable === null;
    const sessionId = business.reusable?.id || randomUUID();
    if (createdLocally) {
      db.prepare(`
        INSERT INTO teacher_sessions(
          id, institution_id, client_session_id, class_id, subject_id,
          teacher_id, period_id, started_at, actual_call_at, ended_at,
          origin, server_version, updated_at, deleted_at,
          session_date, session_state, scheduled_start_at, requested_start_at,
          actual_started_at, scheduled_end_at, finalizing_at, grace_expires_at,
          closed_at, payable_end_at, closure_source, closure_confirmation,
          requires_payroll_review, local_lifecycle_managed,
          attendance_snapshot_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, NULL,
                  ?, 'open', ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL,
                  0, 1, 'none')
      `).run(
        sessionId,
        teacher.institution_id,
        replay?.clientSessionId || sessionId,
        operation.class_id,
        business.timetable.subject_id,
        business.timetable.teacher_id,
        operation.period_id,
        business.startedAt,
        eventAtIso,
        relayActorKind(teacher) === "class_device" ? "class_device" : "teacher",
        acceptedAt,
        business.sessionDate,
        business.startedAt,
        eventAtIso,
        eventAtIso,
        business.scheduledEndAt,
        business.graceExpiresAt,
      );
    } else {
      db.prepare(`
        UPDATE teacher_sessions
        SET session_date = COALESCE(session_date, ?),
            scheduled_start_at = COALESCE(scheduled_start_at, ?),
            requested_start_at = COALESCE(requested_start_at, ?),
            actual_started_at = COALESCE(actual_started_at, actual_call_at, ?),
            scheduled_end_at = COALESCE(scheduled_end_at, ?),
            grace_expires_at = COALESCE(grace_expires_at, ?),
            local_lifecycle_managed = 1,
            updated_at = ?
        WHERE institution_id = ? AND id = ?
      `).run(
        business.sessionDate,
        business.startedAt,
        eventAtIso,
        eventAtIso,
        business.scheduledEndAt,
        business.graceExpiresAt,
        acceptedAt,
        teacher.institution_id,
        sessionId,
      );
    }
    options.faultInjector?.("after_session");

    const session = sessionRow(db, teacher.institution_id, sessionId);
    if (!session) throw new TeacherSessionOpenError(500, "local_session_creation_failed");
    const storedPayload = {
      protocol_version: operation.protocol_version,
      operation_type: operation.operation_type,
      institution_id: teacher.institution_id,
      teacher_profile_id: session.teacher_id,
      auth_actor_profile_id: teacher.actor_profile_id,
      auth_actor_kind: relayActorKind(teacher),
      auth_class_id: teacher.class_id || null,
      class_id: operation.class_id,
      period_id: operation.period_id,
      timetable_id: business.timetable.id,
      subject_id: business.timetable.subject_id,
      local_session_id: session.id,
      remote_session_id: null,
      accepted_at: acceptedAt,
      event_at: eventAtIso,
      received_at: acceptedAt,
      replay_context: replay
        ? {
            client_session_id: replay.clientSessionId,
            schedule_revision: replay.scheduleRevision,
            schedule_revision_stale: replay.scheduleRevisionStale,
            timezone: replay.timezone,
            scheduled_start_at: replay.scheduledStartAt.toISOString(),
          }
        : null,
    };
    const payloadJson = canonicalJson(storedPayload);
    db.prepare(`
      INSERT INTO teacher_session_open_operations(
        operation_id, institution_id, protocol_version, operation_type,
        teacher_profile_id, class_id, period_id, timetable_id, subject_id,
        local_session_id, remote_session_id, payload_fingerprint, payload_json,
        created_locally, state, accepted_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'opened_on_relay', ?, ?)
    `).run(
      operation.operation_id,
      teacher.institution_id,
      operation.protocol_version,
      operation.operation_type,
      session.teacher_id,
      operation.class_id,
      operation.period_id,
      business.timetable.id,
      business.timetable.subject_id,
      session.id,
      operationFingerprint,
      payloadJson,
      createdLocally ? 1 : 0,
      acceptedAt,
      acceptedAt,
    );
    options.faultInjector?.("after_receipt");

    if (createdLocally) {
      const materializedPayload = {
        ...sessionPayload(session, {
          operationId: operation.operation_id,
          timetableId: business.timetable.id,
        }),
        institution_id: teacher.institution_id,
      };
      db.prepare(`
        INSERT INTO sync_outbox(
          operation_id, institution_id, device_id, actor_profile_id,
          entity_type, entity_id, action, base_server_version,
          payload_json, occurred_at, protocol_version, payload_fingerprint
        ) VALUES (?, ?, ?, ?, 'teacher_session', ?, 'upsert', 0, ?, ?, ?, ?)
      `).run(
        operation.operation_id,
        teacher.institution_id,
        relayActorDeviceId(teacher),
        session.teacher_id,
        session.id,
        canonicalJson({
          operation_type: "teacher_session.open",
          ...materializedPayload,
        }),
        eventAtIso,
        operation.protocol_version,
        operationFingerprint,
      );
      options.faultInjector?.("after_outbox");

      const priorClose = db.prepare(`
        SELECT closure.operation_id
        FROM teacher_session_closure_events closure
        JOIN teacher_sessions previous
          ON previous.institution_id = closure.institution_id
         AND previous.id = closure.session_id
        JOIN sync_outbox parent
          ON parent.institution_id = closure.institution_id
         AND parent.operation_id = closure.operation_id
        WHERE previous.institution_id = ? AND previous.class_id = ?
          AND previous.session_date = ? AND previous.period_id <> ?
          AND previous.scheduled_end_at <= ?
        ORDER BY previous.scheduled_end_at DESC, previous.id
        LIMIT 1
      `).get(
        teacher.institution_id,
        operation.class_id,
        business.sessionDate,
        operation.period_id,
        business.startedAt,
      ) as { operation_id: string } | undefined;
      if (priorClose) {
        db.prepare(`
          INSERT OR IGNORE INTO sync_outbox_dependencies(
            institution_id, operation_id, depends_on_operation_id, created_at
          ) VALUES (?, ?, ?, ?)
        `).run(
          teacher.institution_id,
          operation.operation_id,
          priorClose.operation_id,
          acceptedAt,
        );
      }

      db.prepare(`
        INSERT INTO sync_records(
          institution_id, entity_type, entity_id, payload_json, server_version,
          local_dirty, deleted_at, updated_at
        ) VALUES (?, 'teacher_session', ?, ?, 0, 1, NULL, ?)
        ON CONFLICT(institution_id, entity_type, entity_id) DO UPDATE SET
          payload_json = excluded.payload_json,
          local_dirty = 1,
          deleted_at = NULL,
          updated_at = excluded.updated_at
      `).run(
        teacher.institution_id,
        session.id,
        canonicalJson(materializedPayload),
        acceptedAt,
      );
      options.faultInjector?.("after_sync_record");
    }

    db.prepare(`
      INSERT INTO audit_log(
        institution_id, actor_profile_id, event_type, entity_type,
        entity_id, details_json, occurred_at
      ) VALUES (?, ?, 'attendance.session_opened', 'teacher_session', ?, ?, ?)
    `).run(
      teacher.institution_id,
      session.teacher_id,
      session.id,
      canonicalJson({
        operation_id: operation.operation_id,
        timetable_id: business.timetable.id,
        created_locally: createdLocally,
        payload_fingerprint: operationFingerprint,
        delivery_mode: replay ? "offline_replay" : "live",
        event_at: eventAtIso,
        received_at: acceptedAt,
      }),
      eventAtIso,
    );

    const proof = proofForSession(db, teacher, session, now);
    return {
      ok: true,
      operation_id: operation.operation_id,
      state: "opened_on_relay",
      idempotent: false,
      session: {
        id: session.id,
        client_session_id: session.client_session_id || session.id,
        class_id: session.class_id,
        subject_id: session.subject_id,
        period_id: session.period_id || operation.period_id,
        started_at: session.started_at,
        actual_call_at: session.actual_call_at,
        scheduled_end_at: session.scheduled_end_at,
        grace_expires_at: session.grace_expires_at,
        session_state: session.session_state,
      },
      presence_proof: proof.proof,
      proof_expires_at: proof.expires_at,
      relay_time: acceptedAt,
      delivery_mode: replay ? "offline_replay" : "live",
      event_at: eventAtIso,
      received_at: acceptedAt,
      schedule_revision_stale: replay?.scheduleRevisionStale ?? false,
    } as const;
  });
  return persist();
}

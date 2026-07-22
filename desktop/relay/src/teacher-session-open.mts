import { createHash, randomUUID } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { canonicalJson } from "./json.mjs";
import { issueAttendancePresenceProofForTeacher } from "./presence-proof.mjs";
import type { AuthenticatedRelayTeacher } from "./teacher-auth.mjs";

const PROTOCOL_VERSION = 1 as const;
const OPERATION_TYPE = "attendance.session.open" as const;

type TeacherSessionOpenOperation = {
  protocol_version: typeof PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof OPERATION_TYPE;
  class_id: string;
  period_id: string;
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
  };
  presence_proof: string;
  proof_expires_at: string;
  relay_time: string;
};

export class TeacherSessionOpenError extends Error {
  constructor(readonly status: number, readonly code: string) {
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
  const accepted = new Set([
    "protocol_version",
    "operation_id",
    "operation_type",
    "class_id",
    "period_id",
  ]);
  if (Object.keys(row).some((key) => !accepted.has(key))) {
    throw new TeacherSessionOpenError(400, "operation_field_not_supported");
  }
  if (row.protocol_version !== PROTOCOL_VERSION) {
    throw new TeacherSessionOpenError(400, "protocol_version_not_supported");
  }
  if (row.operation_type !== OPERATION_TYPE) {
    throw new TeacherSessionOpenError(400, "operation_type_not_supported");
  }
  return {
    protocol_version: PROTOCOL_VERSION,
    operation_id: text(row.operation_id, "operation_id_required", 128),
    operation_type: OPERATION_TYPE,
    class_id: text(row.class_id, "class_id_required"),
    period_id: text(row.period_id, "period_id_required"),
  };
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
    teacher_profile_id: teacher.actor_profile_id,
    class_id: operation.class_id,
    period_id: operation.period_id,
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
           updated_at, deleted_at
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
  const institution = db.prepare(`
    SELECT timezone FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(teacher.institution_id) as { timezone: string } | undefined;
  if (!institution) throw new TeacherSessionOpenError(404, "institution_not_initialized");

  const classRow = db.prepare(`
    SELECT 1 FROM classes
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(teacher.institution_id, operation.class_id);
  if (!classRow) throw new TeacherSessionOpenError(404, "class_not_found");

  const period = db.prepare(`
    SELECT id, weekday, start_time, end_time
    FROM institution_periods
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(teacher.institution_id, operation.period_id) as PeriodRow | undefined;
  if (!period) throw new TeacherSessionOpenError(404, "period_not_found");

  const timezone = String(institution.timezone || "Africa/Abidjan");
  const localNow = localDateTime(now, timezone);
  if (localNow.weekday === 0) {
    throw new TeacherSessionOpenError(409, "attendance_sunday_not_allowed");
  }
  const periodStart = timeMinutes(period.start_time);
  const periodEnd = timeMinutes(period.end_time);
  if (periodEnd <= periodStart) {
    throw new TeacherSessionOpenError(409, "period_time_invalid");
  }
  if (
    !weekdayMatches(period.weekday, localNow.weekday) ||
    localNow.minutes < periodStart ||
    localNow.minutes >= periodEnd
  ) {
    throw new TeacherSessionOpenError(409, "attendance_outside_slot");
  }

  const timetables = db.prepare(`
    SELECT id, subject_id
    FROM teacher_timetables
    WHERE institution_id = ? AND teacher_id = ? AND class_id = ?
      AND period_id = ? AND deleted_at IS NULL
      AND (weekday = ? OR (? = 0 AND weekday = 7))
    ORDER BY id
  `).all(
    teacher.institution_id,
    teacher.actor_profile_id,
    operation.class_id,
    operation.period_id,
    localNow.weekday,
    localNow.weekday,
  ) as TimetableRow[];
  if (timetables.length === 0) {
    throw new TeacherSessionOpenError(403, "teacher_not_scheduled_for_slot");
  }
  if (timetables.length > 1) {
    throw new TeacherSessionOpenError(409, "teacher_timetable_ambiguous");
  }
  const timetable = timetables[0];
  if (!timetable) throw new TeacherSessionOpenError(409, "teacher_timetable_ambiguous");

  const openSessions = db.prepare(`
    SELECT id, client_session_id, class_id, subject_id, teacher_id, period_id,
           started_at, actual_call_at, ended_at, origin, server_version,
           updated_at, deleted_at
    FROM teacher_sessions
    WHERE institution_id = ? AND teacher_id = ?
      AND ended_at IS NULL AND deleted_at IS NULL
    ORDER BY started_at, id
  `).all(teacher.institution_id, teacher.actor_profile_id) as SessionRow[];
  let reusable: SessionRow | null = null;
  for (const session of openSessions) {
    const localSession = localDateTime(session.started_at, timezone);
    const sameSlot =
      localSession.ymd === localNow.ymd && session.period_id === operation.period_id;
    if (
      sameSlot &&
      session.class_id === operation.class_id &&
      session.subject_id === timetable.subject_id
    ) {
      reusable = session;
      continue;
    }
    if (sameSlot) throw new TeacherSessionOpenError(409, "session_slot_conflict");
    throw new TeacherSessionOpenError(409, "concurrent_session_open");
  }

  return {
    localNow,
    period,
    timetable,
    reusable,
    startedAt: slotStartIso(localNow.ymd, period.start_time, timezone),
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
      teacher,
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
  if (
    receipt.protocol_version !== operation.protocol_version ||
    receipt.operation_type !== operation.operation_type ||
    receipt.teacher_profile_id !== teacher.actor_profile_id ||
    receipt.class_id !== operation.class_id ||
    receipt.period_id !== operation.period_id ||
    receipt.payload_fingerprint !== expectedFingerprint
  ) {
    throw new TeacherSessionOpenError(409, "operation_id_reused_with_different_payload");
  }
  const session = sessionRow(db, teacher.institution_id, receipt.local_session_id);
  if (!session) throw new TeacherSessionOpenError(409, "local_session_mapping_missing");
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

  const persist = db.transaction(() => {
    const raced = storedReceipt(db, teacher.institution_id, operation.operation_id);
    if (raced) {
      return resultFromReceipt(db, operation, teacher, operationFingerprint, raced, now);
    }
    const business = validateBusinessRules(db, operation, teacher, now);
    const acceptedAt = now.toISOString();
    const createdLocally = business.reusable === null;
    const sessionId = business.reusable?.id || randomUUID();
    if (createdLocally) {
      db.prepare(`
        INSERT INTO teacher_sessions(
          id, institution_id, client_session_id, class_id, subject_id,
          teacher_id, period_id, started_at, actual_call_at, ended_at,
          origin, server_version, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'teacher', 0, ?, NULL)
      `).run(
        sessionId,
        teacher.institution_id,
        sessionId,
        operation.class_id,
        business.timetable.subject_id,
        teacher.actor_profile_id,
        operation.period_id,
        business.startedAt,
        acceptedAt,
        acceptedAt,
      );
    }
    options.faultInjector?.("after_session");

    const session = sessionRow(db, teacher.institution_id, sessionId);
    if (!session) throw new TeacherSessionOpenError(500, "local_session_creation_failed");
    const storedPayload = {
      protocol_version: operation.protocol_version,
      operation_type: operation.operation_type,
      institution_id: teacher.institution_id,
      teacher_profile_id: teacher.actor_profile_id,
      class_id: operation.class_id,
      period_id: operation.period_id,
      timetable_id: business.timetable.id,
      subject_id: business.timetable.subject_id,
      local_session_id: session.id,
      remote_session_id: null,
      accepted_at: acceptedAt,
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
      teacher.actor_profile_id,
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
        `teacher:${teacher.actor_profile_id}`,
        teacher.actor_profile_id,
        session.id,
        canonicalJson({
          operation_type: "teacher_session.open",
          ...materializedPayload,
        }),
        acceptedAt,
        operation.protocol_version,
        operationFingerprint,
      );
      options.faultInjector?.("after_outbox");

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
      teacher.actor_profile_id,
      session.id,
      canonicalJson({
        operation_id: operation.operation_id,
        timetable_id: business.timetable.id,
        created_locally: createdLocally,
        payload_fingerprint: operationFingerprint,
      }),
      acceptedAt,
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
      },
      presence_proof: proof.proof,
      proof_expires_at: proof.expires_at,
      relay_time: acceptedAt,
    } as const;
  });
  return persist();
}

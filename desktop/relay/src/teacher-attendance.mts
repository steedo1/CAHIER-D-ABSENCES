import { createHash } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { canonicalJson, parseStoredJson } from "./json.mjs";
import {
  RelayPresenceProofError,
  verifyAttendancePresenceProof,
} from "./presence-proof.mjs";
import type { AuthenticatedRelayTeacher } from "./teacher-auth.mjs";

const PROTOCOL_VERSION = 1 as const;
const OPERATION_TYPE = "attendance.call.submit" as const;
const MAX_MARKS = 200;

type AttendanceStatus = "present" | "absent" | "late";

type TeacherAttendanceMark = {
  student_id: string;
  status: AttendanceStatus;
  comment: string | null;
};

type TeacherAttendanceOperation = {
  protocol_version: typeof PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof OPERATION_TYPE;
  session_id: string;
  class_id: string;
  period_id: string;
  presence_proof: string | null;
  marks: TeacherAttendanceMark[];
};

type SessionRow = {
  id: string;
  institution_id: string;
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

type PeriodRow = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

type StoredReceipt = {
  protocol_version: number;
  operation_type: string;
  teacher_profile_id: string;
  payload_fingerprint: string;
  state: "secured_on_relay" | "synced_with_cloud" | "blocked" | "conflict";
  accepted_at: string;
};

type FaultStage = "after_journal" | "after_outbox" | "after_materialization";

export type TeacherAttendanceResult = {
  ok: true;
  operation_id: string;
  state: StoredReceipt["state"];
  idempotent: boolean;
  relay_time: string;
};

export class TeacherAttendanceError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function object(value: unknown, code: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeacherAttendanceError(400, code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(row: Record<string, unknown>, allowed: readonly string[], code: string) {
  const accepted = new Set(allowed);
  if (Object.keys(row).some((key) => !accepted.has(key))) {
    throw new TeacherAttendanceError(400, code);
  }
}

function text(value: unknown, code: string, maxLength = 256) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TeacherAttendanceError(400, code);
  if (normalized.length > maxLength) throw new TeacherAttendanceError(400, `${code}_too_long`);
  return normalized;
}

function parseOperation(raw: unknown): TeacherAttendanceOperation {
  const row = object(raw, "operation_must_be_object");
  exactKeys(row, [
    "protocol_version",
    "operation_id",
    "operation_type",
    "session_id",
    "class_id",
    "period_id",
    "presence_proof",
    "marks",
  ], "operation_field_not_supported");
  if (row.protocol_version !== PROTOCOL_VERSION) {
    throw new TeacherAttendanceError(400, "protocol_version_not_supported");
  }
  if (row.operation_type !== OPERATION_TYPE) {
    throw new TeacherAttendanceError(400, "operation_type_not_supported");
  }
  if (!Array.isArray(row.marks) || row.marks.length === 0 || row.marks.length > MAX_MARKS) {
    throw new TeacherAttendanceError(400, "marks_invalid");
  }

  const studentIds = new Set<string>();
  const marks = row.marks.map((value) => {
    const mark = object(value, "mark_must_be_object");
    exactKeys(mark, ["student_id", "status", "comment"], "mark_field_not_supported");
    const studentId = text(mark.student_id, "student_id_required");
    if (studentIds.has(studentId)) throw new TeacherAttendanceError(400, "student_mark_duplicated");
    studentIds.add(studentId);
    if (mark.status !== "present" && mark.status !== "absent" && mark.status !== "late") {
      throw new TeacherAttendanceError(400, "attendance_status_not_supported");
    }
    const status = mark.status as AttendanceStatus;
    const rawComment = mark.comment;
    const comment = rawComment === undefined || rawComment === null
      ? null
      : text(rawComment, "comment_invalid", 500);
    return { student_id: studentId, status, comment };
  }).sort((left, right) => left.student_id.localeCompare(right.student_id));

  const rawProof = row.presence_proof;
  const presenceProof = rawProof === undefined || rawProof === null
    ? null
    : text(rawProof, "presence_proof_invalid", 4096);
  return {
    protocol_version: PROTOCOL_VERSION,
    operation_id: text(row.operation_id, "operation_id_required", 128),
    operation_type: OPERATION_TYPE,
    session_id: text(row.session_id, "session_id_required"),
    class_id: text(row.class_id, "class_id_required"),
    period_id: text(row.period_id, "period_id_required"),
    presence_proof: presenceProof,
    marks,
  };
}

function fingerprint(
  operation: TeacherAttendanceOperation,
  teacher: AuthenticatedRelayTeacher,
) {
  return createHash("sha256").update(canonicalJson({
    protocol_version: operation.protocol_version,
    operation_id: operation.operation_id,
    operation_type: operation.operation_type,
    institution_id: teacher.institution_id,
    teacher_profile_id: teacher.actor_profile_id,
    session_id: operation.session_id,
    class_id: operation.class_id,
    period_id: operation.period_id,
    marks: operation.marks,
  })).digest("hex");
}

function idempotentResult(
  operation: TeacherAttendanceOperation,
  teacher: AuthenticatedRelayTeacher,
  expectedFingerprint: string,
  stored: StoredReceipt,
): TeacherAttendanceResult {
  if (
    stored.protocol_version !== operation.protocol_version ||
    stored.operation_type !== operation.operation_type ||
    stored.teacher_profile_id !== teacher.actor_profile_id ||
    stored.payload_fingerprint !== expectedFingerprint
  ) {
    throw new TeacherAttendanceError(409, "operation_id_reused_with_different_payload");
  }
  return {
    ok: true,
    operation_id: operation.operation_id,
    state: stored.state,
    idempotent: true,
    relay_time: stored.accepted_at,
  };
}

function storedReceipt(
  db: RelayDatabase,
  institutionId: string,
  operationId: string,
) {
  return db.prepare(`
    SELECT protocol_version, operation_type, teacher_profile_id,
           payload_fingerprint, state, accepted_at
    FROM teacher_attendance_operations
    WHERE institution_id = ? AND operation_id = ?
  `).get(institutionId, operationId) as StoredReceipt | undefined;
}

function localDateTime(value: Date | string, timezone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TeacherAttendanceError(409, "session_time_invalid");
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
    throw new TeacherAttendanceError(409, "institution_timezone_invalid");
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  const weekday = new Map([
    ["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3],
    ["Thu", 4], ["Fri", 5], ["Sat", 6],
  ]).get(part("weekday"));
  if (weekday === undefined) throw new TeacherAttendanceError(409, "institution_timezone_invalid");
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  return {
    ymd: `${part("year")}-${part("month")}-${part("day")}`,
    weekday,
    minutes: hour * 60 + minute,
  };
}

function timeMinutes(value: string) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw new TeacherAttendanceError(409, "period_time_invalid");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new TeacherAttendanceError(409, "period_time_invalid");
  return hour * 60 + minute;
}

function weekdayMatches(periodWeekday: number, weekday: number) {
  return periodWeekday === weekday || (weekday === 0 && periodWeekday === 7);
}

function validateBusinessRules(
  db: RelayDatabase,
  operation: TeacherAttendanceOperation,
  teacher: AuthenticatedRelayTeacher,
  now: Date,
) {
  const institution = db.prepare(`
    SELECT timezone, settings_json FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(teacher.institution_id) as {
    timezone: string;
    settings_json: string | null;
  } | undefined;
  if (!institution) throw new TeacherAttendanceError(404, "institution_not_initialized");

  const session = db.prepare(`
    SELECT id, institution_id, client_session_id, class_id, subject_id, teacher_id,
           period_id, started_at, actual_call_at, ended_at, origin,
           server_version, updated_at, deleted_at
    FROM teacher_sessions
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(teacher.institution_id, operation.session_id) as SessionRow | undefined;
  if (!session) throw new TeacherAttendanceError(404, "session_not_found");
  if (session.teacher_id !== teacher.actor_profile_id) {
    throw new TeacherAttendanceError(403, "teacher_not_assigned_to_session");
  }
  if (session.class_id !== operation.class_id) {
    throw new TeacherAttendanceError(403, "class_mismatch");
  }
  if (session.period_id && session.period_id !== operation.period_id) {
    throw new TeacherAttendanceError(403, "period_mismatch");
  }
  if (session.ended_at) throw new TeacherAttendanceError(409, "session_closed");

  const classRow = db.prepare(`
    SELECT 1 FROM classes
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(teacher.institution_id, operation.class_id);
  if (!classRow) throw new TeacherAttendanceError(404, "class_not_found");

  const period = db.prepare(`
    SELECT id, weekday, start_time, end_time
    FROM institution_periods
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(teacher.institution_id, operation.period_id) as PeriodRow | undefined;
  if (!period) throw new TeacherAttendanceError(404, "period_not_found");

  const timezone = String(institution.timezone || "Africa/Abidjan");
  const localNow = localDateTime(now, timezone);
  const localSession = localDateTime(session.started_at, timezone);
  const periodStart = timeMinutes(period.start_time);
  const periodEnd = timeMinutes(period.end_time);
  if (periodEnd <= periodStart) throw new TeacherAttendanceError(409, "period_time_invalid");
  if (
    !weekdayMatches(period.weekday, localNow.weekday) ||
    localNow.minutes < periodStart ||
    localNow.minutes >= periodEnd
  ) {
    throw new TeacherAttendanceError(409, "attendance_outside_slot");
  }
  if (
    localSession.ymd !== localNow.ymd ||
    !weekdayMatches(period.weekday, localSession.weekday) ||
    localSession.minutes < periodStart ||
    localSession.minutes >= periodEnd
  ) {
    throw new TeacherAttendanceError(409, "session_outside_slot");
  }

  const timetable = db.prepare(`
    SELECT 1 FROM teacher_timetables
    WHERE institution_id = ? AND teacher_id = ? AND class_id = ?
      AND subject_id = ? AND period_id = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(
    teacher.institution_id,
    teacher.actor_profile_id,
    session.class_id,
    session.subject_id,
    operation.period_id,
  );
  if (!timetable) throw new TeacherAttendanceError(403, "teacher_not_scheduled_for_slot");

  for (const mark of operation.marks) {
    const student = db.prepare(`
      SELECT is_active FROM students
      WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
    `).get(teacher.institution_id, mark.student_id) as { is_active: number } | undefined;
    if (!student) throw new TeacherAttendanceError(404, "student_not_found");
    if (student.is_active !== 1) throw new TeacherAttendanceError(403, "student_inactive");
    const enrollment = db.prepare(`
      SELECT 1 FROM class_enrollments
      WHERE institution_id = ? AND class_id = ? AND student_id = ?
        AND deleted_at IS NULL
        AND (start_date IS NULL OR start_date <= ?)
        AND (end_date IS NULL OR end_date >= ?)
      LIMIT 1
    `).get(
      teacher.institution_id,
      session.class_id,
      mark.student_id,
      localNow.ymd,
      localNow.ymd,
    );
    if (!enrollment) throw new TeacherAttendanceError(403, "student_not_enrolled");
  }

  const settings = parseStoredJson<Record<string, unknown>>(institution.settings_json) || {};
  const attendance = settings.attendance_presence && typeof settings.attendance_presence === "object"
    ? settings.attendance_presence as Record<string, unknown>
    : {};
  if (attendance.enabled === true) {
    if (!operation.presence_proof) {
      throw new TeacherAttendanceError(428, "attendance_presence_required");
    }
    try {
      verifyAttendancePresenceProof(db, operation.presence_proof, {
        institutionId: teacher.institution_id,
        actorProfileId: teacher.actor_profile_id,
        clientSessionId: session.client_session_id || session.id,
      }, now);
    } catch (error) {
      const code = error instanceof RelayPresenceProofError ? error.code : "relay_proof_invalid";
      throw new TeacherAttendanceError(403, code);
    }
  }

  return { session, periodStart };
}

function materializedMarkId(institutionId: string, sessionId: string, studentId: string) {
  const digest = createHash("sha256")
    .update(`${institutionId}\u0000${sessionId}\u0000${studentId}`)
    .digest("hex");
  return `relay-attendance-${digest}`;
}

function mergedPayload(
  db: RelayDatabase,
  institutionId: string,
  entityType: "teacher_session" | "attendance_mark",
  entityId: string,
  materialized: Record<string, unknown>,
) {
  const stored = db.prepare(`
    SELECT payload_json FROM sync_records
    WHERE institution_id = ? AND entity_type = ? AND entity_id = ?
  `).get(institutionId, entityType, entityId) as { payload_json: string | null } | undefined;
  const previous = stored?.payload_json
    ? parseStoredJson<Record<string, unknown>>(stored.payload_json) || {}
    : {};
  return { ...previous, ...materialized };
}

function writeDirtyRecord(
  db: RelayDatabase,
  input: {
    institutionId: string;
    entityType: "teacher_session" | "attendance_mark";
    entityId: string;
    payload: Record<string, unknown>;
    serverVersion: number;
    updatedAt: string;
  },
) {
  db.prepare(`
    INSERT INTO sync_records(
      institution_id, entity_type, entity_id, payload_json, server_version,
      local_dirty, deleted_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, NULL, ?)
    ON CONFLICT(institution_id, entity_type, entity_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      server_version = MAX(sync_records.server_version, excluded.server_version),
      local_dirty = 1,
      deleted_at = NULL,
      updated_at = excluded.updated_at
  `).run(
    input.institutionId,
    input.entityType,
    input.entityId,
    canonicalJson(input.payload),
    input.serverVersion,
    input.updatedAt,
  );
}

export function secureTeacherAttendanceOperation(
  db: RelayDatabase,
  raw: unknown,
  teacher: AuthenticatedRelayTeacher,
  now = new Date(),
  options: { faultInjector?: (stage: FaultStage) => void } = {},
): TeacherAttendanceResult {
  const operation = parseOperation(raw);
  const operationFingerprint = fingerprint(operation, teacher);
  const existing = storedReceipt(db, teacher.institution_id, operation.operation_id);
  if (existing) return idempotentResult(operation, teacher, operationFingerprint, existing);

  const { session, periodStart } = validateBusinessRules(db, operation, teacher, now);
  const acceptedAt = now.toISOString();
  const localNow = localDateTime(now, String((db.prepare(`
    SELECT timezone FROM institutions WHERE id = ?
  `).get(teacher.institution_id) as { timezone: string }).timezone || "Africa/Abidjan"));
  const lateMinutes = Math.max(0, localNow.minutes - periodStart);
  const normalizedMarks = operation.marks.map((mark) => ({
    student_id: mark.student_id,
    status: mark.status,
    late_minutes: mark.status === "late" ? lateMinutes : null,
    comment: mark.comment,
  }));
  const storedPayload = {
    protocol_version: operation.protocol_version,
    operation_type: operation.operation_type,
    institution_id: teacher.institution_id,
    teacher_profile_id: teacher.actor_profile_id,
    session_id: operation.session_id,
    class_id: operation.class_id,
    period_id: operation.period_id,
    accepted_at: acceptedAt,
    marks: normalizedMarks,
  };
  const payloadJson = canonicalJson(storedPayload);

  const persist = db.transaction(() => {
    const raced = storedReceipt(db, teacher.institution_id, operation.operation_id);
    if (raced) return idempotentResult(operation, teacher, operationFingerprint, raced);

    db.prepare(`
      INSERT INTO teacher_attendance_operations(
        operation_id, institution_id, protocol_version, operation_type,
        teacher_profile_id, session_id, class_id, period_id,
        payload_fingerprint, payload_json, state, accepted_at,
        materialized_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'secured_on_relay', ?, NULL, ?)
    `).run(
      operation.operation_id,
      teacher.institution_id,
      operation.protocol_version,
      operation.operation_type,
      teacher.actor_profile_id,
      session.id,
      session.class_id,
      operation.period_id,
      operationFingerprint,
      payloadJson,
      acceptedAt,
      acceptedAt,
    );
    options.faultInjector?.("after_journal");

    db.prepare(`
      INSERT INTO sync_outbox(
        operation_id, institution_id, device_id, actor_profile_id,
        entity_type, entity_id, action, base_server_version,
        payload_json, occurred_at, protocol_version, payload_fingerprint
      ) VALUES (?, ?, ?, ?, 'attendance_call', ?, 'upsert', ?, ?, ?, ?, ?)
    `).run(
      operation.operation_id,
      teacher.institution_id,
      `teacher:${teacher.actor_profile_id}`,
      teacher.actor_profile_id,
      session.id,
      session.server_version,
      payloadJson,
      acceptedAt,
      operation.protocol_version,
      operationFingerprint,
    );
    options.faultInjector?.("after_outbox");

    db.prepare(`
      UPDATE teacher_sessions
      SET actual_call_at = COALESCE(actual_call_at, ?),
          period_id = COALESCE(period_id, ?),
          updated_at = ?
      WHERE institution_id = ? AND id = ?
    `).run(acceptedAt, operation.period_id, acceptedAt, teacher.institution_id, session.id);
    const materializedSession = db.prepare(`
      SELECT institution_id, client_session_id, class_id, subject_id, teacher_id,
             period_id, started_at, actual_call_at, ended_at, origin,
             server_version, updated_at, deleted_at
      FROM teacher_sessions WHERE institution_id = ? AND id = ?
    `).get(teacher.institution_id, session.id) as Record<string, unknown>;
    writeDirtyRecord(db, {
      institutionId: teacher.institution_id,
      entityType: "teacher_session",
      entityId: session.id,
      payload: mergedPayload(
        db,
        teacher.institution_id,
        "teacher_session",
        session.id,
        { id: session.id, ...materializedSession },
      ),
      serverVersion: session.server_version,
      updatedAt: acceptedAt,
    });

    for (const mark of normalizedMarks) {
      const current = db.prepare(`
        SELECT id, server_version FROM attendance_marks
        WHERE institution_id = ? AND session_id = ? AND student_id = ?
      `).get(teacher.institution_id, session.id, mark.student_id) as {
        id: string;
        server_version: number;
      } | undefined;
      const markId = current?.id || materializedMarkId(
        teacher.institution_id,
        session.id,
        mark.student_id,
      );
      const serverVersion = current?.server_version || 0;
      db.prepare(`
        INSERT INTO attendance_marks(
          id, institution_id, session_id, student_id, status,
          late_minutes, comment, server_version, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(institution_id, id) DO UPDATE SET
          status = excluded.status,
          late_minutes = excluded.late_minutes,
          comment = excluded.comment,
          updated_at = excluded.updated_at,
          deleted_at = NULL
      `).run(
        markId,
        teacher.institution_id,
        session.id,
        mark.student_id,
        mark.status,
        mark.late_minutes,
        mark.comment,
        serverVersion,
        acceptedAt,
      );
      const materializedMark = {
        id: markId,
        institution_id: teacher.institution_id,
        session_id: session.id,
        student_id: mark.student_id,
        status: mark.status,
        late_minutes: mark.late_minutes,
        comment: mark.comment,
        server_version: serverVersion,
        updated_at: acceptedAt,
        deleted_at: null,
      };
      writeDirtyRecord(db, {
        institutionId: teacher.institution_id,
        entityType: "attendance_mark",
        entityId: markId,
        payload: mergedPayload(
          db,
          teacher.institution_id,
          "attendance_mark",
          markId,
          materializedMark,
        ),
        serverVersion,
        updatedAt: acceptedAt,
      });
    }
    options.faultInjector?.("after_materialization");

    db.prepare(`
      UPDATE teacher_attendance_operations
      SET materialized_at = ?, updated_at = ?
      WHERE institution_id = ? AND operation_id = ?
    `).run(acceptedAt, acceptedAt, teacher.institution_id, operation.operation_id);
    db.prepare(`
      INSERT INTO audit_log(
        institution_id, actor_profile_id, event_type, entity_id,
        details_json, occurred_at
      ) VALUES (?, ?, 'attendance.operation_secured', ?, ?, ?)
    `).run(
      teacher.institution_id,
      teacher.actor_profile_id,
      session.id,
      canonicalJson({
        operation_id: operation.operation_id,
        mark_count: normalizedMarks.length,
        payload_fingerprint: operationFingerprint,
      }),
      acceptedAt,
    );
    return {
      ok: true,
      operation_id: operation.operation_id,
      state: "secured_on_relay",
      idempotent: false,
      relay_time: acceptedAt,
    } as const;
  });
  return persist();
}

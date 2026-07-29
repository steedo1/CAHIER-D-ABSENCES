import { createHash, randomUUID } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { canonicalJson, parseStoredJson } from "./json.mjs";
import { issueAttendancePresenceProofForTeacher } from "./presence-proof.mjs";
import { relayActorClassId, relayActorDeviceId, relayActorKind, type AuthenticatedRelayTeacher } from "./teacher-auth.mjs";
import {
  resolveTeacherScheduledSlot,
  TeacherSessionRuleError,
  type TeacherScheduledSlot,
} from "./teacher-session-rules.mjs";

const PROTOCOL_VERSION = 1 as const;
const CLOSE_OPERATION_TYPE = "attendance.session.close" as const;
const TRANSITION_OPERATION_TYPE = "attendance.session.transition" as const;

type ClosureSource =
  | "teacher_confirmed"
  | "next_slot_takeover"
  | "automatic_grace_expired";
type ClosureConfirmation = "confirmed" | "unconfirmed";

export type TeacherSessionLifecycleRow = {
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
  closure_source: ClosureSource | "cloud_existing" | null;
  closure_confirmation: ClosureConfirmation | null;
  requires_payroll_review: number;
  local_lifecycle_managed: number;
  last_attendance_operation_id: string | null;
  attendance_durable_at: string | null;
  attendance_snapshot_status: "none" | "partial" | "complete";
};

type CloseOperation = {
  protocol_version: 1;
  operation_id: string;
  operation_type: typeof CLOSE_OPERATION_TYPE;
  session_id: string;
};

type TransitionOperation = {
  protocol_version: 1;
  operation_id: string;
  operation_type: typeof TRANSITION_OPERATION_TYPE;
  class_id: string;
  period_id: string;
};

type FaultStage =
  | "after_previous_close"
  | "after_new_session"
  | "after_new_open_outbox"
  | "after_transition_receipt";

export class TeacherSessionLifecycleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(code);
  }
}

function record(value: unknown, code: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeacherSessionLifecycleError(400, code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new TeacherSessionLifecycleError(400, "operation_field_not_supported");
  }
}

function text(value: unknown, code: string, maxLength = 256) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TeacherSessionLifecycleError(400, code);
  if (normalized.length > maxLength) {
    throw new TeacherSessionLifecycleError(400, `${code}_too_long`);
  }
  return normalized;
}

function parseClose(raw: unknown): CloseOperation {
  const value = record(raw, "operation_must_be_object");
  exactKeys(value, ["protocol_version", "operation_id", "operation_type", "session_id"]);
  if (value.protocol_version !== PROTOCOL_VERSION) {
    throw new TeacherSessionLifecycleError(400, "protocol_version_not_supported");
  }
  if (value.operation_type !== CLOSE_OPERATION_TYPE) {
    throw new TeacherSessionLifecycleError(400, "operation_type_not_supported");
  }
  return {
    protocol_version: PROTOCOL_VERSION,
    operation_id: text(value.operation_id, "operation_id_required", 128),
    operation_type: CLOSE_OPERATION_TYPE,
    session_id: text(value.session_id, "session_id_required"),
  };
}

function parseTransition(raw: unknown): TransitionOperation {
  const value = record(raw, "operation_must_be_object");
  exactKeys(value, [
    "protocol_version", "operation_id", "operation_type", "class_id", "period_id",
  ]);
  if (value.protocol_version !== PROTOCOL_VERSION) {
    throw new TeacherSessionLifecycleError(400, "protocol_version_not_supported");
  }
  if (value.operation_type !== TRANSITION_OPERATION_TYPE) {
    throw new TeacherSessionLifecycleError(400, "operation_type_not_supported");
  }
  return {
    protocol_version: PROTOCOL_VERSION,
    operation_id: text(value.operation_id, "operation_id_required", 128),
    operation_type: TRANSITION_OPERATION_TYPE,
    class_id: text(value.class_id, "class_id_required"),
    period_id: text(value.period_id, "period_id_required"),
  };
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function derivedOperationId(kind: "close" | "open", institutionId: string, operationId: string) {
  const digest = createHash("sha256")
    .update(`${institutionId}\u0000${operationId}\u0000${kind}`)
    .digest("hex");
  return `transition-${kind}:${digest}`;
}

export function teacherSessionLifecycleRow(
  db: RelayDatabase,
  institutionId: string,
  sessionId: string,
) {
  return db.prepare(`
    SELECT id, institution_id, client_session_id, class_id, subject_id,
           teacher_id, period_id, started_at, actual_call_at, ended_at,
           origin, server_version, updated_at, deleted_at,
           session_date, session_state, scheduled_start_at,
           requested_start_at, actual_started_at, scheduled_end_at,
           finalizing_at, grace_expires_at, closed_at, payable_end_at,
           closure_source, closure_confirmation, requires_payroll_review,
           local_lifecycle_managed, last_attendance_operation_id,
           attendance_durable_at, attendance_snapshot_status
    FROM teacher_sessions
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(institutionId, sessionId) as TeacherSessionLifecycleRow | undefined;
}

function sessionPayload(session: TeacherSessionLifecycleRow) {
  const { institution_id: institutionId, ...payload } = session;
  return { ...payload, institution_id: institutionId };
}

function writeDirtySession(db: RelayDatabase, session: TeacherSessionLifecycleRow) {
  const current = db.prepare(`
    SELECT payload_json FROM sync_records
    WHERE institution_id = ? AND entity_type = 'teacher_session' AND entity_id = ?
  `).get(session.institution_id, session.id) as { payload_json: string | null } | undefined;
  const previous = parseStoredJson<Record<string, unknown>>(current?.payload_json ?? null) || {};
  db.prepare(`
    INSERT INTO sync_records(
      institution_id, entity_type, entity_id, payload_json, server_version,
      local_dirty, deleted_at, updated_at
    ) VALUES (?, 'teacher_session', ?, ?, ?, 1, NULL, ?)
    ON CONFLICT(institution_id, entity_type, entity_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      server_version = MAX(sync_records.server_version, excluded.server_version),
      local_dirty = 1,
      deleted_at = NULL,
      updated_at = excluded.updated_at
  `).run(
    session.institution_id,
    session.id,
    canonicalJson({ ...previous, ...sessionPayload(session) }),
    session.server_version,
    session.updated_at,
  );
}

function safePreviousSummary(
  db: RelayDatabase,
  institutionId: string,
  sessionId: string,
  requesterId: string,
) {
  const row = db.prepare(`
    SELECT ts.id, ts.teacher_id, ts.session_state, ts.scheduled_start_at,
           ts.scheduled_end_at, ts.grace_expires_at,
           c.label AS class_label, s.name AS subject_name,
           p.label AS period_label
    FROM teacher_sessions ts
    JOIN classes c ON c.institution_id = ts.institution_id AND c.id = ts.class_id
    JOIN subjects s ON s.institution_id = ts.institution_id AND s.id = ts.subject_id
    LEFT JOIN institution_periods p
      ON p.institution_id = ts.institution_id AND p.id = ts.period_id
    WHERE ts.institution_id = ? AND ts.id = ?
  `).get(institutionId, sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    session_state: row.session_state,
    class_label: row.class_label,
    subject_name: row.subject_name,
    period_label: row.period_label,
    scheduled_start_at: row.scheduled_start_at,
    scheduled_end_at: row.scheduled_end_at,
    grace_expires_at: row.grace_expires_at,
    owned_by_requester: row.teacher_id === requesterId,
  };
}

function insertOutboxDependenciesForClose(
  db: RelayDatabase,
  session: TeacherSessionLifecycleRow,
  closeOperationId: string,
  createdAt: string,
) {
  const parents = db.prepare(`
    SELECT operation_id
    FROM sync_outbox
    WHERE institution_id = ?
      AND operation_id <> ?
      AND (
        (entity_type = 'attendance_call' AND entity_id = ?)
        OR operation_id IN (
          SELECT operation_id FROM teacher_session_open_operations
          WHERE institution_id = ? AND local_session_id = ?
        )
      )
    ORDER BY occurred_at, operation_id
  `).all(
    session.institution_id,
    closeOperationId,
    session.id,
    session.institution_id,
    session.id,
  ) as Array<{ operation_id: string }>;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sync_outbox_dependencies(
      institution_id, operation_id, depends_on_operation_id, created_at
    ) VALUES (?, ?, ?, ?)
  `);
  for (const parent of parents) {
    insert.run(session.institution_id, closeOperationId, parent.operation_id, createdAt);
  }
}

function closeSessionInternal(
  db: RelayDatabase,
  input: {
    session: TeacherSessionLifecycleRow;
    operationId: string;
    fingerprint: string;
    requestedByProfileId: string | null;
    deviceId?: string | null;
    source: ClosureSource;
    confirmation: ClosureConfirmation;
    requestedAt: string;
    now: Date;
  },
) {
  const existingByOperation = db.prepare(`
    SELECT session_id, requested_by_profile_id, closure_source,
           payload_fingerprint, closed_at
    FROM teacher_session_closure_events
    WHERE institution_id = ? AND operation_id = ?
  `).get(input.session.institution_id, input.operationId) as {
    session_id: string;
    requested_by_profile_id: string | null;
    closure_source: string;
    payload_fingerprint: string;
    closed_at: string;
  } | undefined;
  if (existingByOperation) {
    if (
      existingByOperation.session_id !== input.session.id ||
      existingByOperation.requested_by_profile_id !== input.requestedByProfileId ||
      existingByOperation.closure_source !== input.source ||
      existingByOperation.payload_fingerprint !== input.fingerprint
    ) {
      throw new TeacherSessionLifecycleError(409, "operation_id_reused_with_different_payload");
    }
    const current = teacherSessionLifecycleRow(
      db,
      input.session.institution_id,
      input.session.id,
    );
    if (!current) throw new TeacherSessionLifecycleError(409, "session_closure_mapping_missing");
    return { session: current, idempotent: true, alreadyClosed: true };
  }

  if (input.session.session_state === "closed" || input.session.ended_at) {
    return { session: input.session, idempotent: true, alreadyClosed: true };
  }
  const scheduledEndMs = new Date(input.session.scheduled_end_at || "").getTime();
  if (!Number.isFinite(scheduledEndMs)) {
    throw new TeacherSessionLifecycleError(409, "session_schedule_missing");
  }
  const closedAt = input.now.toISOString();
  const payableEndAt = new Date(Math.min(input.now.getTime(), scheduledEndMs)).toISOString();
  const requiresReview = input.confirmation === "unconfirmed" ? 1 : 0;
  const closurePayload = {
    protocol_version: PROTOCOL_VERSION,
    operation_type: CLOSE_OPERATION_TYPE,
    institution_id: input.session.institution_id,
    session_id: input.session.id,
    teacher_profile_id: input.session.teacher_id,
    requested_by_profile_id: input.requestedByProfileId,
    scheduled_end_at: input.session.scheduled_end_at,
    closed_at: closedAt,
    payable_end_at: payableEndAt,
    closure_source: input.source,
    closure_confirmation: input.confirmation,
    requires_payroll_review: requiresReview === 1,
    attendance_snapshot_status: input.session.attendance_snapshot_status,
  };

  const occupiedOutbox = db.prepare(`
    SELECT entity_type, entity_id FROM sync_outbox
    WHERE institution_id = ? AND operation_id = ?
  `).get(input.session.institution_id, input.operationId) as {
    entity_type: string;
    entity_id: string;
  } | undefined;
  if (occupiedOutbox) {
    throw new TeacherSessionLifecycleError(409, "operation_id_conflicts_with_existing_outbox");
  }

  const updated = db.prepare(`
    UPDATE teacher_sessions
    SET ended_at = ?, session_state = 'closed', closed_at = ?,
        payable_end_at = ?, closure_source = ?, closure_confirmation = ?,
        requires_payroll_review = ?, updated_at = ?
    WHERE institution_id = ? AND id = ?
      AND session_state <> 'closed' AND ended_at IS NULL
  `).run(
    closedAt,
    closedAt,
    payableEndAt,
    input.source,
    input.confirmation,
    requiresReview,
    closedAt,
    input.session.institution_id,
    input.session.id,
  );
  if (updated.changes !== 1) {
    const raced = teacherSessionLifecycleRow(db, input.session.institution_id, input.session.id);
    if (!raced) throw new TeacherSessionLifecycleError(404, "session_not_found");
    return { session: raced, idempotent: true, alreadyClosed: true };
  }

  db.prepare(`
    INSERT INTO teacher_session_closure_events(
      institution_id, session_id, operation_id, protocol_version,
      operation_type, requested_by_profile_id, closure_source,
      closure_confirmation, payload_fingerprint, payload_json,
      requested_at, closed_at, payable_end_at,
      requires_payroll_review, created_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.session.institution_id,
    input.session.id,
    input.operationId,
    CLOSE_OPERATION_TYPE,
    input.requestedByProfileId,
    input.source,
    input.confirmation,
    input.fingerprint,
    canonicalJson(closurePayload),
    input.requestedAt,
    closedAt,
    payableEndAt,
    requiresReview,
    closedAt,
  );
  db.prepare(`
    INSERT INTO sync_outbox(
      operation_id, institution_id, device_id, actor_profile_id,
      entity_type, entity_id, action, base_server_version,
      payload_json, occurred_at, protocol_version, payload_fingerprint
    ) VALUES (?, ?, ?, ?, 'teacher_session', ?, 'upsert', ?, ?, ?, 1, ?)
  `).run(
    input.operationId,
    input.session.institution_id,
    input.deviceId || (input.requestedByProfileId
      ? `teacher:${input.requestedByProfileId}`
      : "relay:automatic-session-maintenance"),
    input.requestedByProfileId,
    input.session.id,
    input.session.server_version,
    canonicalJson({ ...closurePayload, sync_operation_type: "teacher_session.close" }),
    input.requestedAt,
    input.fingerprint,
  );
  insertOutboxDependenciesForClose(db, input.session, input.operationId, closedAt);

  const current = teacherSessionLifecycleRow(db, input.session.institution_id, input.session.id);
  if (!current) throw new TeacherSessionLifecycleError(500, "session_close_failed");
  writeDirtySession(db, current);
  db.prepare(`
    INSERT INTO audit_log(
      institution_id, actor_profile_id, event_type, entity_type,
      entity_id, details_json, occurred_at
    ) VALUES (?, ?, 'attendance.session_closed', 'teacher_session', ?, ?, ?)
  `).run(
    current.institution_id,
    input.requestedByProfileId,
    current.id,
    canonicalJson({
      operation_id: input.operationId,
      closure_source: input.source,
      closure_confirmation: input.confirmation,
      requires_payroll_review: requiresReview === 1,
      attendance_snapshot_status: current.attendance_snapshot_status,
    }),
    closedAt,
  );
  return { session: current, idempotent: false, alreadyClosed: false };
}

function markFinalizing(db: RelayDatabase, session: TeacherSessionLifecycleRow) {
  if (session.session_state !== "open" || !session.scheduled_end_at) return session;
  const changed = db.prepare(`
    UPDATE teacher_sessions
    SET session_state = 'finalizing',
        finalizing_at = COALESCE(finalizing_at, scheduled_end_at),
        updated_at = CASE WHEN updated_at > scheduled_end_at THEN updated_at ELSE scheduled_end_at END
    WHERE institution_id = ? AND id = ? AND session_state = 'open' AND ended_at IS NULL
  `).run(session.institution_id, session.id);
  const current = teacherSessionLifecycleRow(db, session.institution_id, session.id) || session;
  if (changed.changes === 1) {
    writeDirtySession(db, current);
    db.prepare(`
      INSERT INTO audit_log(
        institution_id, event_type, entity_type, entity_id, details_json, occurred_at
      ) VALUES (?, 'attendance.session_finalizing', 'teacher_session', ?, ?, ?)
    `).run(
      session.institution_id,
      session.id,
      canonicalJson({ scheduled_end_at: session.scheduled_end_at }),
      session.scheduled_end_at,
    );
  }
  return current;
}

function maintenanceInside(db: RelayDatabase, now: Date) {
  const nowIso = now.toISOString();
  const candidates = db.prepare(`
    SELECT id, institution_id, client_session_id, class_id, subject_id,
           teacher_id, period_id, started_at, actual_call_at, ended_at,
           origin, server_version, updated_at, deleted_at,
           session_date, session_state, scheduled_start_at,
           requested_start_at, actual_started_at, scheduled_end_at,
           finalizing_at, grace_expires_at, closed_at, payable_end_at,
           closure_source, closure_confirmation, requires_payroll_review,
           local_lifecycle_managed, last_attendance_operation_id,
           attendance_durable_at, attendance_snapshot_status
    FROM teacher_sessions
    WHERE local_lifecycle_managed = 1 AND ended_at IS NULL
      AND session_state IN ('open', 'finalizing')
      AND scheduled_end_at IS NOT NULL AND scheduled_end_at <= ?
    ORDER BY scheduled_end_at, institution_id, id
  `).all(nowIso) as TeacherSessionLifecycleRow[];
  let finalized = 0;
  let closed = 0;
  const closureOperationIds: string[] = [];
  for (let session of candidates) {
    if (session.session_state === "open") {
      session = markFinalizing(db, session);
      finalized += 1;
    }
    const graceMs = new Date(session.grace_expires_at || "").getTime();
    if (!Number.isFinite(graceMs) || now.getTime() < graceMs) continue;
    const operationId = `automatic-close:${createHash("sha256")
      .update(`${session.institution_id}\u0000${session.id}`)
      .digest("hex")}`;
    const operationFingerprint = fingerprint({
      protocol_version: PROTOCOL_VERSION,
      operation_id: operationId,
      operation_type: CLOSE_OPERATION_TYPE,
      institution_id: session.institution_id,
      session_id: session.id,
      closure_source: "automatic_grace_expired",
    });
    const result = closeSessionInternal(db, {
      session,
      operationId,
      fingerprint: operationFingerprint,
      requestedByProfileId: null,
      source: "automatic_grace_expired",
      confirmation: "unconfirmed",
      requestedAt: session.grace_expires_at || nowIso,
      now,
    });
    if (!result.alreadyClosed) {
      closed += 1;
      closureOperationIds.push(operationId);
    }
  }
  return { finalized, closed, closureOperationIds };
}

export function maintainTeacherAttendanceSessions(db: RelayDatabase, now = new Date()) {
  return db.transaction(() => maintenanceInside(db, now))();
}

function closeResult(
  operationId: string,
  result: ReturnType<typeof closeSessionInternal>,
  relayTime: string,
) {
  return {
    ok: true as const,
    operation_id: operationId,
    idempotent: result.idempotent,
    already_closed: result.alreadyClosed,
    relay_time: relayTime,
    session: {
      id: result.session.id,
      session_state: result.session.session_state,
      closed_at: result.session.closed_at || result.session.ended_at,
      scheduled_end_at: result.session.scheduled_end_at,
      payable_end_at: result.session.payable_end_at,
      closure_source: result.session.closure_source,
      closure_confirmation: result.session.closure_confirmation,
      requires_payroll_review: result.session.requires_payroll_review === 1,
    },
  };
}

export function closeTeacherAttendanceSession(
  db: RelayDatabase,
  raw: unknown,
  teacher: AuthenticatedRelayTeacher,
  now = new Date(),
) {
  const operation = parseClose(raw);
  const requestedAt = now.toISOString();
  const operationFingerprint = fingerprint({
    ...operation,
    institution_id: teacher.institution_id,
    auth_actor_profile_id: teacher.actor_profile_id,
    auth_actor_kind: relayActorKind(teacher),
    auth_class_id: relayActorClassId(teacher),
  });
  return db.transaction(() => {
    maintenanceInside(db, now);
    const session = teacherSessionLifecycleRow(db, teacher.institution_id, operation.session_id);
    if (!session) throw new TeacherSessionLifecycleError(404, "session_not_found");
    if (relayActorKind(teacher) === "teacher") {
      if (session.teacher_id !== teacher.actor_profile_id) {
        throw new TeacherSessionLifecycleError(403, "forbidden_not_owner");
      }
    } else if (session.class_id !== relayActorClassId(teacher)) {
      throw new TeacherSessionLifecycleError(403, "class_device_class_mismatch");
    }
    const result = closeSessionInternal(db, {
      session,
      operationId: operation.operation_id,
      fingerprint: operationFingerprint,
      requestedByProfileId: session.teacher_id,
      deviceId: relayActorDeviceId(teacher),
      source: "teacher_confirmed",
      confirmation: "confirmed",
      requestedAt,
      now,
    });
    return closeResult(operation.operation_id, result, requestedAt);
  })();
}

function transitionReceipt(
  db: RelayDatabase,
  institutionId: string,
  operationId: string,
) {
  return db.prepare(`
    SELECT requesting_teacher_profile_id, previous_session_id, new_session_id,
           class_id, period_id, requested_start_at, close_operation_id,
           open_operation_id, payload_fingerprint, state, accepted_at
    FROM teacher_session_transition_operations
    WHERE institution_id = ? AND operation_id = ?
  `).get(institutionId, operationId) as {
    requesting_teacher_profile_id: string;
    previous_session_id: string;
    new_session_id: string;
    class_id: string;
    period_id: string;
    requested_start_at: string;
    close_operation_id: string;
    open_operation_id: string;
    payload_fingerprint: string;
    state: string;
    accepted_at: string;
  } | undefined;
}

function transitionResult(
  db: RelayDatabase,
  receipt: NonNullable<ReturnType<typeof transitionReceipt>>,
  teacher: AuthenticatedRelayTeacher,
  operationId: string,
  idempotent: boolean,
  now: Date,
) {
  const previous = teacherSessionLifecycleRow(db, teacher.institution_id, receipt.previous_session_id);
  const next = teacherSessionLifecycleRow(db, teacher.institution_id, receipt.new_session_id);
  if (!previous || !next) {
    throw new TeacherSessionLifecycleError(409, "transition_session_mapping_missing");
  }
  let proof: ReturnType<typeof issueAttendancePresenceProofForTeacher> | null = null;
  if (next.session_state !== "closed") {
    proof = issueAttendancePresenceProofForTeacher(
      db,
      teacher,
      next.client_session_id || next.id,
      now,
    );
  }
  return {
    ok: true as const,
    operation_id: operationId,
    state: receipt.state,
    idempotent,
    requested_start_at: receipt.requested_start_at,
    relay_time: receipt.accepted_at,
    previous_session: {
      id: previous.id,
      session_state: previous.session_state,
      closed_at: previous.closed_at,
      payable_end_at: previous.payable_end_at,
      closure_source: previous.closure_source,
      closure_confirmation: previous.closure_confirmation,
      requires_payroll_review: previous.requires_payroll_review === 1,
      attendance_snapshot_status: previous.attendance_snapshot_status,
    },
    session: {
      id: next.id,
      client_session_id: next.client_session_id || next.id,
      class_id: next.class_id,
      subject_id: next.subject_id,
      period_id: next.period_id,
      started_at: next.started_at,
      requested_start_at: next.requested_start_at,
      actual_call_at: next.actual_call_at,
      scheduled_end_at: next.scheduled_end_at,
      grace_expires_at: next.grace_expires_at,
      session_state: next.session_state,
    },
    presence_proof: proof?.proof || null,
    proof_expires_at: proof?.expires_at || null,
  };
}

function createTransitionSession(
  db: RelayDatabase,
  operation: TransitionOperation,
  teacher: AuthenticatedRelayTeacher,
  schedule: TeacherScheduledSlot,
  requestedStartAt: string,
  openOperationId: string,
) {
  const existing = db.prepare(`
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
  if (existing) {
    const session = teacherSessionLifecycleRow(db, teacher.institution_id, existing.id);
    if (!session) throw new TeacherSessionLifecycleError(409, "session_slot_conflict");
    if (session.session_state === "closed") {
      throw new TeacherSessionLifecycleError(409, "session_slot_already_closed");
    }
    if (
      session.teacher_id !== teacher.actor_profile_id ||
      session.subject_id !== schedule.timetable.subject_id
    ) {
      throw new TeacherSessionLifecycleError(409, "session_slot_conflict");
    }
    return { session, created: false };
  }

  const sessionId = randomUUID();
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'teacher', 0, ?, NULL,
              ?, 'open', ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL,
              0, 1, 'none')
  `).run(
    sessionId,
    teacher.institution_id,
    sessionId,
    operation.class_id,
    schedule.timetable.subject_id,
    teacher.actor_profile_id,
    operation.period_id,
    schedule.scheduledStartAt,
    requestedStartAt,
    requestedStartAt,
    schedule.sessionDate,
    schedule.scheduledStartAt,
    requestedStartAt,
    requestedStartAt,
    schedule.scheduledEndAt,
    schedule.graceExpiresAt,
  );
  const session = teacherSessionLifecycleRow(db, teacher.institution_id, sessionId);
  if (!session) throw new TeacherSessionLifecycleError(500, "local_session_creation_failed");
  const openFingerprint = fingerprint({
    protocol_version: PROTOCOL_VERSION,
    operation_id: openOperationId,
    operation_type: "attendance.session.open",
    institution_id: teacher.institution_id,
    teacher_profile_id: teacher.actor_profile_id,
    class_id: operation.class_id,
    period_id: operation.period_id,
  });
  const openPayload = {
    protocol_version: PROTOCOL_VERSION,
    operation_type: "attendance.session.open",
    institution_id: teacher.institution_id,
    teacher_profile_id: teacher.actor_profile_id,
    class_id: operation.class_id,
    period_id: operation.period_id,
    timetable_id: schedule.timetable.id,
    subject_id: schedule.timetable.subject_id,
    local_session_id: session.id,
    remote_session_id: null,
    accepted_at: requestedStartAt,
    requested_start_at: requestedStartAt,
  };
  db.prepare(`
    INSERT INTO teacher_session_open_operations(
      operation_id, institution_id, protocol_version, operation_type,
      teacher_profile_id, class_id, period_id, timetable_id, subject_id,
      local_session_id, remote_session_id, payload_fingerprint, payload_json,
      created_locally, state, accepted_at, updated_at
    ) VALUES (?, ?, 1, 'attendance.session.open', ?, ?, ?, ?, ?, ?, NULL,
              ?, ?, 1, 'opened_on_relay', ?, ?)
  `).run(
    openOperationId,
    teacher.institution_id,
    teacher.actor_profile_id,
    operation.class_id,
    operation.period_id,
    schedule.timetable.id,
    schedule.timetable.subject_id,
    session.id,
    openFingerprint,
    canonicalJson(openPayload),
    requestedStartAt,
    requestedStartAt,
  );
  db.prepare(`
    INSERT INTO sync_outbox(
      operation_id, institution_id, device_id, actor_profile_id,
      entity_type, entity_id, action, base_server_version,
      payload_json, occurred_at, protocol_version, payload_fingerprint
    ) VALUES (?, ?, ?, ?, 'teacher_session', ?, 'upsert', 0, ?, ?, 1, ?)
  `).run(
    openOperationId,
    teacher.institution_id,
    `teacher:${teacher.actor_profile_id}`,
    teacher.actor_profile_id,
    session.id,
    canonicalJson({
      operation_type: "teacher_session.open",
      ...sessionPayload(session),
      open_operation_id: openOperationId,
      timetable_id: schedule.timetable.id,
    }),
    requestedStartAt,
    openFingerprint,
  );
  writeDirtySession(db, session);
  return { session, created: true };
}

export function transitionTeacherAttendanceSession(
  db: RelayDatabase,
  raw: unknown,
  teacher: AuthenticatedRelayTeacher,
  now = new Date(),
  options: { faultInjector?: (stage: FaultStage) => void } = {},
) {
  if (relayActorKind(teacher) === "class_device") {
    throw new TeacherSessionLifecycleError(403, "class_device_transition_not_supported");
  }
  const requestedStartAt = now.toISOString();
  const operation = parseTransition(raw);
  const operationFingerprint = fingerprint({
    ...operation,
    institution_id: teacher.institution_id,
    teacher_profile_id: teacher.actor_profile_id,
  });
  const existing = transitionReceipt(db, teacher.institution_id, operation.operation_id);
  if (existing) {
    if (
      existing.requesting_teacher_profile_id !== teacher.actor_profile_id ||
      existing.class_id !== operation.class_id ||
      existing.period_id !== operation.period_id ||
      existing.payload_fingerprint !== operationFingerprint
    ) {
      throw new TeacherSessionLifecycleError(409, "operation_id_reused_with_different_payload");
    }
    return transitionResult(db, existing, teacher, operation.operation_id, true, now);
  }

  return db.transaction(() => {
    const raced = transitionReceipt(db, teacher.institution_id, operation.operation_id);
    if (raced) {
      if (raced.payload_fingerprint !== operationFingerprint) {
        throw new TeacherSessionLifecycleError(409, "operation_id_reused_with_different_payload");
      }
      return transitionResult(db, raced, teacher, operation.operation_id, true, now);
    }
    maintenanceInside(db, now);
    let schedule: TeacherScheduledSlot;
    try {
      schedule = resolveTeacherScheduledSlot(db, {
        teacher,
        classId: operation.class_id,
        periodId: operation.period_id,
        now,
      });
    } catch (error) {
      if (error instanceof TeacherSessionRuleError) {
        throw new TeacherSessionLifecycleError(error.status, error.code, error.details);
      }
      throw error;
    }

    const previous = db.prepare(`
      SELECT id
      FROM teacher_sessions
      WHERE institution_id = ? AND (class_id = ? OR teacher_id = ?) AND session_date = ?
        AND period_id <> ? AND deleted_at IS NULL AND ended_at IS NULL
        AND session_state = 'finalizing'
        AND scheduled_end_at <= ? AND grace_expires_at > ?
      ORDER BY scheduled_end_at DESC, id
      LIMIT 1
    `).get(
      teacher.institution_id,
      operation.class_id,
      teacher.actor_profile_id,
      schedule.sessionDate,
      operation.period_id,
      requestedStartAt,
      requestedStartAt,
    ) as { id: string } | undefined;
    if (!previous) {
      throw new TeacherSessionLifecycleError(409, "transition_not_required");
    }
    const previousSession = teacherSessionLifecycleRow(db, teacher.institution_id, previous.id);
    if (!previousSession) throw new TeacherSessionLifecycleError(409, "previous_session_missing");
    if (previousSession.teacher_id === teacher.actor_profile_id) {
      throw new TeacherSessionLifecycleError(
        409,
        "previous_session_owner_must_confirm",
        { previous_session: safePreviousSummary(
          db,
          teacher.institution_id,
          previousSession.id,
          teacher.actor_profile_id,
        ) },
      );
    }

    const closeOperationId = derivedOperationId("close", teacher.institution_id, operation.operation_id);
    const openOperationId = derivedOperationId("open", teacher.institution_id, operation.operation_id);
    const closeFingerprint = fingerprint({
      protocol_version: PROTOCOL_VERSION,
      operation_id: closeOperationId,
      operation_type: CLOSE_OPERATION_TYPE,
      institution_id: teacher.institution_id,
      session_id: previousSession.id,
      requested_by_profile_id: teacher.actor_profile_id,
      closure_source: "next_slot_takeover",
    });
    closeSessionInternal(db, {
      session: previousSession,
      operationId: closeOperationId,
      fingerprint: closeFingerprint,
      requestedByProfileId: teacher.actor_profile_id,
      source: "next_slot_takeover",
      confirmation: "unconfirmed",
      requestedAt: requestedStartAt,
      now,
    });
    options.faultInjector?.("after_previous_close");

    const next = createTransitionSession(
      db,
      operation,
      teacher,
      schedule,
      requestedStartAt,
      openOperationId,
    );
    options.faultInjector?.("after_new_session");
    if (next.created) {
      db.prepare(`
        INSERT INTO sync_outbox_dependencies(
          institution_id, operation_id, depends_on_operation_id, created_at
        ) VALUES (?, ?, ?, ?)
      `).run(
        teacher.institution_id,
        openOperationId,
        closeOperationId,
        requestedStartAt,
      );
    }
    options.faultInjector?.("after_new_open_outbox");

    const transitionPayload = {
      protocol_version: PROTOCOL_VERSION,
      operation_type: TRANSITION_OPERATION_TYPE,
      institution_id: teacher.institution_id,
      requesting_teacher_profile_id: teacher.actor_profile_id,
      previous_session_id: previousSession.id,
      new_session_id: next.session.id,
      class_id: operation.class_id,
      period_id: operation.period_id,
      requested_start_at: requestedStartAt,
      close_operation_id: closeOperationId,
      open_operation_id: openOperationId,
    };
    db.prepare(`
      INSERT INTO teacher_session_transition_operations(
        operation_id, institution_id, protocol_version, operation_type,
        requesting_teacher_profile_id, previous_session_id, new_session_id,
        class_id, period_id, requested_start_at, close_operation_id,
        open_operation_id, payload_fingerprint, payload_json, state,
        accepted_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                'transitioned_on_relay', ?, ?)
    `).run(
      operation.operation_id,
      teacher.institution_id,
      TRANSITION_OPERATION_TYPE,
      teacher.actor_profile_id,
      previousSession.id,
      next.session.id,
      operation.class_id,
      operation.period_id,
      requestedStartAt,
      closeOperationId,
      openOperationId,
      operationFingerprint,
      canonicalJson(transitionPayload),
      requestedStartAt,
      requestedStartAt,
    );
    options.faultInjector?.("after_transition_receipt");
    db.prepare(`
      INSERT INTO audit_log(
        institution_id, actor_profile_id, event_type, entity_type,
        entity_id, details_json, occurred_at
      ) VALUES (?, ?, 'attendance.session_transitioned', 'teacher_session', ?, ?, ?)
    `).run(
      teacher.institution_id,
      teacher.actor_profile_id,
      next.session.id,
      canonicalJson({
        operation_id: operation.operation_id,
        previous_session_id: previousSession.id,
        new_session_id: next.session.id,
        requested_start_at: requestedStartAt,
        closure_confirmation: "unconfirmed",
      }),
      requestedStartAt,
    );
    const receipt = transitionReceipt(db, teacher.institution_id, operation.operation_id);
    if (!receipt) throw new TeacherSessionLifecycleError(500, "transition_receipt_missing");
    return transitionResult(db, receipt, teacher, operation.operation_id, false, now);
  })();
}

export function activePreviousSessionConflict(
  db: RelayDatabase,
  input: {
    teacher: AuthenticatedRelayTeacher;
    classId: string;
    targetPeriodId: string;
    sessionDate: string;
    scheduledStartAt: string;
  },
) {
  const row = db.prepare(`
    SELECT id, teacher_id
    FROM teacher_sessions
    WHERE institution_id = ? AND session_date = ? AND period_id <> ?
      AND deleted_at IS NULL AND ended_at IS NULL
      AND session_state IN ('open', 'finalizing')
      AND scheduled_end_at <= ?
      AND (class_id = ? OR teacher_id = ?)
    ORDER BY scheduled_end_at DESC, id
    LIMIT 1
  `).get(
    input.teacher.institution_id,
    input.sessionDate,
    input.targetPeriodId,
    input.scheduledStartAt,
    input.classId,
    input.teacher.actor_profile_id,
  ) as { id: string; teacher_id: string } | undefined;
  if (!row) return null;
  return {
    code: row.teacher_id === input.teacher.actor_profile_id
      ? "previous_session_owner_must_confirm"
      : "previous_session_transition_required",
    details: {
      previous_session: safePreviousSummary(
        db,
        input.teacher.institution_id,
        row.id,
        input.teacher.actor_profile_id,
      ),
    },
  };
}

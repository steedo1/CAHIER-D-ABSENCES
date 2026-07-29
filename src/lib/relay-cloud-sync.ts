import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const RELAY_SYNC_PROTOCOL_VERSION = 1 as const;
export const RELAY_SYNC_MAX_OPERATIONS = 100;
const RECEIPT_PROCESSING_STALE_MS = 5 * 60 * 1000;

export type RelaySyncOperation = {
  protocol_version: 1;
  operation_id: string;
  actor_profile_id: string | null;
  origin_device_id: string;
  entity_type: string;
  entity_id: string;
  action: "upsert" | "delete";
  base_server_version: number;
  occurred_at: string;
  payload_fingerprint: string;
  payload: Record<string, unknown> | null;
};

export type RelaySyncBatch = {
  protocol_version: 1;
  institution_id: string;
  device_id: string;
  sent_at: string;
  operations: RelaySyncOperation[];
};

export type RelaySyncAcknowledgement = {
  operation_id: string;
  status: "acknowledged" | "retryable" | "blocked" | "conflict";
  http_status: number;
  error: string | null;
  cloud_entity_id: string | null;
  applied_now: boolean;
  attendance_changed: boolean;
};

type ReceiptRow = {
  payload_fingerprint: string;
  entity_type: string;
  state: "processing" | "retryable" | "acknowledged" | "blocked" | "conflict";
  error_code: string | null;
  cloud_entity_id: string | null;
  updated_at: string;
};

type ApplyOperationResult = {
  cloudEntityId: string;
  attendanceChanged: boolean;
};

class RelayOperationError extends Error {
  readonly outcome: "retryable" | "blocked" | "conflict";
  readonly status: number;
  readonly code: string;

  constructor(
    outcome: "retryable" | "blocked" | "conflict",
    status: number,
    code: string,
  ) {
    super(code);
    this.outcome = outcome;
    this.status = status;
    this.code = code;
  }
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 512) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label}_required`);
  if (normalized.length > max) throw new Error(`${label}_too_long`);
  return normalized;
}

function nullableText(value: unknown, max = 512) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  if (normalized.length > max) throw new Error("text_too_long");
  return normalized;
}

function iso(value: unknown, label: string) {
  const normalized = text(value, label, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label}_invalid`);
  return new Date(normalized).toISOString();
}

function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label}_invalid`);
  }
  return Number(value);
}

function fingerprint(value: unknown) {
  const normalized = text(value, "payload_fingerprint", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("payload_fingerprint_invalid");
  return normalized;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value));
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) output[key] = sortCanonicalValue(input[key]);
  return output;
}

function operationFingerprint(operation: Omit<RelaySyncOperation, "payload_fingerprint">) {
  return createHash("sha256").update(canonicalJson(operation)).digest("hex");
}

export function parseRelaySyncBatch(value: unknown): RelaySyncBatch {
  const row = object(value, "batch");
  if (row.protocol_version !== RELAY_SYNC_PROTOCOL_VERSION) {
    throw new Error("protocol_version_not_supported");
  }
  const operations = Array.isArray(row.operations) ? row.operations : null;
  if (!operations || operations.length < 1 || operations.length > RELAY_SYNC_MAX_OPERATIONS) {
    throw new Error("operations_count_invalid");
  }
  return {
    protocol_version: RELAY_SYNC_PROTOCOL_VERSION,
    institution_id: text(row.institution_id, "institution_id", 128),
    device_id: text(row.device_id, "device_id", 128),
    sent_at: iso(row.sent_at, "sent_at"),
    operations: operations.map((candidate, index) => {
      const operation = object(candidate, `operations_${index}`);
      if (operation.protocol_version !== RELAY_SYNC_PROTOCOL_VERSION) {
        throw new Error("operation_protocol_version_not_supported");
      }
      if (operation.action !== "upsert" && operation.action !== "delete") {
        throw new Error("operation_action_invalid");
      }
      const payload = operation.action === "delete"
        ? null
        : object(operation.payload, `operations_${index}_payload`);
      const parsedOperation = {
        protocol_version: RELAY_SYNC_PROTOCOL_VERSION,
        operation_id: text(operation.operation_id, "operation_id", 160),
        actor_profile_id: nullableText(operation.actor_profile_id, 128),
        origin_device_id: text(operation.origin_device_id, "origin_device_id", 256),
        entity_type: text(operation.entity_type, "entity_type", 80),
        entity_id: text(operation.entity_id, "entity_id", 160),
        action: operation.action,
        base_server_version: nonNegativeInteger(
          operation.base_server_version,
          "base_server_version",
        ),
        occurred_at: iso(operation.occurred_at, "occurred_at"),
        payload,
      } satisfies Omit<RelaySyncOperation, "payload_fingerprint">;
      const suppliedFingerprint = fingerprint(operation.payload_fingerprint);
      if (operationFingerprint(parsedOperation) !== suppliedFingerprint) {
        throw new Error("payload_fingerprint_mismatch");
      }
      return { ...parsedOperation, payload_fingerprint: suppliedFingerprint };
    }),
  };
}

function receiptAck(operationId: string, receipt: ReceiptRow): RelaySyncAcknowledgement {
  const status = receipt.state === "acknowledged"
    ? "acknowledged"
    : receipt.state === "conflict"
      ? "conflict"
      : receipt.state === "blocked"
        ? "blocked"
        : "retryable";
  return {
    operation_id: operationId,
    status,
    http_status: status === "acknowledged"
      ? 200
      : status === "retryable"
        ? 503
        : status === "blocked"
          ? 422
          : 409,
    error: receipt.error_code,
    cloud_entity_id: receipt.cloud_entity_id,
    applied_now: false,
    attendance_changed: false,
  };
}

async function loadReceipt(
  service: SupabaseClient,
  institutionId: string,
  operationId: string,
) {
  const { data, error } = await service
    .from("relay_sync_operation_receipts")
    .select("payload_fingerprint,entity_type,state,error_code,cloud_entity_id,updated_at")
    .eq("institution_id", institutionId)
    .eq("operation_id", operationId)
    .maybeSingle();
  if (error) throw new RelayOperationError("retryable", 503, "receipt_lookup_failed");
  return data as ReceiptRow | null;
}

async function reserveReceipt(
  service: SupabaseClient,
  input: {
    institutionId: string;
    deviceId: string;
    operation: RelaySyncOperation;
    nowIso: string;
  },
) {
  const { error } = await service.from("relay_sync_operation_receipts").insert({
    institution_id: input.institutionId,
    operation_id: input.operation.operation_id,
    device_id: input.deviceId,
    payload_fingerprint: input.operation.payload_fingerprint,
    entity_type: input.operation.entity_type,
    entity_id: input.operation.entity_id,
    state: "processing",
    received_at: input.nowIso,
    updated_at: input.nowIso,
  });
  if (!error) return true;
  if ((error as any)?.code === "23505") return false;
  throw new RelayOperationError("retryable", 503, "receipt_reservation_failed");
}

async function claimExistingReceipt(
  service: SupabaseClient,
  input: {
    institutionId: string;
    operationId: string;
    receipt: ReceiptRow;
    nowIso: string;
    reopenBlockedError?: string | null;
  },
) {
  let query = service
    .from("relay_sync_operation_receipts")
    .update({
      state: "processing",
      error_code: null,
      processed_at: null,
      updated_at: input.nowIso,
    })
    .eq("institution_id", input.institutionId)
    .eq("operation_id", input.operationId);

  if (input.receipt.state === "retryable") {
    query = query.eq("state", "retryable");
  } else if (
    input.receipt.state === "blocked" &&
    input.reopenBlockedError &&
    input.receipt.error_code === input.reopenBlockedError
  ) {
    query = query
      .eq("state", "blocked")
      .eq("error_code", input.reopenBlockedError);
  } else if (input.receipt.state === "processing") {
    const staleBefore = new Date(
      Date.parse(input.nowIso) - RECEIPT_PROCESSING_STALE_MS,
    ).toISOString();
    query = query.eq("state", "processing").lte("updated_at", staleBefore);
  } else {
    return false;
  }

  const { data, error } = await query.select("operation_id").maybeSingle();
  if (error) throw new RelayOperationError("retryable", 503, "receipt_claim_failed");
  return Boolean(data);
}

async function storeReceiptOutcome(
  service: SupabaseClient,
  input: {
    institutionId: string;
    operationId: string;
    status: RelaySyncAcknowledgement["status"];
    error: string | null;
    cloudEntityId: string | null;
    nowIso: string;
  },
) {
  const state = input.status;
  const { error } = await service
    .from("relay_sync_operation_receipts")
    .update({
      state,
      error_code: input.error,
      cloud_entity_id: input.cloudEntityId,
      response_json: {
        status: input.status,
        error: input.error,
        cloud_entity_id: input.cloudEntityId,
      },
      processed_at: input.status === "retryable" ? null : input.nowIso,
      updated_at: input.nowIso,
    })
    .eq("institution_id", input.institutionId)
    .eq("operation_id", input.operationId);
  if (error) throw new RelayOperationError("retryable", 503, "receipt_update_failed");
}

function durationMinutes(start: unknown, end: unknown) {
  const startMs = Date.parse(String(start || ""));
  const endMs = Date.parse(String(end || ""));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 60;
  return Math.max(1, Math.round((endMs - startMs) / 60_000));
}

type TeacherTimetableRow = {
  id: string;
  institution_id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  period_id: string;
  weekday: number;
};

function isoWeekdayFromSessionDate(value: unknown) {
  const sessionDate = text(value, "session_date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    throw new RelayOperationError("blocked", 422, "session_date_invalid");
  }
  const parsed = new Date(`${sessionDate}T12:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== sessionDate
  ) {
    throw new RelayOperationError("blocked", 422, "session_date_invalid");
  }
  const weekday = parsed.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function timetableMatchesPayload(
  timetable: TeacherTimetableRow,
  input: {
    institutionId: string;
    classId: string;
    subjectId: string;
    teacherId: string;
    periodId: string;
    weekday: number;
  },
) {
  return (
    String(timetable.institution_id) === input.institutionId &&
    String(timetable.class_id) === input.classId &&
    String(timetable.subject_id) === input.subjectId &&
    String(timetable.teacher_id) === input.teacherId &&
    String(timetable.period_id) === input.periodId &&
    Number(timetable.weekday) === input.weekday
  );
}

async function resolveTeacherTimetable(
  service: SupabaseClient,
  input: {
    institutionId: string;
    timetableId: string;
    classId: string;
    subjectId: string;
    teacherId: string;
    periodId: string;
    weekday: number;
  },
) {
  const selectColumns = "id,institution_id,class_id,subject_id,teacher_id,period_id,weekday";
  const { data: exact, error: exactError } = await service
    .from("teacher_timetables")
    .select(selectColumns)
    .eq("id", input.timetableId)
    .eq("institution_id", input.institutionId)
    .maybeSingle();
  if (exactError) {
    throw new RelayOperationError("retryable", 503, "timetable_lookup_failed");
  }
  if (exact) {
    const timetable = exact as TeacherTimetableRow;
    if (!timetableMatchesPayload(timetable, input)) {
      throw new RelayOperationError("conflict", 409, "timetable_payload_mismatch");
    }
    return timetable;
  }

  const { data: candidates, error: candidatesError } = await service
    .from("teacher_timetables")
    .select(selectColumns)
    .eq("institution_id", input.institutionId)
    .eq("class_id", input.classId)
    .eq("subject_id", input.subjectId)
    .eq("teacher_id", input.teacherId)
    .eq("period_id", input.periodId)
    .eq("weekday", input.weekday)
    .limit(2);
  if (candidatesError) {
    throw new RelayOperationError("retryable", 503, "timetable_semantic_lookup_failed");
  }
  const compatible = (candidates || []) as TeacherTimetableRow[];
  if (compatible.length === 0) {
    throw new RelayOperationError("blocked", 422, "timetable_not_found");
  }
  if (compatible.length > 1) {
    throw new RelayOperationError("conflict", 409, "timetable_semantic_ambiguous");
  }
  return compatible[0]!;
}

function reopenableBlockedReceipt(
  receipt: ReceiptRow | null,
  operation: RelaySyncOperation,
) {
  if (
    receipt?.state !== "blocked" ||
    receipt.error_code !== "timetable_not_found" ||
    receipt.entity_type !== "teacher_session" ||
    operation.entity_type !== "teacher_session"
  ) {
    return null;
  }
  const payload = operation.payload || {};
  return String(payload.operation_type || "").trim() === "teacher_session.open"
    ? "timetable_not_found"
    : null;
}

async function applyTeacherSessionOpen(
  service: SupabaseClient,
  institutionId: string,
  operation: RelaySyncOperation,
) {
  if (operation.action !== "upsert") {
    throw new RelayOperationError("blocked", 422, "teacher_session_open_action_invalid");
  }
  const payload = operation.payload || {};
  if (text(payload.operation_type, "operation_type", 80) !== "teacher_session.open") {
    throw new RelayOperationError("blocked", 422, "teacher_session_operation_type_invalid");
  }
  const classId = text(payload.class_id, "class_id", 128);
  const subjectId = text(payload.subject_id, "subject_id", 128);
  const teacherId = text(payload.teacher_id, "teacher_id", 128);
  if (operation.actor_profile_id && operation.actor_profile_id !== teacherId) {
    throw new RelayOperationError("conflict", 409, "teacher_session_actor_mismatch");
  }
  const timetableId = text(payload.timetable_id, "timetable_id", 128);
  const periodId = text(payload.period_id, "period_id", 128);
  const weekday = isoWeekdayFromSessionDate(payload.session_date);
  const startedAt = iso(payload.started_at, "started_at");
  const actualCallAt = iso(payload.actual_call_at || payload.requested_start_at || operation.occurred_at, "actual_call_at");

  await resolveTeacherTimetable(service, {
    institutionId,
    timetableId,
    classId,
    subjectId,
    teacherId,
    periodId,
    weekday,
  });

  const { data: existing, error: existingError } = await service
    .from("teacher_sessions")
    .select("id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,ended_at")
    .eq("id", operation.entity_id)
    .maybeSingle();
  if (existingError) throw new RelayOperationError("retryable", 503, "session_lookup_failed");
  if (existing) {
    if (
      String((existing as any).institution_id) !== institutionId ||
      String((existing as any).class_id) !== classId ||
      String((existing as any).subject_id) !== subjectId ||
      String((existing as any).teacher_id) !== teacherId ||
      Math.abs(Date.parse(String((existing as any).started_at || "")) - Date.parse(startedAt)) > 60_000
    ) {
      throw new RelayOperationError("conflict", 409, "session_id_already_used");
    }
    return operation.entity_id;
  }

  const { error: insertError } = await service.from("teacher_sessions").insert({
    id: operation.entity_id,
    institution_id: institutionId,
    class_id: classId,
    subject_id: subjectId,
    teacher_id: teacherId,
    created_by: teacherId,
    started_at: startedAt,
    actual_call_at: actualCallAt,
    expected_minutes: durationMinutes(payload.scheduled_start_at, payload.scheduled_end_at),
    presence_verified: true,
    presence_method: "local_relay",
    presence_checked_at: actualCallAt,
  });
  if (insertError) {
    if ((insertError as any)?.code === "23505") {
      const { data: racedById, error: racedByIdError } = await service
        .from("teacher_sessions")
        .select("id,institution_id,class_id,subject_id,teacher_id,started_at")
        .eq("id", operation.entity_id)
        .maybeSingle();
      if (racedByIdError) {
        throw new RelayOperationError("retryable", 503, "session_race_lookup_failed");
      }
      if (racedById) {
        if (
          String((racedById as any).institution_id) === institutionId &&
          String((racedById as any).class_id) === classId &&
          String((racedById as any).subject_id) === subjectId &&
          String((racedById as any).teacher_id) === teacherId &&
          Math.abs(Date.parse(String((racedById as any).started_at || "")) - Date.parse(startedAt)) <= 60_000
        ) {
          return operation.entity_id;
        }
        throw new RelayOperationError("conflict", 409, "session_id_already_used");
      }

      const { data: sameSlot, error: sameSlotError } = await service
        .from("teacher_sessions")
        .select("id,class_id,subject_id,teacher_id,started_at")
        .eq("institution_id", institutionId)
        .eq("teacher_id", teacherId)
        .eq("started_at", startedAt)
        .limit(2);
      if (sameSlotError) {
        throw new RelayOperationError("retryable", 503, "session_slot_lookup_failed");
      }
      const compatible = (sameSlot || []).find((row: any) =>
        String(row.class_id) === classId && String(row.subject_id) === subjectId
      );
      if (compatible?.id) return String(compatible.id);
      throw new RelayOperationError("conflict", 409, "session_slot_already_used");
    }
    if ((insertError as any)?.code === "23503") {
      throw new RelayOperationError("blocked", 422, "session_reference_invalid");
    }
    throw new RelayOperationError("retryable", 503, "session_insert_failed");
  }
  return operation.entity_id;
}

async function applyTeacherSessionClose(
  service: SupabaseClient,
  institutionId: string,
  operation: RelaySyncOperation,
) {
  if (operation.action !== "upsert") {
    throw new RelayOperationError("blocked", 422, "teacher_session_close_action_invalid");
  }
  const payload = operation.payload || {};
  const operationType = String(payload.sync_operation_type || payload.operation_type || "").trim();
  if (!operationType.includes("session.close")) {
    throw new RelayOperationError("blocked", 422, "teacher_session_close_type_invalid");
  }
  const closedAt = iso(payload.closed_at || operation.occurred_at, "closed_at");
  const { data: session, error: sessionError } = await service
    .from("teacher_sessions")
    .select("id,institution_id,ended_at")
    .eq("id", operation.entity_id)
    .maybeSingle();
  if (sessionError) throw new RelayOperationError("retryable", 503, "session_lookup_failed");
  if (!session || String((session as any).institution_id) !== institutionId) {
    throw new RelayOperationError("blocked", 404, "session_not_found");
  }
  const existingEnd = (session as any).ended_at ? Date.parse(String((session as any).ended_at)) : NaN;
  if (Number.isFinite(existingEnd)) {
    if (Math.abs(existingEnd - Date.parse(closedAt)) > 60_000) {
      throw new RelayOperationError("conflict", 409, "session_already_closed_differently");
    }
    return operation.entity_id;
  }
  const { error: updateError } = await service
    .from("teacher_sessions")
    .update({ ended_at: closedAt, status: "submitted" })
    .eq("id", operation.entity_id)
    .eq("institution_id", institutionId)
    .is("ended_at", null);
  if (updateError) throw new RelayOperationError("retryable", 503, "session_close_failed");
  return operation.entity_id;
}

async function applyAttendanceCall(
  service: SupabaseClient,
  institutionId: string,
  operation: RelaySyncOperation,
): Promise<ApplyOperationResult> {
  if (operation.action !== "upsert") {
    throw new RelayOperationError("blocked", 422, "attendance_action_invalid");
  }
  const payload = operation.payload || {};
  if (text(payload.operation_type, "operation_type", 80) !== "attendance.call.submit") {
    throw new RelayOperationError("blocked", 422, "attendance_operation_type_invalid");
  }
  const sessionId = text(payload.session_id || operation.entity_id, "session_id", 128);
  const classId = text(payload.class_id, "class_id", 128);
  const teacherId = text(payload.teacher_profile_id, "teacher_profile_id", 128);
  if (operation.actor_profile_id && operation.actor_profile_id !== teacherId) {
    throw new RelayOperationError("conflict", 409, "attendance_actor_mismatch");
  }
  const marks = Array.isArray(payload.marks) ? payload.marks : [];
  if (!marks.length || marks.length > 500) {
    throw new RelayOperationError("blocked", 422, "attendance_marks_count_invalid");
  }

  const { data: session, error: sessionError } = await service
    .from("teacher_sessions")
    .select("id,institution_id,class_id,teacher_id,expected_minutes,actual_call_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw new RelayOperationError("retryable", 503, "session_lookup_failed");
  if (!session || String((session as any).institution_id) !== institutionId) {
    throw new RelayOperationError("blocked", 404, "session_not_found");
  }
  if (
    String((session as any).class_id) !== classId ||
    String((session as any).teacher_id) !== teacherId
  ) {
    throw new RelayOperationError("conflict", 409, "attendance_session_mismatch");
  }

  const normalized = new Map<string, { status: string; late: number; comment: string | null }>();
  const allowedAttendanceStatuses = new Set(["present", "absent", "late"]);
  for (const candidate of marks) {
    const mark = object(candidate, "attendance_mark");
    const studentId = text(mark.student_id, "student_id", 128);
    const status = String(mark.status || "").trim();
    if (!allowedAttendanceStatuses.has(status)) {
      throw new RelayOperationError("blocked", 422, "attendance_status_invalid");
    }
    const rawLate = Number(mark.late_minutes || 0);
    if (!Number.isFinite(rawLate) || rawLate < 0 || rawLate > 24 * 60) {
      throw new RelayOperationError("blocked", 422, "attendance_late_minutes_invalid");
    }
    normalized.set(studentId, {
      status,
      late: status === "late" ? Math.round(rawLate) : 0,
      comment: nullableText(mark.comment, 500),
    });
  }
  const studentIds = Array.from(normalized.keys());
  const { data: enrollments, error: enrollmentError } = await service
    .from("class_enrollments")
    .select("student_id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .in("student_id", studentIds);
  if (enrollmentError) throw new RelayOperationError("retryable", 503, "enrollment_lookup_failed");
  const enrolled = new Set((enrollments || []).map((row: any) => String(row.student_id)));
  if (studentIds.some((id) => !enrolled.has(id))) {
    throw new RelayOperationError("blocked", 422, "student_not_enrolled_in_class");
  }

  const { data: existingRows, error: existingError } = await service
    .from("attendance_marks")
    .select("student_id,status,minutes_late,hours_absent,reason")
    .eq("session_id", sessionId)
    .in("student_id", studentIds);
  if (existingError) throw new RelayOperationError("retryable", 503, "attendance_existing_lookup_failed");
  const existingByStudent = new Map(
    (existingRows || []).map((row: any) => [String(row.student_id), row]),
  );

  const expectedMinutes = Math.max(1, Math.round(Number((session as any).expected_minutes || 60)));
  const absentHours = Math.round((expectedMinutes / 60) * 100) / 100;
  const toDelete: string[] = [];
  const toUpsert: Array<Record<string, unknown>> = [];
  for (const [studentId, mark] of normalized) {
    const existing = existingByStudent.get(studentId) as any;
    if (mark.status === "present") {
      if (existing) toDelete.push(studentId);
      continue;
    }
    const desiredLate = mark.status === "late" ? mark.late : 0;
    const desiredAbsentHours = mark.status === "absent" ? absentHours : 0;
    const unchanged = existing &&
      String(existing.status || "") === mark.status &&
      Number(existing.minutes_late || 0) === desiredLate &&
      Math.abs(Number(existing.hours_absent || 0) - desiredAbsentHours) < 0.001 &&
      nullableText(existing.reason, 500) === mark.comment;
    if (unchanged) continue;
    toUpsert.push({
      session_id: sessionId,
      student_id: studentId,
      status: mark.status,
      minutes_late: desiredLate,
      hours_absent: desiredAbsentHours,
      reason: mark.comment,
    });
  }
  if (toUpsert.length) {
    const { error } = await service
      .from("attendance_marks")
      .upsert(toUpsert, { onConflict: "session_id,student_id" });
    if (error) throw new RelayOperationError("retryable", 503, "attendance_upsert_failed");
  }
  if (toDelete.length) {
    const { error } = await service
      .from("attendance_marks")
      .delete()
      .eq("session_id", sessionId)
      .in("student_id", toDelete);
    if (error) throw new RelayOperationError("retryable", 503, "attendance_delete_failed");
  }
  if (!(session as any).actual_call_at) {
    const { error } = await service
      .from("teacher_sessions")
      .update({ actual_call_at: iso(payload.accepted_at || operation.occurred_at, "accepted_at") })
      .eq("id", sessionId)
      .is("actual_call_at", null);
    if (error) throw new RelayOperationError("retryable", 503, "session_call_time_update_failed");
  }
  return {
    cloudEntityId: sessionId,
    attendanceChanged: toUpsert.length > 0 || toDelete.length > 0,
  };
}

async function applyOperation(
  service: SupabaseClient,
  institutionId: string,
  operation: RelaySyncOperation,
): Promise<ApplyOperationResult> {
  if (operation.entity_type === "attendance_call") {
    return applyAttendanceCall(service, institutionId, operation);
  }
  if (operation.entity_type === "teacher_session") {
    const payload = operation.payload || {};
    const kind = String(payload.sync_operation_type || payload.operation_type || "").trim();
    if (kind === "teacher_session.open") {
      return {
        cloudEntityId: await applyTeacherSessionOpen(service, institutionId, operation),
        attendanceChanged: false,
      };
    }
    if (kind.includes("session.close")) {
      return {
        cloudEntityId: await applyTeacherSessionClose(service, institutionId, operation),
        attendanceChanged: false,
      };
    }
    throw new RelayOperationError("blocked", 422, "teacher_session_operation_unsupported");
  }
  throw new RelayOperationError("blocked", 422, "entity_type_not_supported_by_relay_push");
}

export async function processRelaySyncOperation(
  service: SupabaseClient,
  input: {
    institutionId: string;
    deviceId: string;
    operation: RelaySyncOperation;
    now?: Date;
  },
): Promise<RelaySyncAcknowledgement> {
  const nowIso = (input.now || new Date()).toISOString();
  try {
    let receipt = await loadReceipt(service, input.institutionId, input.operation.operation_id);
    if (receipt && receipt.payload_fingerprint !== input.operation.payload_fingerprint) {
      return {
        operation_id: input.operation.operation_id,
        status: "conflict",
        http_status: 409,
        error: "operation_id_reused_with_different_payload",
        cloud_entity_id: receipt.cloud_entity_id,
        applied_now: false,
        attendance_changed: false,
      };
    }
    const reopenBlockedError = reopenableBlockedReceipt(receipt, input.operation);
    if (
      receipt &&
      ["acknowledged", "blocked", "conflict"].includes(receipt.state) &&
      !reopenBlockedError
    ) {
      return receiptAck(input.operation.operation_id, receipt);
    }

    let ownsProcessing = false;
    if (receipt) {
      ownsProcessing = await claimExistingReceipt(service, {
        institutionId: input.institutionId,
        operationId: input.operation.operation_id,
        receipt,
        nowIso,
        reopenBlockedError,
      });
    } else {
      ownsProcessing = await reserveReceipt(service, {
        institutionId: input.institutionId,
        deviceId: input.deviceId,
        operation: input.operation,
        nowIso,
      });
      if (!ownsProcessing) {
        receipt = await loadReceipt(service, input.institutionId, input.operation.operation_id);
        if (!receipt) {
          throw new RelayOperationError("retryable", 503, "receipt_race_lookup_failed");
        }
        if (receipt.payload_fingerprint !== input.operation.payload_fingerprint) {
          return {
            operation_id: input.operation.operation_id,
            status: "conflict",
            http_status: 409,
            error: "operation_id_reused_with_different_payload",
            cloud_entity_id: receipt.cloud_entity_id,
            applied_now: false,
            attendance_changed: false,
          };
        }
        const racedReopenBlockedError = reopenableBlockedReceipt(receipt, input.operation);
        if (
          ["acknowledged", "blocked", "conflict"].includes(receipt.state) &&
          !racedReopenBlockedError
        ) {
          return receiptAck(input.operation.operation_id, receipt);
        }
        ownsProcessing = await claimExistingReceipt(service, {
          institutionId: input.institutionId,
          operationId: input.operation.operation_id,
          receipt,
          nowIso,
          reopenBlockedError: racedReopenBlockedError,
        });
      }
    }

    if (!ownsProcessing) {
      return {
        operation_id: input.operation.operation_id,
        status: "retryable",
        http_status: 503,
        error: "operation_already_processing",
        cloud_entity_id: receipt?.cloud_entity_id || null,
        applied_now: false,
        attendance_changed: false,
      };
    }

    const applied = await applyOperation(service, input.institutionId, input.operation);
    await storeReceiptOutcome(service, {
      institutionId: input.institutionId,
      operationId: input.operation.operation_id,
      status: "acknowledged",
      error: null,
      cloudEntityId: applied.cloudEntityId,
      nowIso,
    });
    return {
      operation_id: input.operation.operation_id,
      status: "acknowledged",
      http_status: 200,
      error: null,
      cloud_entity_id: applied.cloudEntityId,
      applied_now: true,
      attendance_changed: applied.attendanceChanged,
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : "relay_operation_failed";
    const validationFailure = /(_required|_invalid|_too_long|_must_be_object|_not_supported|_count_invalid|_mismatch)$/.test(code);
    const failure = error instanceof RelayOperationError
      ? error
      : validationFailure
        ? new RelayOperationError("blocked", 422, code)
        : new RelayOperationError("retryable", 503, "relay_operation_failed");
    await storeReceiptOutcome(service, {
      institutionId: input.institutionId,
      operationId: input.operation.operation_id,
      status: failure.outcome,
      error: failure.code,
      cloudEntityId: null,
      nowIso,
    }).catch(() => undefined);
    return {
      operation_id: input.operation.operation_id,
      status: failure.outcome,
      http_status: failure.status,
      error: failure.code,
      cloud_entity_id: null,
      applied_now: false,
      attendance_changed: false,
    };
  }
}

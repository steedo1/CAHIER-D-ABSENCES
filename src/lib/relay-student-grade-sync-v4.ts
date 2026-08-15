import type { SupabaseClient } from "@supabase/supabase-js";
import { classDeviceMayAccessClass } from "@/lib/class-device-identity";
import type {
  RelaySyncAcknowledgement,
  RelaySyncOperation,
} from "@/lib/relay-cloud-sync";

const RECEIPT_PROCESSING_STALE_MS = 5 * 60 * 1000;
const MAX_CAPTURE_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_CAPTURE_AGE_MS = 31 * 24 * 60 * 60 * 1000;

type ConflictState = {
  server_version: number;
  action: "upsert" | "delete";
  payload: Record<string, unknown> | null;
};

export type RelayStudentGradeAcknowledgementV4 = RelaySyncAcknowledgement & {
  cloud_server_version?: number | null;
  conflict?: ConflictState | null;
};

type ReceiptRow = {
  payload_fingerprint: string;
  state: "processing" | "retryable" | "acknowledged" | "blocked" | "conflict";
  error_code: string | null;
  cloud_entity_id: string | null;
  response_json: Record<string, unknown> | null;
  updated_at: string;
};

type GradeEvaluation = {
  id: string;
  class_id: string;
  subject_id: string | null;
  relay_subject_id?: string | null;
  scale: number | null;
  grading_period_id: string | null;
  is_published: boolean | null;
  publication_status: string | null;
};

class GradeSyncError extends Error {
  constructor(
    readonly outcome: "retryable" | "blocked" | "conflict",
    readonly status: number,
    readonly code: string,
    readonly conflict: ConflictState | null = null,
  ) {
    super(code);
    this.name = "GradeSyncError";
  }
}

function text(value: unknown, label: string, max = 512) {
  const normalized = String(value ?? "").trim();
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

function validVersion(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function capturedAtDevice(operation: RelaySyncOperation, payload: Record<string, unknown>, now: Date) {
  const supplied = payload.captured_at_device;
  const raw = text(supplied || operation.occurred_at, "captured_at_device", 64);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error("captured_at_device_invalid");
  const captured = new Date(parsed).toISOString();
  if (supplied) {
    const occurred = Date.parse(operation.occurred_at);
    if (!Number.isFinite(occurred) || Math.abs(occurred - parsed) > 1_000) {
      throw new GradeSyncError("blocked", 422, "captured_at_device_mismatch");
    }
  }
  if (parsed > now.getTime() + MAX_CAPTURE_FUTURE_SKEW_MS) {
    throw new GradeSyncError("blocked", 422, "captured_at_device_in_future");
  }
  if (parsed < now.getTime() - MAX_CAPTURE_AGE_MS) {
    throw new GradeSyncError("blocked", 422, "captured_at_device_too_old");
  }
  return captured;
}

async function relaySubjectId(
  service: SupabaseClient,
  institutionId: string,
  rawSubjectId: unknown,
) {
  const subjectId = text(rawSubjectId, "subject_id", 128);
  const { data, error } = await service
    .from("institution_subjects")
    .select("id,subject_id")
    .eq("institution_id", institutionId)
    .or(`id.eq.${subjectId},subject_id.eq.${subjectId}`)
    .limit(2);
  if (error) throw new GradeSyncError("retryable", 503, "grade_subject_scope_lookup_failed");

  const rows = (data || []) as Array<{ id?: unknown; subject_id?: unknown }>;
  const exact = rows.find((row) => String(row.id || "").trim() === subjectId);
  if (exact?.id) return String(exact.id).trim();
  const byBase = rows.filter((row) => String(row.subject_id || "").trim() === subjectId);
  if (byBase.length === 1 && byBase[0]?.id) return String(byBase[0].id).trim();
  if (byBase.length > 1) {
    throw new GradeSyncError("conflict", 409, "grade_subject_scope_ambiguous");
  }
  return subjectId;
}

async function gradeEvaluation(
  service: SupabaseClient,
  institutionId: string,
  evaluationId: string,
): Promise<GradeEvaluation> {
  const { data, error } = await service
    .from("grade_evaluations")
    .select("id,class_id,subject_id,scale,grading_period_id,is_published,publication_status")
    .eq("id", evaluationId)
    .maybeSingle();
  if (error) throw new GradeSyncError("retryable", 503, "grade_evaluation_lookup_failed");
  if (!data) throw new GradeSyncError("blocked", 404, "grade_evaluation_not_found");

  const evaluation = data as GradeEvaluation;
  const classId = text(evaluation.class_id, "class_id", 128);
  const { data: cls, error: classError } = await service
    .from("classes")
    .select("id,institution_id")
    .eq("id", classId)
    .maybeSingle();
  if (classError) throw new GradeSyncError("retryable", 503, "grade_class_lookup_failed");
  if (!cls || String((cls as any).institution_id || "") !== institutionId) {
    throw new GradeSyncError("blocked", 404, "grade_class_not_found");
  }

  return {
    ...evaluation,
    relay_subject_id: await relaySubjectId(service, institutionId, evaluation.subject_id),
  };
}

async function assertActor(
  service: SupabaseClient,
  institutionId: string,
  operation: RelaySyncOperation,
  evaluation: GradeEvaluation,
  actorKind: string,
) {
  const actorId = text(operation.actor_profile_id, "actor_profile_id", 128);
  if (actorKind === "class_device") {
    let allowed = false;
    try {
      allowed = await classDeviceMayAccessClass({
        service,
        userId: actorId,
        classId: String(evaluation.class_id),
      });
    } catch {
      throw new GradeSyncError("retryable", 503, "class_device_scope_lookup_failed");
    }
    if (!allowed) throw new GradeSyncError("blocked", 403, "grade_class_not_allowed");
    return;
  }

  if (actorKind !== "teacher") {
    throw new GradeSyncError("blocked", 422, "grade_actor_kind_invalid");
  }
  const subjectId = text(
    evaluation.relay_subject_id || evaluation.subject_id,
    "subject_id",
    128,
  );
  const { data: role, error: roleError } = await service
    .from("user_roles")
    .select("profile_id")
    .eq("profile_id", actorId)
    .eq("institution_id", institutionId)
    .eq("role", "teacher")
    .maybeSingle();
  if (roleError) throw new GradeSyncError("retryable", 503, "grade_teacher_role_lookup_failed");
  if (!role) throw new GradeSyncError("blocked", 403, "grade_teacher_role_missing");

  const { data: assignment, error: assignmentError } = await service
    .from("class_teachers")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("class_id", evaluation.class_id)
    .eq("subject_id", subjectId)
    .eq("teacher_id", actorId)
    .is("end_date", null)
    .limit(1)
    .maybeSingle();
  if (assignmentError) throw new GradeSyncError("retryable", 503, "grade_assignment_lookup_failed");
  if (!assignment) throw new GradeSyncError("blocked", 403, "grade_assignment_not_allowed");
}

async function assertEditable(service: SupabaseClient, evaluation: GradeEvaluation, now: Date) {
  const status = String(evaluation.publication_status || "draft").trim();
  if (evaluation.is_published === true || status === "published") {
    throw new GradeSyncError("conflict", 409, "grade_evaluation_published");
  }
  if (status === "submitted") {
    throw new GradeSyncError("conflict", 409, "grade_evaluation_submitted");
  }

  const { data: lock, error: lockError } = await service
    .from("grade_evaluation_locks")
    .select("is_locked")
    .eq("evaluation_id", evaluation.id)
    .maybeSingle();
  if (lockError && (lockError as any)?.code !== "42P01") {
    throw new GradeSyncError("retryable", 503, "grade_lock_lookup_failed");
  }
  if ((lock as any)?.is_locked === true) {
    throw new GradeSyncError("conflict", 409, "grade_evaluation_locked");
  }

  const periodId = String(evaluation.grading_period_id || "").trim();
  if (!periodId) return;
  const { data: period, error: periodError } = await service
    .from("grade_periods")
    .select("id,end_date,is_active")
    .eq("id", periodId)
    .maybeSingle();
  if (periodError) throw new GradeSyncError("retryable", 503, "grade_period_lookup_failed");
  if (!period) throw new GradeSyncError("blocked", 422, "grade_period_not_found");
  const endDate = String((period as any).end_date || "").slice(0, 10);
  if (endDate && now.toISOString().slice(0, 10) > endDate) {
    throw new GradeSyncError("conflict", 409, "grading_period_closed");
  }
}

async function assertEnrolled(
  service: SupabaseClient,
  institutionId: string,
  classId: string,
  studentId: string,
) {
  const { data, error } = await service
    .from("class_enrollments")
    .select("student_id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .is("end_date", null)
    .limit(1)
    .maybeSingle();
  if (error) throw new GradeSyncError("retryable", 503, "grade_enrollment_lookup_failed");
  if (!data) throw new GradeSyncError("blocked", 422, "student_not_enrolled_in_class");
}

function actorKindFromOrigin(operation: RelaySyncOperation) {
  const origin = String(operation.origin_device_id || "");
  if (origin.startsWith("class_device:")) return "class_device";
  if (origin.startsWith("teacher:")) return "teacher";
  return "";
}

function conflictState(value: unknown): ConflictState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const version = validVersion(row.server_version);
  const action = row.action;
  if (version === null || (action !== "upsert" && action !== "delete")) return null;
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : null;
  return { server_version: version, action, payload };
}

function receiptAck(operationId: string, receipt: ReceiptRow): RelayStudentGradeAcknowledgementV4 {
  const status = receipt.state === "acknowledged"
    ? "acknowledged"
    : receipt.state === "conflict"
      ? "conflict"
      : receipt.state === "blocked"
        ? "blocked"
        : "retryable";
  const response = receipt.response_json || {};
  const cloudVersion = validVersion(response.cloud_server_version);
  return {
    operation_id: operationId,
    status,
    http_status: status === "acknowledged" ? 200 : status === "retryable" ? 503 : status === "blocked" ? 422 : 409,
    error: receipt.error_code,
    cloud_entity_id: receipt.cloud_entity_id,
    applied_now: false,
    attendance_changed: false,
    ...(cloudVersion !== null ? { cloud_server_version: cloudVersion } : {}),
    ...(status === "conflict" ? { conflict: conflictState(response.conflict) } : {}),
  };
}

async function loadReceipt(
  service: SupabaseClient,
  institutionId: string,
  operationId: string,
) {
  const { data, error } = await service
    .from("relay_sync_operation_receipts")
    .select("payload_fingerprint,state,error_code,cloud_entity_id,response_json,updated_at")
    .eq("institution_id", institutionId)
    .eq("operation_id", operationId)
    .maybeSingle();
  if (error) throw new GradeSyncError("retryable", 503, "receipt_lookup_failed");
  return data as ReceiptRow | null;
}

async function reserveOrClaimReceipt(
  service: SupabaseClient,
  institutionId: string,
  deviceId: string,
  operation: RelaySyncOperation,
  nowIso: string,
): Promise<RelayStudentGradeAcknowledgementV4 | null> {
  let receipt = await loadReceipt(service, institutionId, operation.operation_id);
  if (receipt && receipt.payload_fingerprint !== operation.payload_fingerprint) {
    return {
      operation_id: operation.operation_id,
      status: "conflict",
      http_status: 409,
      error: "operation_id_reused_with_different_payload",
      cloud_entity_id: receipt.cloud_entity_id,
      applied_now: false,
      attendance_changed: false,
    };
  }
  if (receipt && ["acknowledged", "blocked", "conflict"].includes(receipt.state)) {
    return receiptAck(operation.operation_id, receipt);
  }

  if (!receipt) {
    const { error } = await service.from("relay_sync_operation_receipts").insert({
      institution_id: institutionId,
      operation_id: operation.operation_id,
      device_id: deviceId,
      payload_fingerprint: operation.payload_fingerprint,
      entity_type: "student_grade",
      entity_id: operation.entity_id,
      state: "processing",
      received_at: nowIso,
      updated_at: nowIso,
    });
    if (!error) return null;
    if ((error as any)?.code !== "23505") {
      throw new GradeSyncError("retryable", 503, "receipt_reservation_failed");
    }
    receipt = await loadReceipt(service, institutionId, operation.operation_id);
    if (!receipt) throw new GradeSyncError("retryable", 503, "receipt_race_lookup_failed");
    if (receipt.payload_fingerprint !== operation.payload_fingerprint) {
      return {
        operation_id: operation.operation_id,
        status: "conflict",
        http_status: 409,
        error: "operation_id_reused_with_different_payload",
        cloud_entity_id: receipt.cloud_entity_id,
        applied_now: false,
        attendance_changed: false,
      };
    }
    if (["acknowledged", "blocked", "conflict"].includes(receipt.state)) {
      return receiptAck(operation.operation_id, receipt);
    }
  }

  const staleBefore = new Date(Date.parse(nowIso) - RECEIPT_PROCESSING_STALE_MS).toISOString();
  let query = service
    .from("relay_sync_operation_receipts")
    .update({ state: "processing", error_code: null, processed_at: null, updated_at: nowIso })
    .eq("institution_id", institutionId)
    .eq("operation_id", operation.operation_id);
  if (receipt?.state === "retryable") query = query.eq("state", "retryable");
  else query = query.eq("state", "processing").lte("updated_at", staleBefore);
  const { data, error } = await query.select("operation_id").maybeSingle();
  if (error) throw new GradeSyncError("retryable", 503, "receipt_claim_failed");
  if (data) return null;

  return {
    operation_id: operation.operation_id,
    status: "retryable",
    http_status: 503,
    error: "operation_already_processing",
    cloud_entity_id: receipt?.cloud_entity_id || null,
    applied_now: false,
    attendance_changed: false,
  };
}

async function storeOutcome(
  service: SupabaseClient,
  institutionId: string,
  operation: RelaySyncOperation,
  acknowledgement: RelayStudentGradeAcknowledgementV4,
  nowIso: string,
) {
  const { error } = await service
    .from("relay_sync_operation_receipts")
    .update({
      state: acknowledgement.status,
      error_code: acknowledgement.error,
      cloud_entity_id: acknowledgement.cloud_entity_id,
      response_json: {
        status: acknowledgement.status,
        error: acknowledgement.error,
        cloud_entity_id: acknowledgement.cloud_entity_id,
        cloud_server_version: acknowledgement.cloud_server_version ?? null,
        conflict: acknowledgement.conflict ?? null,
      },
      processed_at: acknowledgement.status === "retryable" ? null : nowIso,
      updated_at: nowIso,
    })
    .eq("institution_id", institutionId)
    .eq("operation_id", operation.operation_id);
  if (error) throw new GradeSyncError("retryable", 503, "receipt_update_failed");
}

function rpcFailure(error: unknown) {
  return [
    (error as any)?.code,
    (error as any)?.message,
    (error as any)?.details,
    (error as any)?.hint,
  ].filter(Boolean).join(" ");
}

async function applyVersionedGrade(
  service: SupabaseClient,
  institutionId: string,
  operation: RelaySyncOperation,
  now: Date,
) {
  if (!operation.actor_profile_id) {
    throw new GradeSyncError("blocked", 422, "actor_profile_id_required");
  }

  let evaluationId: string | null = null;
  let studentId: string | null = null;
  let score: number | null = null;
  let comment: string | null = null;

  if (operation.action === "delete") {
    const { data: existing, error } = await service
      .from("student_grades")
      .select("id,evaluation_id,student_id")
      .eq("id", operation.entity_id)
      .maybeSingle();
    if (error) throw new GradeSyncError("retryable", 503, "student_grade_lookup_failed");
    if (existing) {
      evaluationId = text((existing as any).evaluation_id, "evaluation_id", 128);
      studentId = text((existing as any).student_id, "student_id", 128);
      const evaluation = await gradeEvaluation(service, institutionId, evaluationId);
      const actorKind = actorKindFromOrigin(operation);
      await assertActor(service, institutionId, operation, evaluation, actorKind);
      await assertEditable(service, evaluation, now);
      await assertEnrolled(service, institutionId, String(evaluation.class_id), studentId);
    }
  } else if (operation.action === "upsert") {
    const payload = operation.payload || {};
    if (text(payload.operation_type, "operation_type", 80) !== "grades.score.set") {
      throw new GradeSyncError("blocked", 422, "student_grade_operation_type_invalid");
    }
    evaluationId = text(payload.evaluation_id, "evaluation_id", 128);
    studentId = text(payload.student_id, "student_id", 128);
    const actorKind = text(payload.actor_kind, "actor_kind", 32);
    const originActorKind = actorKindFromOrigin(operation);
    if (!originActorKind || actorKind !== originActorKind) {
      throw new GradeSyncError("conflict", 409, "grade_actor_kind_mismatch");
    }
    if (text(payload.institution_id, "institution_id", 128) !== institutionId) {
      throw new GradeSyncError("conflict", 409, "grade_institution_mismatch");
    }

    const evaluation = await gradeEvaluation(service, institutionId, evaluationId);
    if (
      text(payload.class_id, "class_id", 128) !== String(evaluation.class_id) ||
      text(payload.subject_id, "subject_id", 128) !== String(
        evaluation.relay_subject_id || evaluation.subject_id || "",
      )
    ) {
      throw new GradeSyncError("conflict", 409, "student_grade_evaluation_mismatch");
    }
    const payloadPeriodId = String(payload.grading_period_id || "").trim();
    const evaluationPeriodId = String(evaluation.grading_period_id || "").trim();
    if (payloadPeriodId && payloadPeriodId !== evaluationPeriodId) {
      throw new GradeSyncError("conflict", 409, "student_grade_period_mismatch");
    }

    await assertActor(service, institutionId, operation, evaluation, actorKind);
    await assertEditable(service, evaluation, now);
    await assertEnrolled(service, institutionId, String(evaluation.class_id), studentId);
    capturedAtDevice(operation, payload, now);

    score = Number(payload.score);
    const scale = Number(evaluation.scale || 20);
    if (!Number.isFinite(score) || !Number.isFinite(scale) || scale <= 0 || score < 0 || score > scale) {
      throw new GradeSyncError("blocked", 422, "grade_score_out_of_range");
    }
    score = Math.round(score * 100) / 100;
    comment = nullableText(payload.comment, 500);

    const { data: byId, error: byIdError } = await service
      .from("student_grades")
      .select("id,evaluation_id,student_id")
      .eq("id", operation.entity_id)
      .maybeSingle();
    if (byIdError) throw new GradeSyncError("retryable", 503, "student_grade_lookup_failed");
    if (
      byId &&
      (String((byId as any).evaluation_id) !== evaluationId || String((byId as any).student_id) !== studentId)
    ) {
      throw new GradeSyncError("conflict", 409, "student_grade_id_already_used");
    }
    if (!byId) {
      const { data: semantic, error: semanticError } = await service
        .from("student_grades")
        .select("id")
        .eq("evaluation_id", evaluationId)
        .eq("student_id", studentId)
        .limit(2);
      if (semanticError) {
        throw new GradeSyncError("retryable", 503, "student_grade_semantic_lookup_failed");
      }
      if ((semantic || []).some((row) => String((row as any).id || "") !== operation.entity_id)) {
        throw new GradeSyncError("conflict", 409, "student_grade_identity_conflict");
      }
    }
  } else {
    throw new GradeSyncError("blocked", 422, "student_grade_action_invalid");
  }

  const { data, error } = await service.rpc("relay_apply_student_grade_v1", {
    p_institution_id: institutionId,
    p_entity_id: operation.entity_id,
    p_action: operation.action,
    p_base_server_version: operation.base_server_version,
    p_operation_id: operation.operation_id,
    p_actor_profile_id: operation.actor_profile_id,
    p_origin_device_id: operation.origin_device_id,
    p_payload_fingerprint: operation.payload_fingerprint,
    p_evaluation_id: evaluationId,
    p_student_id: studentId,
    p_score: score,
    p_comment: comment,
  });
  if (error) {
    const detail = rpcFailure(error);
    if (detail.includes("relay_student_grade_identity_conflict")) {
      throw new GradeSyncError("conflict", 409, "student_grade_identity_conflict");
    }
    if (detail.includes("relay_student_grade_institution_mismatch")) {
      throw new GradeSyncError("conflict", 409, "grade_institution_mismatch");
    }
    if (detail.includes("relay_student_grade_evaluation_not_found")) {
      throw new GradeSyncError("blocked", 422, "grade_evaluation_not_found");
    }
    throw new GradeSyncError("retryable", 503, "student_grade_atomic_apply_failed");
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result !== "object") {
    throw new GradeSyncError("retryable", 503, "student_grade_atomic_response_invalid");
  }
  const version = validVersion((result as any).server_version);
  const action = (result as any).current_action;
  if (version === null || (action !== "upsert" && action !== "delete")) {
    throw new GradeSyncError("retryable", 503, "student_grade_atomic_response_invalid");
  }
  if ((result as any).applied !== true) {
    const payload = (result as any).current_payload;
    throw new GradeSyncError("conflict", 409, "student_grade_version_conflict", {
      server_version: version,
      action,
      payload: payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null,
    });
  }

  return { serverVersion: version };
}

export async function processRelayStudentGradeSyncOperationV4(
  service: SupabaseClient,
  input: {
    institutionId: string;
    deviceId: string;
    operation: RelaySyncOperation;
    now?: Date;
  },
): Promise<RelayStudentGradeAcknowledgementV4> {
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  try {
    const previous = await reserveOrClaimReceipt(
      service,
      input.institutionId,
      input.deviceId,
      input.operation,
      nowIso,
    );
    if (previous) return previous;

    const applied = await applyVersionedGrade(
      service,
      input.institutionId,
      input.operation,
      now,
    );
    const acknowledgement: RelayStudentGradeAcknowledgementV4 = {
      operation_id: input.operation.operation_id,
      status: "acknowledged",
      http_status: 200,
      error: null,
      cloud_entity_id: input.operation.entity_id,
      applied_now: true,
      attendance_changed: false,
      cloud_server_version: applied.serverVersion,
      conflict: null,
    };
    await storeOutcome(service, input.institutionId, input.operation, acknowledgement, nowIso);
    return acknowledgement;
  } catch (error) {
    const code = error instanceof Error ? error.message : "relay_operation_failed";
    const validation = /(_required|_invalid|_too_long|_must_be_object|_not_supported|_mismatch)$/.test(code);
    const failure = error instanceof GradeSyncError
      ? error
      : validation
        ? new GradeSyncError("blocked", 422, code)
        : new GradeSyncError("retryable", 503, "relay_operation_failed");
    const acknowledgement: RelayStudentGradeAcknowledgementV4 = {
      operation_id: input.operation.operation_id,
      status: failure.outcome,
      http_status: failure.status,
      error: failure.code,
      cloud_entity_id: input.operation.entity_id,
      applied_now: false,
      attendance_changed: false,
      ...(failure.conflict ? {
        cloud_server_version: failure.conflict.server_version,
        conflict: failure.conflict,
      } : {}),
    };
    await storeOutcome(
      service,
      input.institutionId,
      input.operation,
      acknowledgement,
      nowIso,
    ).catch(() => undefined);
    return acknowledgement;
  }
}

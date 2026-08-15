import { createHash } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { getInstitutionMeta } from "./db.mjs";
import type { RelayStore } from "./store.mjs";
import {
  relayActorClassId,
  relayActorDeviceId,
  relayActorKind,
  type AuthenticatedRelayTeacher,
} from "./teacher-auth.mjs";

const PROTOCOL_VERSION = 1 as const;
const OPERATION_TYPE = "grades.score.set" as const;

type GradeScoreOperation = {
  protocol_version: typeof PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof OPERATION_TYPE;
  captured_at_device: string;
  evaluation_id: string;
  student_id: string;
  score: number | null;
  comment: string | null;
};

type EvaluationRow = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string | null;
  grade_period_id: string | null;
  grading_period_id: string | null;
  max_score: number;
  is_published: number;
  is_locked: number;
  publication_status: string | null;
  server_version: number;
};

type GradeRow = {
  id: string;
  evaluation_id: string;
  student_id: string;
  score: number | null;
  comment: string | null;
  server_version: number;
  updated_by: string | null;
};

export type GradeScoreWriteResult = {
  ok: true;
  operation_id: string;
  entity_id: string | null;
  action: "upsert" | "delete" | "noop";
  state: "secured_on_relay" | "not_changed";
  idempotent: boolean;
  relay_time: string;
};

export class RelayGradeWriteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "RelayGradeWriteError";
  }
}

function object(value: unknown, code: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RelayGradeWriteError(400, code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  row: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
) {
  const accepted = new Set(allowed);
  if (Object.keys(row).some((key) => !accepted.has(key))) {
    throw new RelayGradeWriteError(400, code);
  }
}

function text(value: unknown, code: string, max = 256) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new RelayGradeWriteError(400, code);
  if (normalized.length > max) {
    throw new RelayGradeWriteError(400, `${code}_too_long`);
  }
  return normalized;
}

function nullableComment(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value);
  if (normalized.length > 500) {
    throw new RelayGradeWriteError(400, "grade_comment_too_long");
  }
  return normalized;
}

function iso(value: unknown, code: string) {
  const normalized = text(value, code, 64);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    throw new RelayGradeWriteError(400, code);
  }
  return parsed.toISOString();
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseOperation(raw: unknown): GradeScoreOperation {
  const row = object(raw, "grade_operation_must_be_object");
  exactKeys(row, [
    "protocol_version",
    "operation_id",
    "operation_type",
    "captured_at_device",
    "evaluation_id",
    "student_id",
    "score",
    "comment",
  ], "grade_operation_field_not_supported");

  if (row.protocol_version !== PROTOCOL_VERSION) {
    throw new RelayGradeWriteError(400, "protocol_version_not_supported");
  }
  if (row.operation_type !== OPERATION_TYPE) {
    throw new RelayGradeWriteError(400, "grade_operation_type_not_supported");
  }

  let score: number | null = null;
  if (row.score !== null && row.score !== undefined && row.score !== "") {
    const numeric = Number(row.score);
    if (!Number.isFinite(numeric)) {
      throw new RelayGradeWriteError(422, "grade_score_invalid");
    }
    score = round2(numeric);
  }

  return {
    protocol_version: PROTOCOL_VERSION,
    operation_id: text(row.operation_id, "operation_id_required", 128),
    operation_type: OPERATION_TYPE,
    captured_at_device: iso(row.captured_at_device, "captured_at_device_invalid"),
    evaluation_id: text(row.evaluation_id, "evaluation_id_required", 128),
    student_id: text(row.student_id, "student_id_required", 128),
    score,
    comment: nullableComment(row.comment),
  };
}

function ensureAcademicReady(db: RelayDatabase, institutionId: string) {
  const revision = getInstitutionMeta(db, institutionId, "academic_revision");
  const ready =
    getInstitutionMeta(db, institutionId, "academic_offline_ready") === "true" &&
    getInstitutionMeta(db, institutionId, "academic_snapshot_complete") === "true" &&
    revision !== null &&
    Number.isSafeInteger(Number(revision));
  if (!ready) {
    throw new RelayGradeWriteError(409, "academic_snapshot_not_prepared");
  }
}

function institutionDate(db: RelayDatabase, institutionId: string, now: Date) {
  const row = db.prepare(`
    SELECT timezone FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(institutionId) as { timezone: string | null } | undefined;
  if (!row) throw new RelayGradeWriteError(404, "institution_not_initialized");
  const timezone = String(row.timezone || "Africa/Abidjan");
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    throw new RelayGradeWriteError(409, "institution_timezone_invalid");
  }
}

function deterministicGradeId(
  institutionId: string,
  evaluationId: string,
  studentId: string,
) {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`student_grade:${institutionId}:${evaluationId}:${studentId}`)
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function loadEvaluation(
  db: RelayDatabase,
  institutionId: string,
  evaluationId: string,
) {
  const row = db.prepare(`
    SELECT
      id,
      class_id,
      subject_id,
      teacher_id,
      grade_period_id,
      grading_period_id,
      max_score,
      is_published,
      is_locked,
      publication_status,
      server_version
    FROM grade_evaluations
    WHERE institution_id = ?
      AND id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `).get(institutionId, evaluationId) as EvaluationRow | undefined;
  if (!row) {
    throw new RelayGradeWriteError(404, "grade_evaluation_not_found");
  }
  return row;
}

function assertEvaluationEditable(
  db: RelayDatabase,
  institutionId: string,
  evaluation: EvaluationRow,
  today: string,
) {
  const publication = String(evaluation.publication_status || "draft").trim();
  if (evaluation.is_published === 1 || publication === "published") {
    throw new RelayGradeWriteError(423, "grade_evaluation_published");
  }
  if (publication === "submitted") {
    throw new RelayGradeWriteError(423, "grade_evaluation_submitted");
  }
  if (evaluation.is_locked === 1) {
    throw new RelayGradeWriteError(423, "grade_evaluation_locked");
  }

  const explicitLock = db.prepare(`
    SELECT is_locked
    FROM grade_evaluation_locks
    WHERE institution_id = ?
      AND evaluation_id = ?
      AND deleted_at IS NULL
      AND is_locked = 1
    LIMIT 1
  `).get(institutionId, evaluation.id);
  if (explicitLock) {
    throw new RelayGradeWriteError(423, "grade_evaluation_locked");
  }

  const periodId = String(
    evaluation.grading_period_id || evaluation.grade_period_id || "",
  ).trim();
  if (!periodId) return;

  const period = db.prepare(`
    SELECT id, end_date, is_locked
    FROM grade_periods
    WHERE institution_id = ?
      AND id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `).get(institutionId, periodId) as {
    id: string;
    end_date: string | null;
    is_locked: number;
  } | undefined;
  if (!period) {
    throw new RelayGradeWriteError(409, "grade_period_not_prepared");
  }
  if (period.is_locked === 1) {
    throw new RelayGradeWriteError(423, "grading_period_locked");
  }
  if (period.end_date && today > String(period.end_date).slice(0, 10)) {
    throw new RelayGradeWriteError(423, "grading_period_closed");
  }
}

function assertActorMayWrite(
  db: RelayDatabase,
  actor: AuthenticatedRelayTeacher,
  evaluation: EvaluationRow,
) {
  const institutionId = actor.institution_id;
  const kind = relayActorKind(actor);
  if (kind === "class_device") {
    const classId = relayActorClassId(actor);
    if (!classId || classId !== evaluation.class_id) {
      throw new RelayGradeWriteError(403, "grade_class_not_allowed");
    }
    const subjectAssigned = db.prepare(`
      SELECT 1
      FROM class_teachers
      WHERE institution_id = ?
        AND class_id = ?
        AND subject_id = ?
        AND deleted_at IS NULL
        AND end_date IS NULL
      LIMIT 1
    `).get(institutionId, evaluation.class_id, evaluation.subject_id);
    if (!subjectAssigned) {
      throw new RelayGradeWriteError(403, "grade_subject_not_allowed");
    }
    return;
  }

  const assignment = db.prepare(`
    SELECT 1
    FROM class_teachers
    WHERE institution_id = ?
      AND class_id = ?
      AND subject_id = ?
      AND teacher_id = ?
      AND deleted_at IS NULL
      AND end_date IS NULL
    LIMIT 1
  `).get(
    institutionId,
    evaluation.class_id,
    evaluation.subject_id,
    actor.actor_profile_id,
  );
  if (!assignment) {
    throw new RelayGradeWriteError(403, "grade_assignment_not_allowed");
  }
}

function assertStudentEnrolled(
  db: RelayDatabase,
  institutionId: string,
  classId: string,
  studentId: string,
) {
  const enrollment = db.prepare(`
    SELECT 1
    FROM class_enrollments ce
    JOIN students s
      ON s.institution_id = ce.institution_id
     AND s.id = ce.student_id
     AND s.deleted_at IS NULL
     AND s.is_active = 1
    WHERE ce.institution_id = ?
      AND ce.class_id = ?
      AND ce.student_id = ?
      AND ce.deleted_at IS NULL
      AND ce.end_date IS NULL
    LIMIT 1
  `).get(institutionId, classId, studentId);
  if (!enrollment) {
    throw new RelayGradeWriteError(422, "student_not_enrolled_in_class");
  }
}

function existingGrade(
  db: RelayDatabase,
  institutionId: string,
  evaluationId: string,
  studentId: string,
) {
  return db.prepare(`
    SELECT
      id,
      evaluation_id,
      student_id,
      score,
      comment,
      server_version,
      updated_by
    FROM student_grades
    WHERE institution_id = ?
      AND evaluation_id = ?
      AND student_id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `).get(institutionId, evaluationId, studentId) as GradeRow | undefined;
}

export function secureGradeScoreOperation(
  store: RelayStore,
  raw: unknown,
  actor: AuthenticatedRelayTeacher,
  now = new Date(),
): GradeScoreWriteResult {
  const operation = parseOperation(raw);
  const db = store.db;
  const institutionId = String(actor.institution_id || "").trim();
  ensureAcademicReady(db, institutionId);

  const evaluation = loadEvaluation(
    db,
    institutionId,
    operation.evaluation_id,
  );
  assertActorMayWrite(db, actor, evaluation);
  assertStudentEnrolled(
    db,
    institutionId,
    evaluation.class_id,
    operation.student_id,
  );
  assertEvaluationEditable(
    db,
    institutionId,
    evaluation,
    institutionDate(db, institutionId, now),
  );

  const scale = Number(evaluation.max_score || 20);
  if (
    operation.score !== null &&
    (!Number.isFinite(scale) ||
      scale <= 0 ||
      operation.score < 0 ||
      operation.score > scale)
  ) {
    throw new RelayGradeWriteError(422, "grade_score_out_of_range");
  }

  const grade = existingGrade(
    db,
    institutionId,
    evaluation.id,
    operation.student_id,
  );

  if (operation.score === null && !grade) {
    return {
      ok: true,
      operation_id: operation.operation_id,
      entity_id: null,
      action: "noop",
      state: "not_changed",
      idempotent: true,
      relay_time: now.toISOString(),
    };
  }

  const entityId = grade?.id || deterministicGradeId(
    institutionId,
    evaluation.id,
    operation.student_id,
  );
  const action = operation.score === null ? "delete" as const : "upsert" as const;
  const payload = action === "delete"
    ? null
    : {
        institution_id: institutionId,
        evaluation_id: evaluation.id,
        student_id: operation.student_id,
        score: operation.score,
        comment: operation.comment,
        updated_by: actor.actor_profile_id,
        class_id: evaluation.class_id,
        subject_id: evaluation.subject_id,
        actor_kind: relayActorKind(actor),
        grading_period_id:
          evaluation.grading_period_id || evaluation.grade_period_id || null,
        operation_type: OPERATION_TYPE,
        captured_at_device: operation.captured_at_device,
      };

  let result;
  try {
    result = store.enqueue({
      protocol_version: PROTOCOL_VERSION,
      operation_id: operation.operation_id,
      institution_id: institutionId,
      device_id: relayActorDeviceId(actor),
      actor_profile_id: actor.actor_profile_id,
      entity_type: "student_grade",
      entity_id: entityId,
      action,
      base_server_version: grade?.server_version || 0,
      occurred_at: operation.captured_at_device,
      payload,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "grade_enqueue_failed";
    if (code === "operation_id_reused_with_different_payload") {
      throw new RelayGradeWriteError(409, code);
    }
    throw new RelayGradeWriteError(500, "grade_enqueue_failed");
  }

  return {
    ok: true,
    operation_id: operation.operation_id,
    entity_id: entityId,
    action,
    state: "secured_on_relay",
    idempotent: !result.inserted,
    relay_time: now.toISOString(),
  };
}

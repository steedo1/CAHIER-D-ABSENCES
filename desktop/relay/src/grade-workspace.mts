import type { RelayDatabase } from "./db.mjs";
import { getInstitutionMeta } from "./db.mjs";
import {
  relayActorClassId,
  relayActorKind,
  type AuthenticatedRelayTeacher,
} from "./teacher-auth.mjs";

export class RelayGradeWorkspaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "RelayGradeWorkspaceError";
  }
}

type GradeWorkspaceRequest = {
  class_id?: string | null;
  subject_id?: string | null;
  grading_period_id?: string | null;
};

function text(value: unknown) {
  return String(value || "").trim();
}

function academicRevision(db: RelayDatabase, institutionId: string) {
  const raw = getInstitutionMeta(db, institutionId, "academic_revision");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function ensureAcademicReady(db: RelayDatabase, institutionId: string) {
  const ready =
    getInstitutionMeta(db, institutionId, "academic_offline_ready") === "true" &&
    getInstitutionMeta(db, institutionId, "academic_snapshot_complete") === "true" &&
    academicRevision(db, institutionId) !== null;
  if (!ready) {
    throw new RelayGradeWorkspaceError(409, "academic_snapshot_not_prepared");
  }
}

function authorizedAssignments(
  db: RelayDatabase,
  actor: AuthenticatedRelayTeacher,
  requestedClassId: string,
) {
  const institutionId = actor.institution_id;
  const kind = relayActorKind(actor);

  if (kind === "class_device") {
    const boundClassId = relayActorClassId(actor);
    if (!boundClassId || requestedClassId !== boundClassId) {
      throw new RelayGradeWorkspaceError(403, "grade_class_not_allowed");
    }
    return db.prepare(`
      SELECT
        ct.class_id,
        ct.subject_id,
        ct.teacher_id,
        s.name AS subject_name,
        s.short_name AS subject_short_name
      FROM class_teachers ct
      LEFT JOIN subjects s
        ON s.institution_id = ct.institution_id
       AND s.id = ct.subject_id
       AND s.deleted_at IS NULL
      WHERE ct.institution_id = ?
        AND ct.class_id = ?
        AND ct.deleted_at IS NULL
        AND ct.end_date IS NULL
      ORDER BY COALESCE(s.name, ct.subject_id), ct.teacher_id
    `).all(institutionId, requestedClassId) as Array<Record<string, unknown>>;
  }

  return db.prepare(`
    SELECT
      ct.class_id,
      ct.subject_id,
      ct.teacher_id,
      s.name AS subject_name,
      s.short_name AS subject_short_name
    FROM class_teachers ct
    LEFT JOIN subjects s
      ON s.institution_id = ct.institution_id
     AND s.id = ct.subject_id
     AND s.deleted_at IS NULL
    WHERE ct.institution_id = ?
      AND ct.class_id = ?
      AND ct.teacher_id = ?
      AND ct.deleted_at IS NULL
      AND ct.end_date IS NULL
    ORDER BY COALESCE(s.name, ct.subject_id)
  `).all(
    institutionId,
    requestedClassId,
    actor.actor_profile_id,
  ) as Array<Record<string, unknown>>;
}

export function relayGradeWorkspace(
  db: RelayDatabase,
  actor: AuthenticatedRelayTeacher,
  raw: GradeWorkspaceRequest = {},
) {
  const institutionId = text(actor.institution_id);
  ensureAcademicReady(db, institutionId);

  const actorKind = relayActorKind(actor);
  const boundClassId = relayActorClassId(actor);
  const classId = text(raw.class_id) || boundClassId || "";
  if (!classId) {
    throw new RelayGradeWorkspaceError(400, "grade_class_required");
  }

  const cls = db.prepare(`
    SELECT
      id,
      label,
      level,
      academic_year,
      education_type,
      formation_code,
      formation_level_code,
      server_version,
      updated_at
    FROM classes
    WHERE institution_id = ?
      AND id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `).get(institutionId, classId) as Record<string, unknown> | undefined;
  if (!cls) {
    throw new RelayGradeWorkspaceError(404, "grade_class_not_found");
  }

  const assignments = authorizedAssignments(db, actor, classId);
  if (!assignments.length) {
    throw new RelayGradeWorkspaceError(403, "grade_assignment_not_allowed");
  }

  const requestedSubjectId = text(raw.subject_id);
  if (
    requestedSubjectId &&
    !assignments.some((row) => text(row.subject_id) === requestedSubjectId)
  ) {
    throw new RelayGradeWorkspaceError(403, "grade_subject_not_allowed");
  }

  const gradingPeriodId = text(raw.grading_period_id);
  const academicYear = text(cls.academic_year);

  const gradingPeriods = db.prepare(`
    SELECT
      id,
      academic_year,
      code,
      label,
      short_label,
      start_date,
      end_date,
      coeff,
      is_active,
      is_locked,
      order_index,
      server_version,
      updated_at
    FROM grade_periods
    WHERE institution_id = ?
      AND deleted_at IS NULL
      AND (? = '' OR academic_year = ?)
    ORDER BY COALESCE(order_index, 999999), COALESCE(start_date, ''), label
  `).all(institutionId, academicYear, academicYear) as Array<Record<string, unknown>>;

  const roster = db.prepare(`
    SELECT
      s.id,
      s.first_name,
      s.last_name,
      s.display_name AS full_name,
      s.registration_number AS matricule,
      s.gender
    FROM class_enrollments ce
    JOIN students s
      ON s.institution_id = ce.institution_id
     AND s.id = ce.student_id
     AND s.deleted_at IS NULL
     AND s.is_active = 1
    WHERE ce.institution_id = ?
      AND ce.class_id = ?
      AND ce.deleted_at IS NULL
      AND ce.end_date IS NULL
    ORDER BY s.display_name COLLATE NOCASE, s.id
  `).all(institutionId, classId) as Array<Record<string, unknown>>;

  const evaluations = db.prepare(`
    SELECT
      ge.id,
      ge.class_id,
      ge.subject_id,
      ge.subject_component_id,
      COALESCE(ge.grading_period_id, ge.grade_period_id) AS grading_period_id,
      ge.teacher_id,
      ge.evaluation_date AS eval_date,
      ge.eval_kind,
      ge.max_score AS scale,
      ge.coefficient AS coeff,
      ge.is_published,
      ge.is_locked,
      ge.publication_status,
      ge.publication_version,
      ge.published_at,
      ge.submitted_at,
      ge.reviewed_at,
      ge.review_comment,
      ge.server_version,
      ge.updated_at
    FROM grade_evaluations ge
    WHERE ge.institution_id = ?
      AND ge.class_id = ?
      AND ge.deleted_at IS NULL
      AND (? = '' OR ge.subject_id = ?)
      AND (? = '' OR COALESCE(ge.grading_period_id, ge.grade_period_id) = ?)
    ORDER BY COALESCE(ge.evaluation_date, ''), ge.id
  `).all(
    institutionId,
    classId,
    requestedSubjectId,
    requestedSubjectId,
    gradingPeriodId,
    gradingPeriodId,
  ) as Array<Record<string, unknown>>;

  const scores = db.prepare(`
    SELECT
      sg.id,
      sg.evaluation_id,
      sg.student_id,
      sg.score,
      sg.comment,
      sg.updated_by,
      sg.server_version,
      sg.updated_at
    FROM student_grades sg
    JOIN grade_evaluations ge
      ON ge.institution_id = sg.institution_id
     AND ge.id = sg.evaluation_id
     AND ge.deleted_at IS NULL
    WHERE sg.institution_id = ?
      AND ge.class_id = ?
      AND sg.deleted_at IS NULL
      AND (? = '' OR ge.subject_id = ?)
      AND (? = '' OR COALESCE(ge.grading_period_id, ge.grade_period_id) = ?)
    ORDER BY sg.evaluation_id, sg.student_id
  `).all(
    institutionId,
    classId,
    requestedSubjectId,
    requestedSubjectId,
    gradingPeriodId,
    gradingPeriodId,
  ) as Array<Record<string, unknown>>;

  return {
    version: 1 as const,
    source: "relay" as const,
    institution_id: institutionId,
    actor_kind: actorKind,
    actor_profile_id: actor.actor_profile_id,
    class_id: classId,
    academic_revision: academicRevision(db, institutionId),
    class: cls,
    assignments,
    grading_periods: gradingPeriods,
    roster,
    evaluations,
    scores,
  };
}

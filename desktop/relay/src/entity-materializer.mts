import type { RelayDatabase } from "./db.mjs";
import { canonicalJson } from "./json.mjs";
import type { SyncAction, SyncEntityType } from "./types.mjs";
import {
  localDateTime,
  scheduledSlotTimes,
  timeMinutes,
  weekdayMatches,
} from "./teacher-session-rules.mjs";

type EntitySpec = {
  table: string;
  collection: string;
  entityType: SyncEntityType;
  columns: readonly string[];
  booleanColumns?: readonly string[];
  jsonColumns?: readonly string[];
};

export const ENTITY_SPECS: readonly EntitySpec[] = [
  {
    table: "institutions",
    collection: "institutions",
    entityType: "institution",
    columns: ["name", "code", "timezone", "settings_json"],
    jsonColumns: ["settings_json"],
  },
  {
    table: "academic_years",
    collection: "academic_years",
    entityType: "academic_year",
    columns: ["institution_id", "code", "label", "start_date", "end_date", "is_current"],
    booleanColumns: ["is_current"],
  },
  {
    table: "profiles",
    collection: "profiles",
    entityType: "profile",
    columns: ["institution_id", "display_name", "email", "phone", "is_active"],
    booleanColumns: ["is_active"],
  },
  {
    table: "user_roles",
    collection: "user_roles",
    entityType: "user_role",
    columns: ["institution_id", "profile_id", "role"],
  },
  {
    table: "classes",
    collection: "classes",
    entityType: "class",
    columns: ["institution_id", "academic_year", "label", "level", "code", "head_teacher_id", "official_track_code", "education_type", "formation_code", "formation_level_code"],
  },
  {
    table: "subjects",
    collection: "subjects",
    entityType: "subject",
    columns: ["institution_id", "base_subject_id", "name", "short_name"],
  },
  {
    table: "teacher_subjects",
    collection: "teacher_subjects",
    entityType: "teacher_subject",
    columns: ["institution_id", "teacher_id", "subject_id"],
  },
  {
    table: "students",
    collection: "students",
    entityType: "student",
    columns: [
      "institution_id",
      "registration_number",
      "first_name",
      "last_name",
      "display_name",
      "gender",
      "is_active",
      "birthdate",
      "birth_place",
      "nationality",
      "regime",
      "is_repeater",
      "is_boarder",
      "is_affecte",
      "lv2",
      "lifecycle_status",
    ],
    booleanColumns: ["is_active", "is_repeater", "is_boarder", "is_affecte"],
  },
  {
    table: "class_enrollments",
    collection: "class_enrollments",
    entityType: "class_enrollment",
    columns: ["institution_id", "class_id", "student_id", "start_date", "end_date", "official_track_code"],
  },
  {
    table: "institution_periods",
    collection: "institution_periods",
    entityType: "institution_period",
    columns: ["institution_id", "weekday", "label", "start_time", "end_time"],
  },
  {
    table: "teacher_timetables",
    collection: "teacher_timetables",
    entityType: "teacher_timetable",
    columns: [
      "institution_id",
      "academic_year",
      "class_id",
      "subject_id",
      "teacher_id",
      "period_id",
      "weekday",
    ],
  },
  {
    table: "teacher_absence_requests",
    collection: "teacher_absence_requests",
    entityType: "teacher_absence_request",
    columns: [
      "institution_id",
      "teacher_id",
      "start_date",
      "end_date",
      "reason_label",
      "status",
      "admin_comment",
    ],
  },
  {
    table: "teacher_sessions",
    collection: "teacher_sessions",
    entityType: "teacher_session",
    columns: [
      "institution_id",
      "client_session_id",
      "class_id",
      "subject_id",
      "teacher_id",
      "period_id",
      "started_at",
      "actual_call_at",
      "ended_at",
      "origin",
    ],
  },
  {
    table: "attendance_marks",
    collection: "attendance_marks",
    entityType: "attendance_mark",
    columns: [
      "institution_id",
      "session_id",
      "student_id",
      "status",
      "late_minutes",
      "comment",
    ],
  },
  {
    table: "grade_periods",
    collection: "grade_periods",
    entityType: "grade_period",
    columns: [
      "institution_id",
      "academic_year",
      "label",
      "start_date",
      "end_date",
      "is_locked",
      "code",
      "short_label",
      "order_index",
      "is_active",
      "kind",
      "academic_year_id",
      "coeff",
      "scope_type",
      "education_type",
      "formation_code",
      "display_code",
      "profile_period_key",
    ],
    booleanColumns: ["is_locked", "is_active"],
  },
  {
    table: "grade_evaluations",
    collection: "grade_evaluations",
    entityType: "grade_evaluation",
    columns: [
      "institution_id",
      "class_id",
      "subject_id",
      "teacher_id",
      "grade_period_id",
      "title",
      "evaluation_date",
      "max_score",
      "coefficient",
      "is_published",
      "is_locked",
      "eval_kind",
      "academic_year",
      "academic_year_id",
      "subject_component_id",
      "grading_period_id",
      "publication_status",
      "publication_version",
      "published_at",
      "submitted_at",
      "submitted_by",
      "reviewed_at",
      "reviewed_by",
      "review_comment",
    ],
    booleanColumns: ["is_published", "is_locked"],
  },
  {
    table: "student_grades",
    collection: "student_grades",
    entityType: "student_grade",
    columns: ["institution_id", "evaluation_id", "student_id", "score", "comment", "updated_by"],
  },
  {
    table: "class_teachers",
    collection: "class_teachers",
    entityType: "class_teacher",
    columns: ["institution_id", "class_id", "subject_id", "teacher_id", "start_date", "end_date"],
  },
  {
    table: "educator_class_assignments",
    collection: "educator_class_assignments",
    entityType: "educator_class_assignment",
    columns: ["institution_id", "profile_id", "level", "class_id"],
  },
  {
    table: "institution_level_subjects",
    collection: "institution_level_subjects",
    entityType: "institution_level_subject",
    columns: ["institution_id", "education_type", "formation_code", "level_code", "subject_id", "order_index", "is_active"],
    booleanColumns: ["is_active"],
  },
  {
    table: "institution_subject_coeffs",
    collection: "institution_subject_coeffs",
    entityType: "institution_subject_coeff",
    columns: ["institution_id", "level", "subject_id", "coeff", "include_in_average"],
    booleanColumns: ["include_in_average"],
  },
  {
    table: "institution_subject_grade_policies",
    collection: "institution_subject_grade_policies",
    entityType: "institution_subject_grade_policy",
    columns: ["institution_id", "subject_id", "include_in_general_average", "include_in_conduct_average", "conduct_weight", "is_active"],
    booleanColumns: ["include_in_general_average", "include_in_conduct_average", "is_active"],
  },
  {
    table: "grade_subject_components",
    collection: "grade_subject_components",
    entityType: "grade_subject_component",
    columns: ["institution_id", "subject_id", "code", "label", "short_label", "coeff_in_subject", "order_index", "is_active", "level"],
    booleanColumns: ["is_active"],
  },
  {
    table: "grade_published_scores",
    collection: "grade_published_scores",
    entityType: "grade_published_score",
    columns: ["institution_id", "class_id", "evaluation_id", "student_id", "subject_id", "subject_component_id", "teacher_id", "eval_date", "eval_kind", "score", "scale", "coeff", "publication_version", "is_current", "published_at", "published_by"],
    booleanColumns: ["is_current"],
  },
  {
    table: "grade_publication_events",
    collection: "grade_publication_events",
    entityType: "grade_publication_event",
    columns: ["institution_id", "evaluation_id", "actor_profile_id", "action", "comment", "created_at"],
  },
  {
    table: "grade_adjustments",
    collection: "grade_adjustments",
    entityType: "grade_adjustment",
    columns: ["institution_id", "class_id", "subject_id", "student_id", "academic_year", "grading_period_id", "bonus", "reason", "created_by", "created_at"],
  },
  {
    table: "grade_evaluation_locks",
    collection: "grade_evaluation_locks",
    entityType: "grade_evaluation_lock",
    columns: ["institution_id", "evaluation_id", "class_id", "subject_id", "teacher_id", "is_locked", "locked_by", "locked_at"],
    booleanColumns: ["is_locked"],
  },
  {
    table: "institution_grade_publication_settings",
    collection: "institution_grade_publication_settings",
    entityType: "institution_grade_publication_setting",
    columns: ["institution_id", "require_admin_validation", "auto_push_on_publish", "sms_digest_mode"],
    booleanColumns: ["require_admin_validation", "auto_push_on_publish"],
  },
  {
    table: "bulletin_subject_groups",
    collection: "bulletin_subject_groups",
    entityType: "bulletin_subject_group",
    columns: ["institution_id", "level", "code", "label", "short_label", "order_index", "annual_coeff", "is_active"],
    booleanColumns: ["is_active"],
  },
  {
    table: "bulletin_subject_group_items",
    collection: "bulletin_subject_group_items",
    entityType: "bulletin_subject_group_item",
    columns: ["institution_id", "group_id", "subject_id", "institution_subject_id", "order_index", "subject_coeff_override", "is_optional"],
    booleanColumns: ["is_optional"],
  },
  {
    table: "bulletin_nc_overrides",
    collection: "bulletin_nc_overrides",
    entityType: "bulletin_nc_override",
    columns: ["institution_id", "class_id", "student_id", "academic_year", "period_from", "period_to", "scope", "is_nc", "reason", "missing_subjects_snapshot"],
    booleanColumns: ["is_nc"],
    jsonColumns: ["missing_subjects_snapshot"],
  },
  {
    table: "core_subject_weights",
    collection: "core_subject_weights",
    entityType: "core_subject_weight",
    columns: ["institution_id", "level", "subject_id", "weight", "is_exam_core"],
    booleanColumns: ["is_exam_core"],
  },
  {
    table: "institution_conduct_policies",
    collection: "institution_conduct_policies",
    entityType: "institution_conduct_policy",
    columns: ["institution_id", "mode", "classic_conduct_weight", "missing_subject_strategy", "is_active"],
    booleanColumns: ["is_active"],
  },
  {
    table: "conduct_settings",
    collection: "conduct_settings",
    entityType: "conduct_setting",
    columns: ["institution_id", "assiduite_max", "tenue_max", "moralite_max", "discipline_max", "points_per_absent_hour", "absent_hours_zero_threshold", "absent_hours_note_after_threshold", "lateness_mode", "lateness_minutes_per_absent_hour", "lateness_points_per_late"],
  },
  {
    table: "conduct_events",
    collection: "conduct_events",
    entityType: "conduct_event",
    columns: ["institution_id", "class_id", "student_id", "rubric", "event_type", "occurred_at", "note", "created_by", "created_at"],
  },
  {
    table: "conduct_penalties",
    collection: "conduct_penalties",
    entityType: "conduct_penalty",
    columns: ["institution_id", "class_id", "subject_id", "student_id", "rubric", "points", "points_removed", "reason", "author_id", "author_profile_id", "author_role_label", "author_subject_name", "period_id", "occurred_at", "client_action_id"],
  },
  {
    table: "student_penalties",
    collection: "student_penalties",
    entityType: "student_penalty",
    columns: ["institution_id", "class_id", "subject_id", "teacher_id", "student_id", "rubric", "points", "reason", "issued_at", "meta"],
    jsonColumns: ["meta"],
  },
  {
    table: "conduct_average_overrides",
    collection: "conduct_average_overrides",
    entityType: "conduct_average_override",
    columns: ["institution_id", "class_id", "student_id", "academic_year", "period_code", "from_date", "to_date", "calculated_total", "override_total", "reason", "edited_by"],
  },
  {
    table: "conduct_rubric_overrides",
    collection: "conduct_rubric_overrides",
    entityType: "conduct_rubric_override",
    columns: ["institution_id", "class_id", "student_id", "academic_year", "period_code", "rubric_key", "from_date", "to_date", "calculated_value", "override_value", "edited_by"],
  },
  {
    table: "teacher_signatures",
    collection: "teacher_signatures",
    entityType: "teacher_signature",
    columns: ["institution_id", "teacher_id", "storage_path", "sha256"],
  },
  {
    table: "textbook_assignments",
    collection: "textbook_assignments",
    entityType: "textbook_assignment",
    columns: [
      "institution_id",
      "class_id",
      "subject_id",
      "teacher_id",
      "title",
      "source_document_json",
    ],
    jsonColumns: ["source_document_json"],
  },
  {
    table: "textbook_items",
    collection: "textbook_items",
    entityType: "textbook_item",
    columns: ["institution_id", "assignment_id", "position", "title", "content"],
  },
  {
    table: "textbook_sessions",
    collection: "textbook_sessions",
    entityType: "textbook_session",
    columns: [
      "institution_id",
      "client_session_id",
      "assignment_id",
      "item_id",
      "teacher_id",
      "session_title",
      "session_date",
      "period_id",
      "period_label",
      "start_time",
      "end_time",
      "duration_minutes",
      "content",
      "homework",
      "observations",
    ],
  },
  {
    table: "textbook_completions",
    collection: "textbook_completions",
    entityType: "textbook_completion",
    columns: [
      "institution_id",
      "assignment_id",
      "item_id",
      "status",
      "note",
      "completed_at",
    ],
  },
  {
    table: "offline_documents",
    collection: "offline_documents",
    entityType: "offline_document",
    columns: [
      "institution_id",
      "kind",
      "owner_id",
      "media_type",
      "local_path",
      "sha256",
      "byte_size",
    ],
  },
] as const;

const SPEC_BY_ENTITY = new Map(ENTITY_SPECS.map((spec) => [spec.entityType, spec]));
const SPEC_BY_COLLECTION = new Map(ENTITY_SPECS.map((spec) => [spec.collection, spec]));

export function entitySpec(entityType: SyncEntityType) {
  const spec = SPEC_BY_ENTITY.get(entityType);
  if (!spec) throw new Error(`entity_type_not_materializable:${entityType}`);
  return spec;
}

export function collectionSpec(collection: string) {
  return SPEC_BY_COLLECTION.get(collection) ?? null;
}

type AttendanceMarkSemanticRow = {
  id: string;
  session_id: string;
  student_id: string;
};

function attendanceMarkSemanticRow(
  db: RelayDatabase,
  institutionId: string,
  payload: Record<string, unknown>,
) {
  const sessionId = String(payload.session_id ?? "").trim();
  const studentId = String(payload.student_id ?? "").trim();
  if (!sessionId || !studentId) return null;
  return db.prepare(`
    SELECT id, session_id, student_id
    FROM attendance_marks
    WHERE institution_id = ? AND session_id = ? AND student_id = ?
  `).get(institutionId, sessionId, studentId) as AttendanceMarkSemanticRow | undefined ?? null;
}

function attendanceMarkIdentityHasPendingWrite(
  db: RelayDatabase,
  institutionId: string,
  existingId: string,
  sessionId: string,
  studentId: string,
) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sync_outbox pending
    WHERE pending.institution_id = ?
      AND pending.state IN ('pending', 'sending', 'blocked')
      AND (
        (pending.entity_type = 'attendance_mark' AND pending.entity_id = ?)
        OR (
          pending.entity_type = 'attendance_call'
          AND pending.entity_id = ?
          AND EXISTS (
            SELECT 1
            FROM json_each(json_extract(pending.payload_json, '$.marks')) queued_mark
            WHERE json_extract(queued_mark.value, '$.student_id') = ?
          )
        )
      )
    LIMIT 1
  `).get(institutionId, existingId, sessionId, studentId));
}

type ClassEnrollmentSemanticRow = {
  id: string;
};

function classEnrollmentSemanticRows(
  db: RelayDatabase,
  institutionId: string,
  entityId: string,
  payload: Record<string, unknown>,
) {
  const classId = String(payload.class_id ?? "").trim();
  const studentId = String(payload.student_id ?? "").trim();
  if (!classId || !studentId) return [];
  const startDate = payload.start_date === null || payload.start_date === undefined
    ? null
    : String(payload.start_date);
  return db.prepare(`
    SELECT id
    FROM class_enrollments
    WHERE institution_id = ?
      AND class_id = ?
      AND student_id = ?
      AND start_date IS ?
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END,
             server_version DESC, updated_at DESC, id
  `).all(
    institutionId,
    classId,
    studentId,
    startDate,
    entityId,
  ) as ClassEnrollmentSemanticRow[];
}

function classEnrollmentIdentityLocallyProtected(
  db: RelayDatabase,
  institutionId: string,
  entityId: string,
) {
  return Boolean(db.prepare(`
    SELECT 1
    WHERE EXISTS (
      SELECT 1
      FROM sync_records local
      WHERE local.institution_id = ?
        AND local.entity_type = 'class_enrollment'
        AND local.entity_id = ?
        AND local.local_dirty = 1
    ) OR EXISTS (
      SELECT 1
      FROM sync_outbox pending
      WHERE pending.institution_id = ?
        AND pending.entity_type = 'class_enrollment'
        AND pending.entity_id = ?
        AND pending.state IN ('pending', 'sending', 'blocked')
    ) OR EXISTS (
      SELECT 1
      FROM sync_conflicts conflict
      WHERE conflict.institution_id = ?
        AND conflict.entity_type = 'class_enrollment'
        AND conflict.entity_id = ?
        AND conflict.resolved_at IS NULL
    )
    LIMIT 1
  `).get(
    institutionId,
    entityId,
    institutionId,
    entityId,
    institutionId,
    entityId,
  ));
}

export function classEnrollmentSemanticIdentityProtected(
  db: RelayDatabase,
  institutionId: string,
  entityId: string,
  payload: Record<string, unknown>,
) {
  return classEnrollmentSemanticRows(db, institutionId, entityId, payload).some(
    (row) => row.id !== entityId && classEnrollmentIdentityLocallyProtected(
      db,
      institutionId,
      row.id,
    ),
  );
}

function migrateClassEnrollmentSyncIdentity(
  db: RelayDatabase,
  institutionId: string,
  legacyId: string,
  canonicalId: string,
) {
  const canonicalSyncRecord = db.prepare(`
    SELECT 1
    FROM sync_records
    WHERE institution_id = ? AND entity_type = 'class_enrollment' AND entity_id = ?
  `).get(institutionId, canonicalId);
  if (canonicalSyncRecord) {
    db.prepare(`
      DELETE FROM sync_records
      WHERE institution_id = ? AND entity_type = 'class_enrollment' AND entity_id = ?
    `).run(institutionId, legacyId);
  } else {
    db.prepare(`
      UPDATE sync_records
      SET entity_id = ?
      WHERE institution_id = ? AND entity_type = 'class_enrollment' AND entity_id = ?
    `).run(canonicalId, institutionId, legacyId);
  }

  const canonicalFailure = db.prepare(`
    SELECT 1
    FROM sync_materialization_failures
    WHERE institution_id = ? AND entity_type = 'class_enrollment' AND entity_id = ?
  `).get(institutionId, canonicalId);
  if (canonicalFailure) {
    db.prepare(`
      DELETE FROM sync_materialization_failures
      WHERE institution_id = ? AND entity_type = 'class_enrollment' AND entity_id = ?
    `).run(institutionId, legacyId);
  } else {
    db.prepare(`
      UPDATE sync_materialization_failures
      SET entity_id = ?
      WHERE institution_id = ? AND entity_type = 'class_enrollment' AND entity_id = ?
    `).run(canonicalId, institutionId, legacyId);
  }

  db.prepare(`
    UPDATE sync_inbox
    SET entity_id = ?
    WHERE institution_id = ? AND entity_type = 'class_enrollment' AND entity_id = ?
  `).run(canonicalId, institutionId, legacyId);
  db.prepare(`
    UPDATE sync_conflicts
    SET entity_id = ?
    WHERE institution_id = ? AND entity_type = 'class_enrollment' AND entity_id = ?
  `).run(canonicalId, institutionId, legacyId);
  db.prepare(`
    UPDATE audit_log
    SET entity_id = ?
    WHERE institution_id = ? AND entity_type = 'class_enrollment' AND entity_id = ?
  `).run(canonicalId, institutionId, legacyId);
}

function materializeClassEnrollment(
  db: RelayDatabase,
  institutionId: string,
  entityId: string,
  payload: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const persist = db.transaction(() => {
    const semanticRows = classEnrollmentSemanticRows(
      db,
      institutionId,
      entityId,
      payload,
    );
    const protectedLegacy = semanticRows.find(
      (row) => row.id !== entityId && classEnrollmentIdentityLocallyProtected(
        db,
        institutionId,
        row.id,
      ),
    );
    if (protectedLegacy) {
      throw new Error("class_enrollment_semantic_identity_locally_protected");
    }

    const canonicalExists = semanticRows.some((row) => row.id === entityId);
    const legacyRows = semanticRows.filter((row) => row.id !== entityId);
    if (!canonicalExists && legacyRows.length > 0) {
      const adopted = legacyRows.shift()!;
      db.prepare(`
        UPDATE class_enrollments
        SET id = ?
        WHERE institution_id = ? AND id = ?
      `).run(entityId, institutionId, adopted.id);
      migrateClassEnrollmentSyncIdentity(db, institutionId, adopted.id, entityId);
    }

    for (const duplicate of legacyRows) {
      db.prepare(`
        UPDATE class_enrollments
        SET end_date = COALESCE(end_date, (
              SELECT end_date FROM class_enrollments
              WHERE institution_id = ? AND id = ?
            )),
            official_track_code = COALESCE(official_track_code, (
              SELECT official_track_code FROM class_enrollments
              WHERE institution_id = ? AND id = ?
            ))
        WHERE institution_id = ? AND id = ?
      `).run(
        institutionId,
        duplicate.id,
        institutionId,
        duplicate.id,
        institutionId,
        entityId,
      );
      migrateClassEnrollmentSyncIdentity(db, institutionId, duplicate.id, entityId);
      db.prepare(`
        DELETE FROM class_enrollments
        WHERE institution_id = ? AND id = ?
      `).run(institutionId, duplicate.id);
    }

    const columns = Object.keys(values);
    const updates = columns
      .filter((column) => column !== "id" && column !== "institution_id")
      .map((column) => `${column} = excluded.${column}`);
    db.prepare(`
      INSERT INTO class_enrollments(${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")})
      ON CONFLICT(institution_id, id) DO UPDATE SET ${updates.join(", ")}
    `).run(...columns.map((column) => values[column]));
  });
  persist();
}

export function attendanceMarkSemanticIdentityProtected(
  db: RelayDatabase,
  institutionId: string,
  entityId: string,
  payload: Record<string, unknown>,
) {
  const existing = attendanceMarkSemanticRow(db, institutionId, payload);
  if (!existing || existing.id === entityId) return false;
  const dirty = db.prepare(`
    SELECT local_dirty
    FROM sync_records
    WHERE institution_id = ? AND entity_type = 'attendance_mark' AND entity_id = ?
  `).get(institutionId, existing.id) as { local_dirty: number } | undefined;
  return dirty?.local_dirty === 1 || attendanceMarkIdentityHasPendingWrite(
    db,
    institutionId,
    existing.id,
    existing.session_id,
    existing.student_id,
  );
}

function materializeAttendanceMark(
  db: RelayDatabase,
  institutionId: string,
  entityId: string,
  payload: Record<string, unknown>,
  values: Record<string, unknown>,
) {
  const existing = attendanceMarkSemanticRow(db, institutionId, payload);
  if (
    existing &&
    existing.id !== entityId &&
    attendanceMarkSemanticIdentityProtected(db, institutionId, entityId, payload)
  ) {
    throw new Error("attendance_mark_semantic_identity_locally_protected");
  }

  const columns = Object.keys(values);
  const updates = columns
    .filter((column) => column !== "institution_id")
    .map((column) => `${column} = excluded.${column}`);
  const persist = db.transaction(() => {
    db.prepare(`
      INSERT INTO attendance_marks(${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")})
      ON CONFLICT(institution_id, session_id, student_id)
      DO UPDATE SET ${updates.join(", ")}
    `).run(...columns.map((column) => values[column]));

    if (!existing || existing.id === entityId) return;
    const canonicalRecord = db.prepare(`
      SELECT 1 FROM sync_records
      WHERE institution_id = ? AND entity_type = 'attendance_mark' AND entity_id = ?
    `).get(institutionId, entityId);
    if (canonicalRecord) {
      db.prepare(`
        DELETE FROM sync_records
        WHERE institution_id = ? AND entity_type = 'attendance_mark' AND entity_id = ?
      `).run(institutionId, existing.id);
    } else {
      db.prepare(`
        UPDATE sync_records
        SET entity_id = ?
        WHERE institution_id = ? AND entity_type = 'attendance_mark' AND entity_id = ?
      `).run(entityId, institutionId, existing.id);
    }
  });
  persist();
}

export function materializeEntity(
  db: RelayDatabase,
  input: {
    institutionId: string;
    entityType: SyncEntityType;
    entityId: string;
    action: SyncAction;
    payload: Record<string, unknown> | null;
    serverVersion: number;
    occurredAt: string;
  },
) {
  const spec = entitySpec(input.entityType);
  const entityId = requiredText(input.entityId, "entity_id");
  const institutionId = requiredText(input.institutionId, "institution_id");
  const occurredAt = requiredText(input.occurredAt, "occurred_at");

  if (input.action === "delete") {
    const institutionGuard = spec.entityType === "institution" ? "" : " AND institution_id = ?";
    const params = spec.entityType === "institution"
      ? [occurredAt, occurredAt, input.serverVersion, entityId]
      : [occurredAt, occurredAt, input.serverVersion, entityId, institutionId];
    db.prepare(`
      UPDATE ${spec.table}
      SET deleted_at = ?, updated_at = ?, server_version = MAX(server_version, ?)
      WHERE id = ?${institutionGuard}
    `).run(...params);
    return;
  }

  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new Error("materialization_payload_required");
  }

  const payload = input.payload;
  const values: Record<string, unknown> = {
    id: entityId,
    server_version: input.serverVersion,
    updated_at: normalizeStoredValue(payload.updated_at ?? occurredAt),
    deleted_at: null,
  };

  if (spec.entityType !== "institution") values.institution_id = institutionId;

  const booleans = new Set(spec.booleanColumns ?? []);
  const jsonColumns = new Set(spec.jsonColumns ?? []);
  for (const column of spec.columns) {
    if (column === "institution_id") continue;
    if (!(column in payload)) continue;
    const raw = payload[column];
    if (raw === undefined) continue;
    if (booleans.has(column)) values[column] = normalizeBoolean(raw, column);
    else if (jsonColumns.has(column)) values[column] = normalizeJson(raw);
    else values[column] = normalizeStoredValue(raw);
  }
  if (spec.entityType === "teacher_session") {
    enrichTeacherSessionLifecycle(db, institutionId, entityId, values);
  }
  if (spec.entityType === "attendance_mark") {
    materializeAttendanceMark(db, institutionId, entityId, payload, values);
    return;
  }
  if (spec.entityType === "class_enrollment") {
    materializeClassEnrollment(db, institutionId, entityId, payload, values);
    return;
  }

  const columns = Object.keys(values);
  const updates = columns
    .filter((column) => column !== "id" && column !== "institution_id")
    .map((column) => `${column} = excluded.${column}`);
  const conflictTarget = spec.entityType === "institution"
    ? "id"
    : "institution_id, id";

  db.prepare(`
    INSERT INTO ${spec.table}(${columns.join(", ")})
    VALUES (${columns.map(() => "?").join(", ")})
    ON CONFLICT(${conflictTarget}) DO UPDATE SET ${updates.join(", ")}
  `).run(...columns.map((column) => values[column]));
}

function enrichTeacherSessionLifecycle(
  db: RelayDatabase,
  institutionId: string,
  entityId: string,
  values: Record<string, unknown>,
) {
  const current = db.prepare(`
    SELECT class_id, subject_id, teacher_id, started_at, actual_call_at, ended_at, period_id,
           session_state, closure_source, closure_confirmation,
           requires_payroll_review, local_lifecycle_managed
    FROM teacher_sessions
    WHERE institution_id = ? AND id = ?
  `).get(institutionId, entityId) as {
    class_id: string;
    subject_id: string;
    teacher_id: string;
    started_at: string;
    actual_call_at: string | null;
    ended_at: string | null;
    period_id: string | null;
    session_state: string;
    closure_source: string | null;
    closure_confirmation: string | null;
    requires_payroll_review: number;
    local_lifecycle_managed: number;
  } | undefined;
  const startedAt = String(values.started_at ?? current?.started_at ?? "").trim();
  if (!startedAt) return;
  const institution = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(timezone), ''), 'Africa/Abidjan') AS timezone
    FROM institutions WHERE id = ?
  `).get(institutionId) as { timezone: string } | undefined;
  if (!institution) return;
  const localStartedAt = localDateTime(startedAt, institution.timezone);
  const sessionDate = localStartedAt.ymd;
  values.session_date = sessionDate;
  values.scheduled_start_at = startedAt;
  values.requested_start_at = values.actual_call_at ?? current?.actual_call_at ?? startedAt;
  values.actual_started_at = values.actual_call_at ?? current?.actual_call_at ?? startedAt;

  let periodId = String(values.period_id ?? current?.period_id ?? "").trim();
  if (!periodId) {
    const classId = String(values.class_id ?? current?.class_id ?? "").trim();
    const subjectId = String(values.subject_id ?? current?.subject_id ?? "").trim();
    const teacherId = String(values.teacher_id ?? current?.teacher_id ?? "").trim();
    if (classId && subjectId && teacherId) {
      const candidates = db.prepare(`
        SELECT tt.period_id, p.weekday, p.start_time, p.end_time
        FROM teacher_timetables tt
        JOIN institution_periods p
          ON p.institution_id = tt.institution_id AND p.id = tt.period_id
        WHERE tt.institution_id = ?
          AND tt.class_id = ?
          AND tt.subject_id = ?
          AND tt.teacher_id = ?
          AND tt.deleted_at IS NULL
          AND p.deleted_at IS NULL
        ORDER BY tt.server_version DESC, tt.updated_at DESC, tt.id DESC
      `).all(institutionId, classId, subjectId, teacherId) as Array<{
        period_id: string;
        weekday: number;
        start_time: string;
        end_time: string;
      }>;
      periodId = candidates.find((candidate) =>
        weekdayMatches(candidate.weekday, localStartedAt.weekday)
        && localStartedAt.minutes >= timeMinutes(candidate.start_time)
        && localStartedAt.minutes < timeMinutes(candidate.end_time)
      )?.period_id ?? "";
    }
  }
  if (periodId) {
    values.period_id = periodId;
    const period = db.prepare(`
      SELECT start_time, end_time FROM institution_periods
      WHERE institution_id = ? AND id = ?
    `).get(institutionId, periodId) as { start_time: string; end_time: string } | undefined;
    if (period) {
      const schedule = scheduledSlotTimes(
        sessionDate,
        period.start_time,
        period.end_time,
        institution.timezone,
      );
      values.scheduled_start_at = schedule.scheduledStartAt;
      values.scheduled_end_at = schedule.scheduledEndAt;
      values.grace_expires_at = schedule.graceExpiresAt;
      if (String(values.origin ?? "").trim() === "class_device" || current?.local_lifecycle_managed === 1) {
        values.local_lifecycle_managed = 1;
      }
    }
  }
  const endedAt = values.ended_at === undefined ? current?.ended_at : values.ended_at;
  if (endedAt) {
    values.session_state = "closed";
    values.closed_at = endedAt;
    if (!current?.closure_source) {
      values.closure_source = "cloud_existing";
      values.closure_confirmation = "confirmed";
      values.requires_payroll_review = 0;
    }
    const scheduledEndMs = new Date(String(values.scheduled_end_at || endedAt)).getTime();
    const endedMs = new Date(String(endedAt)).getTime();
    values.payable_end_at = new Date(Math.min(endedMs, scheduledEndMs)).toISOString();
  } else if (!current) {
    values.session_state = "open";
  }
}

function normalizeBoolean(value: unknown, column: string) {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  throw new Error(`${column}_invalid_boolean`);
}

function normalizeJson(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" ? value : canonicalJson(value);
}

function normalizeStoredValue(value: unknown) {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new Error("materialization_value_invalid");
}

function requiredText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}_required`);
  return text;
}

export function materializeTracked(
  db: RelayDatabase,
  input: {
    institutionId: string;
    entityType: SyncEntityType;
    entityId: string;
    action: SyncAction;
    payload: Record<string, unknown> | null;
    serverVersion: number;
    occurredAt: string;
  },
) {
  try {
    materializeEntity(db, input);
    db.prepare(`
      DELETE FROM sync_materialization_failures
      WHERE institution_id = ? AND entity_type = ? AND entity_id = ?
    `).run(input.institutionId, input.entityType, input.entityId);
    return { materialized: true } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "materialization_failed";
    db.prepare(`
      INSERT INTO sync_materialization_failures(
        institution_id, entity_type, entity_id, action, payload_json,
        server_version, occurred_at, attempts, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(institution_id, entity_type, entity_id) DO UPDATE SET
        action = excluded.action,
        payload_json = excluded.payload_json,
        server_version = excluded.server_version,
        occurred_at = excluded.occurred_at,
        attempts = sync_materialization_failures.attempts + 1,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(
      input.institutionId,
      input.entityType,
      input.entityId,
      input.action,
      input.payload === null ? null : canonicalJson(input.payload),
      input.serverVersion,
      input.occurredAt,
      message,
      new Date().toISOString(),
    );
    return { materialized: false, error: message } as const;
  }
}

export function retryMaterializationFailures(
  db: RelayDatabase,
  institutionId: string,
  limit = 500,
  excludedFailureKeys: ReadonlySet<string> = new Set(),
) {
  const order = new Map(ENTITY_SPECS.map((spec, index) => [spec.entityType, index]));
  const rows = (db.prepare(`
    SELECT institution_id, entity_type, entity_id, action, payload_json,
           server_version, occurred_at
    FROM sync_materialization_failures
    WHERE institution_id = ?
    ORDER BY updated_at, entity_type, entity_id
    LIMIT ?
  `).all(institutionId, Math.max(1, Math.min(2_000, Math.floor(limit)))) as Array<{
    institution_id: string;
    entity_type: SyncEntityType;
    entity_id: string;
    action: SyncAction;
    payload_json: string | null;
    server_version: number;
    occurred_at: string;
  }>).filter((row) =>
    !excludedFailureKeys.has(`${row.entity_type}\u0000${row.entity_id}`)
  );
  rows.sort((a, b) =>
    (order.get(a.entity_type) ?? 999) - (order.get(b.entity_type) ?? 999)
    || a.occurred_at.localeCompare(b.occurred_at),
  );

  let materialized = 0;
  for (const row of rows) {
    let payload: Record<string, unknown> | null = null;
    if (row.payload_json !== null) {
      const parsed = JSON.parse(row.payload_json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      payload = parsed as Record<string, unknown>;
    }
    const result = materializeTracked(db, {
      institutionId: row.institution_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      payload,
      serverVersion: row.server_version,
      occurredAt: row.occurred_at,
    });
    if (result.materialized) materialized += 1;
  }
  return { attempted: rows.length, materialized };
}

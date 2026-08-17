import { attendanceMonitor } from "./attendance-monitor.mjs";
import type { RelayDatabase } from "./db.mjs";
import { getInstitutionMeta } from "./db.mjs";

export function adminDashboard(
  db: RelayDatabase,
  options: { institutionId: string; date: string; now?: Date },
) {
  const institution = db.prepare(`
    SELECT id, name, code, timezone, settings_json
    FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(options.institutionId) as
    | {
        id: string;
        name: string;
        code: string | null;
        timezone: string;
        settings_json: string;
      }
    | undefined;
  if (!institution) throw new Error("institution_not_initialized");

  const scalar = (sql: string, ...params: unknown[]) =>
    Number((db.prepare(sql).get(...params) as { count: number }).count || 0);

  const academicYears = db.prepare(`
    SELECT id, code, label, start_date, end_date, is_current
    FROM academic_years
    WHERE institution_id = ? AND deleted_at IS NULL
    ORDER BY is_current DESC, start_date DESC, code DESC, id
  `).all(options.institutionId).map((row) => {
    const value = row as Record<string, unknown>;
    return { ...value, is_current: Boolean(value.is_current) };
  });

  const currentYear = (academicYears.find((row) => row.is_current === true) ||
    academicYears[0] || null) as
    | {
        id: string;
        code: string;
        label: string;
        start_date: string | null;
        end_date: string | null;
        is_current: boolean;
      }
    | null;

  const gradingPeriods = db.prepare(`
    SELECT id, academic_year, code, label, short_label, kind,
           start_date, end_date, order_index, is_active, coeff,
           scope_type, education_type, formation_code, display_code,
           profile_period_key
    FROM grade_periods
    WHERE institution_id = ? AND deleted_at IS NULL
    ORDER BY academic_year DESC, order_index ASC, start_date ASC, id
  `).all(options.institutionId).map((row) => {
    const value = row as Record<string, unknown>;
    return { ...value, is_active: Boolean(value.is_active) };
  });

  const rows = attendanceMonitor(db, {
    institutionId: options.institutionId,
    from: options.date,
    to: options.date,
    ...(options.now ? { now: options.now } : {}),
  });
  const attendance = {
    total: rows.length,
    ok: rows.filter((row) => row.status === "ok").length,
    late: rows.filter((row) => row.status === "late").length,
    missing: rows.filter((row) => row.status === "missing").length,
    pending_absence: rows.filter((row) => row.status === "pending_absence").length,
    justified_absence: rows.filter((row) => row.status === "justified_absence").length,
  };
  const cloudPushState = db.prepare(`
    SELECT last_error_at, last_error
    FROM sync_cursors
    WHERE institution_id = ? AND stream = 'cloud_push'
  `).get(options.institutionId) as {
    last_error_at: string | null;
    last_error: string | null;
  } | undefined;
  const sessionReviews = db.prepare(`
    SELECT ts.id AS session_id,
           COALESCE(NULLIF(TRIM(profile.display_name), ''), 'Enseignant') AS teacher_name,
           subject.name AS subject_name,
           class.label AS class_label,
           period.label AS period_label,
           period.start_time, period.end_time,
           ts.closure_source, ts.closure_confirmation,
           ts.scheduled_start_at, ts.scheduled_end_at,
           ts.payable_end_at, ts.attendance_snapshot_status,
           MAX(0, CAST(ROUND(
             (julianday(ts.payable_end_at) - julianday(ts.scheduled_start_at)) * 24 * 60
           ) AS INTEGER)) AS proposed_minutes
    FROM teacher_sessions ts
    JOIN profiles profile
      ON profile.institution_id = ts.institution_id AND profile.id = ts.teacher_id
    JOIN subjects subject
      ON subject.institution_id = ts.institution_id AND subject.id = ts.subject_id
    JOIN classes class
      ON class.institution_id = ts.institution_id AND class.id = ts.class_id
    LEFT JOIN institution_periods period
      ON period.institution_id = ts.institution_id AND period.id = ts.period_id
    WHERE ts.institution_id = ? AND ts.requires_payroll_review = 1
      AND ts.deleted_at IS NULL
    ORDER BY ts.closed_at DESC, ts.id
  `).all(options.institutionId).map((row) => ({
    ...(row as Record<string, unknown>),
    proposed_amount: null,
    proposed_amount_status: "cloud_calculation_required",
  }));

  const rosterClasses = db.prepare(`
    SELECT id, label AS name, label, level, code, academic_year,
           official_track_code, education_type, formation_code,
           formation_level_code
    FROM classes
    WHERE institution_id = ?
      AND deleted_at IS NULL
      AND (? IS NULL OR academic_year = ?)
    ORDER BY level, label, id
  `).all(
    options.institutionId,
    currentYear?.code ?? null,
    currentYear?.code ?? null,
  ) as Array<Record<string, unknown>>;

  const rosterStudents = db.prepare(`
    SELECT student.id,
           student.first_name,
           student.last_name,
           student.display_name AS full_name,
           student.registration_number AS matricule,
           enrollment.class_id,
           class.label AS class_label,
           class.level,
           class.academic_year,
           student.birthdate,
           student.birthdate AS birth_date,
           student.birth_place,
           student.nationality,
           student.gender,
           student.regime,
           student.is_repeater,
           student.is_affecte,
           student.is_boarder
    FROM class_enrollments enrollment
    JOIN students student
      ON student.institution_id = enrollment.institution_id
     AND student.id = enrollment.student_id
    JOIN classes class
      ON class.institution_id = enrollment.institution_id
     AND class.id = enrollment.class_id
    WHERE enrollment.institution_id = ?
      AND enrollment.deleted_at IS NULL
      AND enrollment.end_date IS NULL
      AND student.deleted_at IS NULL
      AND student.is_active = 1
      AND class.deleted_at IS NULL
      AND (? IS NULL OR class.academic_year = ?)
    ORDER BY class.label, student.display_name, student.id
  `).all(
    options.institutionId,
    currentYear?.code ?? null,
    currentYear?.code ?? null,
  ).map((row) => {
    const value = row as Record<string, unknown>;
    return {
      ...value,
      is_repeater: Boolean(value.is_repeater),
      is_affecte: Boolean(value.is_affecte),
      is_boarder: Boolean(value.is_boarder),
      photo_url: null,
      student_photo_url: null,
    };
  });

  let institutionSettings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(institution.settings_json || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      institutionSettings = parsed as Record<string, unknown>;
    }
  } catch {
    institutionSettings = {};
  }
  institutionSettings = {
    ...institutionSettings,
    institution_name:
      institutionSettings.institution_name || institution.name || null,
    name: institutionSettings.name || institution.name || null,
    institution_code:
      institutionSettings.institution_code || institution.code || null,
  };

  return {
    source: "relay",
    generated_at: new Date().toISOString(),
    institution: {
      id: institution.id,
      name: institution.name,
      code: institution.code,
      timezone: institution.timezone,
    },
    academic_year: currentYear,
    roster: {
      academic_year: currentYear?.code ?? null,
      academic_years: academicYears,
      grading_periods: gradingPeriods,
      classes: rosterClasses,
      students: rosterStudents,
      institution_settings: institutionSettings,
    },
    counts: {
      students: scalar(
        "SELECT COUNT(*) AS count FROM students WHERE institution_id = ? AND is_active = 1 AND deleted_at IS NULL",
        options.institutionId,
      ),
      classes: scalar(
        "SELECT COUNT(*) AS count FROM classes WHERE institution_id = ? AND deleted_at IS NULL",
        options.institutionId,
      ),
      teachers: scalar(`
        SELECT COUNT(DISTINCT p.id) AS count
        FROM profiles p
        JOIN user_roles r ON r.profile_id = p.id AND r.institution_id = p.institution_id
        WHERE p.institution_id = ? AND p.is_active = 1 AND p.deleted_at IS NULL
          AND r.role = 'teacher' AND r.deleted_at IS NULL
      `, options.institutionId),
      documents: scalar(
        "SELECT COUNT(*) AS count FROM offline_documents WHERE institution_id = ? AND deleted_at IS NULL",
        options.institutionId,
      ),
    },
    attendance,
    attendance_rows: rows,
    session_reviews: {
      count: sessionReviews.length,
      items: sessionReviews,
    },
    sync: {
      pending_operations: scalar(
        "SELECT COUNT(*) AS count FROM sync_outbox WHERE institution_id = ? AND state IN ('pending', 'sending')",
        options.institutionId,
      ),
      blocked_operations: scalar(
        "SELECT COUNT(*) AS count FROM sync_outbox WHERE institution_id = ? AND state = 'blocked'",
        options.institutionId,
      ),
      unresolved_conflicts: scalar(
        "SELECT COUNT(*) AS count FROM sync_conflicts WHERE institution_id = ? AND resolved_at IS NULL",
        options.institutionId,
      ),
      materialization_failures: scalar(
        "SELECT COUNT(*) AS count FROM sync_materialization_failures WHERE institution_id = ?",
        options.institutionId,
      ),
      last_cloud_sync_at: getInstitutionMeta(
        db,
        options.institutionId,
        "last_cloud_sync_at",
      ),
      last_cloud_sync_error_at: cloudPushState?.last_error_at || null,
      last_cloud_sync_error: cloudPushState?.last_error || null,
    },
  };
}

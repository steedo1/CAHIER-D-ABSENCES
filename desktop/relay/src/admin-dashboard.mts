import { attendanceMonitor } from "./attendance-monitor.mjs";
import type { RelayDatabase } from "./db.mjs";
import { getInstitutionMeta } from "./db.mjs";

export function adminDashboard(
  db: RelayDatabase,
  options: { institutionId: string; date: string; now?: Date },
) {
  const institution = db.prepare(`
    SELECT id, name, code, timezone
    FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(options.institutionId) as
    | { id: string; name: string; code: string | null; timezone: string }
    | undefined;
  if (!institution) throw new Error("institution_not_initialized");

  const scalar = (sql: string, ...params: unknown[]) =>
    Number((db.prepare(sql).get(...params) as { count: number }).count || 0);
  const currentYear = db.prepare(`
    SELECT id, code, label, start_date, end_date
    FROM academic_years
    WHERE institution_id = ? AND is_current = 1 AND deleted_at IS NULL
    LIMIT 1
  `).get(options.institutionId) ?? null;
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

  return {
    source: "relay",
    generated_at: new Date().toISOString(),
    institution,
    academic_year: currentYear,
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

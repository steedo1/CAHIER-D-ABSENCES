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
    },
  };
}

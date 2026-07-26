import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { localDateTime, scheduledSlotTimes } from "./teacher-session-rules.mjs";

const MIGRATIONS = [
  { version: 1, name: "core", file: "0001_core.sql" },
  { version: 2, name: "bootstrap_dashboard", file: "0002_bootstrap_dashboard.sql" },
  { version: 3, name: "bootstrap_diagnostics", file: "0003_bootstrap_diagnostics.sql" },
  { version: 4, name: "multi_school_partitioning", file: "0004_multi_school_partitioning.sql" },
  { version: 5, name: "teacher_attendance_operations", file: "0005_teacher_attendance_operations.sql" },
  { version: 6, name: "teacher_session_open", file: "0006_teacher_session_open.sql" },
  { version: 7, name: "teacher_session_close_transition", file: "0007_teacher_session_close_transition.sql" },
] as const;

export type RelayDatabase = Database.Database;

export function openRelayDatabase(path: string): RelayDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("wal_autocheckpoint = 1000");
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function migrate(db: RelayDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relay_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  const applied = db
    .prepare("SELECT version FROM schema_migrations")
    .all()
    .map((row) => Number((row as { version: number }).version));
  const appliedVersions = new Set(applied);

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    const file = fileURLToPath(new URL(`../migrations/${migration.file}`, import.meta.url));
    const sql = readFileSync(file, "utf8");
    if (migration.version === 4) assertSchema3CanMigrateTo4(db);
    if (migration.version === 7) assertSchema6CanMigrateTo7(db);
    const apply = db.transaction(() => {
      db.exec(sql);
      if (migration.version === 7) finalizeSchema7Migration(db);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, new Date().toISOString());
      const violations = db.pragma("foreign_key_check") as Array<Record<string, unknown>>;
      if (violations.length > 0) {
        throw new Error(`relay_database_foreign_key_violation:${JSON.stringify(violations[0])}`);
      }
    });
    if (migration.version === 4) {
      db.pragma("foreign_keys = OFF");
      try {
        apply();
      } finally {
        db.pragma("foreign_keys = ON");
      }
    } else {
      apply();
    }
  }

  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) throw new Error("relay_database_foreign_key_violation");
}

function assertSchema6CanMigrateTo7(db: RelayDatabase) {
  const rows = db.prepare(`
    SELECT ts.id, ts.institution_id, ts.class_id, ts.period_id, ts.started_at,
           COALESCE(NULLIF(TRIM(i.timezone), ''), 'Africa/Abidjan') AS timezone
    FROM teacher_sessions ts
    JOIN institutions i ON i.id = ts.institution_id
    WHERE ts.deleted_at IS NULL AND ts.period_id IS NOT NULL
    ORDER BY ts.institution_id, ts.id
  `).all() as Array<{
    id: string;
    institution_id: string;
    class_id: string;
    period_id: string;
    started_at: string;
    timezone: string;
  }>;
  const occupied = new Map<string, string>();
  for (const row of rows) {
    let sessionDate: string;
    try {
      sessionDate = localDateTime(row.started_at, row.timezone).ymd;
    } catch {
      throw new Error(
        `migration_v7_preflight:session_time_invalid:institution_id=${row.institution_id}` +
        `:session_id=${row.id}`,
      );
    }
    const key = [row.institution_id, row.class_id, sessionDate, row.period_id].join("\u0000");
    const previous = occupied.get(key);
    if (previous) {
      throw new Error(
        `migration_v7_preflight:duplicate_class_date_period` +
        `:institution_id=${row.institution_id}:class_id=${row.class_id}` +
        `:session_date=${sessionDate}:period_id=${row.period_id}` +
        `:session_ids=${previous},${row.id}`,
      );
    }
    occupied.set(key, row.id);
  }
}

function finalizeSchema7Migration(db: RelayDatabase) {
  const rows = db.prepare(`
    SELECT ts.id, ts.institution_id, ts.started_at, ts.actual_call_at,
           ts.ended_at, ts.period_id,
           COALESCE(NULLIF(TRIM(i.timezone), ''), 'Africa/Abidjan') AS timezone,
           p.start_time, p.end_time,
           EXISTS(
             SELECT 1 FROM teacher_session_open_operations op
             WHERE op.institution_id = ts.institution_id
               AND op.local_session_id = ts.id
           ) AS managed_locally,
           EXISTS(
             SELECT 1 FROM teacher_attendance_operations attendance
             WHERE attendance.institution_id = ts.institution_id
               AND attendance.session_id = ts.id
           ) AS has_attendance
    FROM teacher_sessions ts
    JOIN institutions i ON i.id = ts.institution_id
    LEFT JOIN institution_periods p
      ON p.institution_id = ts.institution_id AND p.id = ts.period_id
    ORDER BY ts.institution_id, ts.id
  `).all() as Array<{
    id: string;
    institution_id: string;
    started_at: string;
    actual_call_at: string | null;
    ended_at: string | null;
    period_id: string | null;
    timezone: string;
    start_time: string | null;
    end_time: string | null;
    managed_locally: number;
    has_attendance: number;
  }>;
  const update = db.prepare(`
    UPDATE teacher_sessions
    SET session_date = ?, session_state = ?, scheduled_start_at = ?,
        requested_start_at = ?, actual_started_at = ?, scheduled_end_at = ?,
        finalizing_at = ?, grace_expires_at = ?, closed_at = ?,
        payable_end_at = ?, closure_source = ?, closure_confirmation = ?,
        requires_payroll_review = 0, local_lifecycle_managed = ?,
        attendance_snapshot_status = ?
    WHERE institution_id = ? AND id = ?
  `);
  for (const row of rows) {
    const sessionDate = localDateTime(row.started_at, row.timezone).ymd;
    const schedule = row.period_id && row.start_time && row.end_time
      ? scheduledSlotTimes(sessionDate, row.start_time, row.end_time, row.timezone)
      : null;
    const scheduledStartAt = schedule?.scheduledStartAt || row.started_at;
    const scheduledEndAt = schedule?.scheduledEndAt || row.ended_at || row.started_at;
    const ended = row.ended_at ? new Date(row.ended_at) : null;
    const scheduledEnd = new Date(scheduledEndAt);
    const payableEndAt = ended && Number.isFinite(ended.getTime())
      ? new Date(Math.min(ended.getTime(), scheduledEnd.getTime())).toISOString()
      : null;
    update.run(
      sessionDate,
      row.ended_at ? "closed" : "open",
      scheduledStartAt,
      row.actual_call_at || row.started_at,
      row.actual_call_at || row.started_at,
      scheduledEndAt,
      row.ended_at ? scheduledEndAt : null,
      schedule?.graceExpiresAt || new Date(scheduledEnd.getTime() + 10 * 60_000).toISOString(),
      row.ended_at,
      payableEndAt,
      row.ended_at ? "cloud_existing" : null,
      row.ended_at ? "confirmed" : null,
      row.managed_locally ? 1 : 0,
      row.has_attendance ? "partial" : "none",
      row.institution_id,
      row.id,
    );
  }
  db.exec(`
    CREATE UNIQUE INDEX teacher_sessions_one_class_date_period
      ON teacher_sessions(institution_id, class_id, session_date, period_id)
      WHERE deleted_at IS NULL AND session_date IS NOT NULL AND period_id IS NOT NULL;
  `);
}

export function schemaVersion(db: RelayDatabase) {
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };
  return Number(row.version || 0);
}

export function setMeta(db: RelayDatabase, key: string, value: string | null) {
  db.prepare(`
    INSERT INTO relay_meta(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

export function getMeta(db: RelayDatabase, key: string) {
  const row = db.prepare("SELECT value FROM relay_meta WHERE key = ?").get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

export function setInstitutionMeta(
  db: RelayDatabase,
  institutionId: string,
  key: string,
  value: string | null,
) {
  db.prepare(`
    INSERT INTO relay_institution_meta(institution_id, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(institution_id, key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(institutionId, key, value, new Date().toISOString());
}

export function getInstitutionMeta(
  db: RelayDatabase,
  institutionId: string,
  key: string,
) {
  const row = db.prepare(`
    SELECT value FROM relay_institution_meta
    WHERE institution_id = ? AND key = ?
  `).get(institutionId, key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function latestInstitutionMeta(db: RelayDatabase, key: string) {
  const row = db.prepare(`
    SELECT value FROM relay_institution_meta
    WHERE key = ? AND value IS NOT NULL
    ORDER BY value DESC
    LIMIT 1
  `).get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

type ScopedRelation = {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn?: string;
};

const SCOPED_TABLES_V3 = [
  "academic_years",
  "profiles",
  "user_roles",
  "classes",
  "subjects",
  "teacher_subjects",
  "students",
  "class_enrollments",
  "institution_periods",
  "teacher_timetables",
  "teacher_absence_requests",
  "teacher_sessions",
  "attendance_marks",
  "grade_periods",
  "grade_evaluations",
  "student_grades",
  "textbook_assignments",
  "textbook_items",
  "textbook_sessions",
  "textbook_completions",
  "offline_documents",
  "sync_records",
  "sync_outbox",
  "sync_inbox",
  "sync_cursors",
  "sync_conflicts",
  "relay_devices",
  "audit_log",
  "sync_bootstrap_runs",
  "sync_materialization_failures",
] as const;

const SCOPED_RELATIONS_V3: readonly ScopedRelation[] = [
  { childTable: "user_roles", childColumn: "profile_id", parentTable: "profiles" },
  { childTable: "teacher_subjects", childColumn: "teacher_id", parentTable: "profiles" },
  { childTable: "teacher_subjects", childColumn: "subject_id", parentTable: "subjects" },
  { childTable: "class_enrollments", childColumn: "class_id", parentTable: "classes" },
  { childTable: "class_enrollments", childColumn: "student_id", parentTable: "students" },
  { childTable: "teacher_timetables", childColumn: "class_id", parentTable: "classes" },
  { childTable: "teacher_timetables", childColumn: "subject_id", parentTable: "subjects" },
  { childTable: "teacher_timetables", childColumn: "teacher_id", parentTable: "profiles" },
  { childTable: "teacher_timetables", childColumn: "period_id", parentTable: "institution_periods" },
  { childTable: "teacher_absence_requests", childColumn: "teacher_id", parentTable: "profiles" },
  { childTable: "teacher_sessions", childColumn: "class_id", parentTable: "classes" },
  { childTable: "teacher_sessions", childColumn: "subject_id", parentTable: "subjects" },
  { childTable: "teacher_sessions", childColumn: "teacher_id", parentTable: "profiles" },
  { childTable: "teacher_sessions", childColumn: "period_id", parentTable: "institution_periods" },
  { childTable: "attendance_marks", childColumn: "session_id", parentTable: "teacher_sessions" },
  { childTable: "attendance_marks", childColumn: "student_id", parentTable: "students" },
  { childTable: "grade_evaluations", childColumn: "class_id", parentTable: "classes" },
  { childTable: "grade_evaluations", childColumn: "subject_id", parentTable: "subjects" },
  { childTable: "grade_evaluations", childColumn: "teacher_id", parentTable: "profiles" },
  { childTable: "grade_evaluations", childColumn: "grade_period_id", parentTable: "grade_periods" },
  { childTable: "student_grades", childColumn: "evaluation_id", parentTable: "grade_evaluations" },
  { childTable: "student_grades", childColumn: "student_id", parentTable: "students" },
  { childTable: "textbook_assignments", childColumn: "class_id", parentTable: "classes" },
  { childTable: "textbook_assignments", childColumn: "subject_id", parentTable: "subjects" },
  { childTable: "textbook_assignments", childColumn: "teacher_id", parentTable: "profiles" },
  { childTable: "textbook_items", childColumn: "assignment_id", parentTable: "textbook_assignments" },
  { childTable: "textbook_sessions", childColumn: "assignment_id", parentTable: "textbook_assignments" },
  { childTable: "textbook_sessions", childColumn: "item_id", parentTable: "textbook_items" },
  { childTable: "textbook_sessions", childColumn: "teacher_id", parentTable: "profiles" },
  { childTable: "textbook_sessions", childColumn: "period_id", parentTable: "institution_periods" },
  { childTable: "textbook_completions", childColumn: "assignment_id", parentTable: "textbook_assignments" },
  { childTable: "textbook_completions", childColumn: "item_id", parentTable: "textbook_items" },
  { childTable: "sync_conflicts", childColumn: "event_id", parentTable: "sync_inbox", parentColumn: "event_id" },
] as const;

function assertSchema3CanMigrateTo4(db: RelayDatabase) {
  for (const table of SCOPED_TABLES_V3) {
    const invalid = db.prepare(`
      SELECT rowid AS row_id, institution_id
      FROM ${table}
      WHERE institution_id IS NULL OR TRIM(institution_id) = ''
      LIMIT 1
    `).get() as { row_id: number; institution_id: string | null } | undefined;
    if (invalid) {
      throw new Error(
        `migration_v4_preflight:institution_id_missing:table=${table}:row=${invalid.row_id}`,
      );
    }
    const unknownInstitution = db.prepare(`
      SELECT child.rowid AS row_id, child.institution_id
      FROM ${table} child
      LEFT JOIN institutions parent ON parent.id = child.institution_id
      WHERE parent.id IS NULL
      LIMIT 1
    `).get() as { row_id: number; institution_id: string } | undefined;
    if (unknownInstitution) {
      throw new Error(
        `migration_v4_preflight:institution_missing:table=${table}:row=${unknownInstitution.row_id}` +
        `:institution_id=${unknownInstitution.institution_id}`,
      );
    }
  }

  for (const relation of SCOPED_RELATIONS_V3) {
    const parentColumn = relation.parentColumn ?? "id";
    const invalid = db.prepare(`
      SELECT child.rowid AS row_id,
             child.institution_id AS child_institution_id,
             child.${relation.childColumn} AS dependency_id,
             parent.institution_id AS parent_institution_id
      FROM ${relation.childTable} child
      LEFT JOIN ${relation.parentTable} parent
        ON parent.${parentColumn} = child.${relation.childColumn}
      WHERE child.${relation.childColumn} IS NOT NULL
        AND (parent.${parentColumn} IS NULL OR parent.institution_id <> child.institution_id)
      LIMIT 1
    `).get() as {
      row_id: number;
      child_institution_id: string;
      dependency_id: string;
      parent_institution_id: string | null;
    } | undefined;
    if (invalid) {
      throw new Error(
        `migration_v4_preflight:dependency_invalid:table=${relation.childTable}` +
        `:row=${invalid.row_id}:institution_id=${invalid.child_institution_id}` +
        `:field=${relation.childColumn}:dependency_table=${relation.parentTable}` +
        `:dependency_id=${invalid.dependency_id}` +
        `:dependency_institution_id=${invalid.parent_institution_id ?? "missing"}`,
      );
    }
  }

  const invalidScopedMeta = db.prepare(`
    SELECT m.key
    FROM relay_meta m
    LEFT JOIN institutions i
      ON i.id = CASE
        WHEN m.key LIKE 'relay_device_id:%'
          THEN substr(m.key, length('relay_device_id:') + 1)
        WHEN m.key LIKE 'last_cloud_sync_at:%'
          THEN substr(m.key, length('last_cloud_sync_at:') + 1)
      END
    WHERE (m.key LIKE 'relay_device_id:%' OR m.key LIKE 'last_cloud_sync_at:%')
      AND i.id IS NULL
    LIMIT 1
  `).get() as { key: string } | undefined;
  if (invalidScopedMeta) {
    throw new Error(`migration_v4_preflight:institution_meta_unknown:${invalidScopedMeta.key}`);
  }

  const invalidScopedDevice = db.prepare(`
    SELECT m.key, m.value
    FROM relay_meta m
    JOIN institutions i
      ON i.id = substr(m.key, length('relay_device_id:') + 1)
    LEFT JOIN relay_devices d
      ON d.id = m.value AND d.institution_id = i.id
    WHERE m.key LIKE 'relay_device_id:%' AND d.id IS NULL
    LIMIT 1
  `).get() as { key: string; value: string | null } | undefined;
  if (invalidScopedDevice) {
    throw new Error(`migration_v4_preflight:relay_device_meta_invalid:${invalidScopedDevice.key}`);
  }

  const globalDevice = getMeta(db, "relay_device_id");
  if (globalDevice) {
    const owner = db.prepare(`
      SELECT institution_id FROM relay_devices WHERE id = ?
    `).get(globalDevice) as { institution_id: string } | undefined;
    if (!owner) throw new Error("migration_v4_preflight:relay_device_meta_unresolved");
  }

  const globalCloudSync = getMeta(db, "last_cloud_sync_at");
  const institutionCount = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM institutions").get() as { count: number }).count,
  );
  if (globalCloudSync && institutionCount > 1) {
    const missingScoped = db.prepare(`
      SELECT i.id
      FROM institutions i
      LEFT JOIN relay_meta m ON m.key = 'last_cloud_sync_at:' || i.id
      WHERE m.key IS NULL
      LIMIT 1
    `).get() as { id: string } | undefined;
    if (missingScoped) {
      throw new Error(
        `migration_v4_preflight:ambiguous_global_last_cloud_sync_at:missing_institution=${missingScoped.id}`,
      );
    }
  }
}

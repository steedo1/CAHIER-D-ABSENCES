import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = [
  { version: 1, name: "core", file: "0001_core.sql" },
  { version: 2, name: "bootstrap_dashboard", file: "0002_bootstrap_dashboard.sql" },
  { version: 3, name: "bootstrap_diagnostics", file: "0003_bootstrap_diagnostics.sql" },
  { version: 4, name: "multi_school_partitioning", file: "0004_multi_school_partitioning.sql" },
  { version: 5, name: "teacher_attendance_operations", file: "0005_teacher_attendance_operations.sql" },
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
    const apply = db.transaction(() => {
      db.exec(sql);
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

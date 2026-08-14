import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Database from "better-sqlite3";
import {
  ACADEMIC_REQUIRED_COLLECTIONS,
  applyBootstrap,
} from "../src/bootstrap.mjs";
import {
  getInstitutionMeta,
  openRelayDatabase,
  schemaVersion,
} from "../src/db.mjs";
import { RelayStore } from "../src/store.mjs";

const INSTITUTION_ID = "academic-school";
const NOW = "2026-08-13T10:00:00.000Z";

function completeAcademicSnapshot(
  revision: number,
  snapshotId = `academic-${revision}`,
  institutionId = INSTITUTION_ID,
) {
  const entities = Object.fromEntries(
    ACADEMIC_REQUIRED_COLLECTIONS.map((collection) => [collection, []]),
  ) as Record<string, Array<Record<string, unknown>>>;
  entities.academic_years = [{
    id: "year-1", institution_id: institutionId, code: "2026-2027",
    label: "2026-2027", start_date: "2026-09-01", end_date: "2027-07-31",
    is_current: true, updated_at: NOW,
  }];
  entities.profiles = [{
    id: "teacher-1", institution_id: institutionId, display_name: "Professeur",
    is_active: true, updated_at: NOW,
  }];
  entities.classes = [{
    id: "class-1", institution_id: institutionId, academic_year: "2026-2027",
    label: "6e A", level: "6e", updated_at: NOW,
  }];
  entities.subjects = [{
    id: "subject-1", institution_id: institutionId, name: "Mathématiques",
    short_name: "MATH", updated_at: NOW,
  }];
  entities.teacher_subjects = [{
    id: "teacher-subject-1", institution_id: institutionId,
    teacher_id: "teacher-1", subject_id: "subject-1", updated_at: NOW,
  }];
  entities.class_teachers = [{
    id: "class-teacher-1", institution_id: institutionId, class_id: "class-1",
    subject_id: "subject-1", teacher_id: "teacher-1", start_date: "2026-09-01",
    updated_at: NOW,
  }];
  entities.students = [{
    id: "student-1", institution_id: institutionId, registration_number: "M001",
    display_name: "Élève Test", is_active: true, updated_at: NOW,
  }];
  entities.class_enrollments = [{
    id: "enrollment-1", institution_id: institutionId, class_id: "class-1",
    student_id: "student-1", start_date: "2026-09-01", updated_at: NOW,
  }];
  entities.grade_periods = [{
    id: "period-1", institution_id: institutionId, academic_year: "2026-2027",
    code: "T1", label: "Trimestre 1", start_date: "2026-09-01",
    end_date: "2026-12-20", is_locked: false, is_active: true, coeff: 1,
    updated_at: NOW,
  }];
  entities.institution_subject_coeffs = [{
    id: "coeff-1", institution_id: institutionId, level: "6e",
    subject_id: "subject-1", coeff: 2, include_in_average: true, updated_at: NOW,
  }];
  entities.grade_evaluations = [{
    id: "evaluation-1", institution_id: institutionId, class_id: "class-1",
    subject_id: "subject-1", teacher_id: "teacher-1", grade_period_id: "period-1",
    grading_period_id: "period-1", title: "Devoir 1", evaluation_date: "2026-10-10",
    max_score: 20, coefficient: 1, is_published: true, is_locked: false,
    publication_status: "published", publication_version: 1, updated_at: NOW,
  }];
  entities.student_grades = [{
    id: "grade-1", institution_id: institutionId, evaluation_id: "evaluation-1",
    student_id: "student-1", score: 15, comment: null, updated_at: NOW,
  }];
  entities.grade_published_scores = [{
    id: "published-1", institution_id: institutionId, class_id: "class-1",
    evaluation_id: "evaluation-1", student_id: "student-1", subject_id: "subject-1",
    eval_date: "2026-10-10", eval_kind: "devoir", score: 15, scale: 20, coeff: 1,
    publication_version: 1, is_current: true, published_at: NOW, updated_at: NOW,
  }];

  return {
    protocol_version: 1,
    snapshot_id: snapshotId,
    institution_id: institutionId,
    snapshot_revision: 7,
    academic_revision: revision,
    snapshot_completeness: "complete",
    generated_at: NOW,
    cursor: NOW,
    schedule_manifest: { class_teachers: [] },
    academic_manifest: {
      required_collections: [...ACADEMIC_REQUIRED_COLLECTIONS],
      collection_counts: Object.fromEntries(
        ACADEMIC_REQUIRED_COLLECTIONS.map((collection) => [collection, entities[collection]!.length]),
      ),
    },
    institution: {
      id: institutionId, name: `École ${institutionId}`, code: institutionId,
      timezone: "Africa/Abidjan", settings_json: {}, updated_at: NOW,
    },
    entities,
    diagnostics: { skipped_count: 0 },
  };
}

test("base neuve: migration académique v9 sans table Finance", () => {
  const db = openRelayDatabase(":memory:");
  try {
    assert.equal(schemaVersion(db), 9);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
    assert.ok(names.includes("grade_published_scores"));
    assert.ok(names.includes("conduct_events"));
    assert.equal(names.some((name) => /finance|payment|receipt|payroll|expense|budget|charge|debt/i.test(name)), false);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }
});

test("vraie base schéma 8: migration v9 préserve les données historiques", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-schema8-to-9-"));
  const databasePath = join(directory, "schema8.db");
  try {
    const schema8 = createSchema8Fixture(databasePath);
    schema8.prepare(`
      INSERT INTO institutions(id, name, code, timezone, settings_json, updated_at)
      VALUES ('legacy-school', 'École historique', 'LEGACY', 'Africa/Abidjan', '{}', ?)
    `).run(NOW);
    schema8.prepare(`
      INSERT INTO students(id, institution_id, display_name, is_active, updated_at)
      VALUES ('legacy-student', 'legacy-school', 'Élève historique', 1, ?)
    `).run(NOW);
    assert.equal(schemaVersion(schema8), 8);
    schema8.close();

    const migrated = openRelayDatabase(databasePath);
    assert.equal(schemaVersion(migrated), 9);
    assert.equal(Number((migrated.prepare("SELECT COUNT(*) AS count FROM students WHERE id = 'legacy-student'").get() as { count: number }).count), 1);
    assert.deepEqual(migrated.pragma("foreign_key_check"), []);
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("échec injecté de migration v9: retour atomique au schéma 8", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-schema9-rollback-"));
  const databasePath = join(directory, "schema8.db");
  try {
    const schema8 = createSchema8Fixture(databasePath);
    schema8.exec(`
      CREATE TRIGGER reject_schema_9
      BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 9
      BEGIN
        SELECT RAISE(ABORT, 'injected_schema9_failure');
      END;
    `);
    schema8.close();
    assert.throws(() => openRelayDatabase(databasePath), /injected_schema9_failure/);
    const inspected = new Database(databasePath, { readonly: true, fileMustExist: true });
    assert.equal(schemaVersion(inspected), 8);
    assert.equal(inspected.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'grade_published_scores'").get(), undefined);
    assert.equal((inspected.pragma("table_info(students)") as Array<{ name: string }>).some((row) => row.name === "birth_place"), false);
    assert.deepEqual(inspected.pragma("foreign_key_check"), []);
    inspected.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createSchema8Fixture(databasePath: string) {
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE relay_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  const migrations = [
    [1, "core", "0001_core.sql"],
    [2, "bootstrap_dashboard", "0002_bootstrap_dashboard.sql"],
    [3, "bootstrap_diagnostics", "0003_bootstrap_diagnostics.sql"],
    [4, "multi_school_partitioning", "0004_multi_school_partitioning.sql"],
    [5, "teacher_attendance_operations", "0005_teacher_attendance_operations.sql"],
    [6, "teacher_session_open", "0006_teacher_session_open.sql"],
    [7, "teacher_session_close_transition", "0007_teacher_session_close_transition.sql"],
    [8, "teacher_timetable_identity", "0008_teacher_timetable_identity.sql"],
  ] as const;
  for (const [version, name, file] of migrations) {
    const apply = db.transaction(() => {
      db.exec(readFileSync(
        fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)),
        "utf8",
      ));
      if (version === 7) {
        db.exec(`
          CREATE UNIQUE INDEX teacher_sessions_one_class_date_period
            ON teacher_sessions(institution_id, class_id, session_date, period_id)
            WHERE deleted_at IS NULL AND session_date IS NOT NULL AND period_id IS NOT NULL;
        `);
      }
      db.prepare(`
        INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)
      `).run(version, name, NOW);
    });
    if (version === 4 || version === 8) {
      db.pragma("foreign_keys = OFF");
      apply();
      db.pragma("foreign_keys = ON");
    } else {
      apply();
    }
  }
  return db;
}

test("preuve statique: snapshot Cloud autonome, lecture seule vers le relais et aucune Finance", () => {
  const builder = readFileSync(
    join(process.cwd(), "..", "..", "src", "lib", "relay-bootstrap-snapshot.ts"),
    "utf8",
  );
  const pullRoute = readFileSync(
    join(process.cwd(), "..", "..", "src", "app", "api", "relay", "sync", "pull", "route.ts"),
    "utf8",
  );
  assert.doesNotMatch(builder, /fetch\s*\(|local-relay|relay_url/i);
  assert.doesNotMatch(pullRoute, /local-relay|relay_url/i);
  assert.doesNotMatch(builder, /\.from\(["'][^"']*(finance|payment|receipt|payroll|expense|budget|charge|debt)/i);
  assert.doesNotMatch(builder, /\.insert\s*\(|\.upsert\s*\(|\.update\s*\(|\.delete\s*\(/);
});

test("preuve statique: revision academique exhaustive, distincte du planning et hors Finance", () => {
  const migration = readFileSync(
    join(process.cwd(), "..", "..", "migrations", "20260813_relay_academic_revision_v1.sql"),
    "utf8",
  );
  const builder = readFileSync(
    join(process.cwd(), "..", "..", "src", "lib", "relay-bootstrap-snapshot.ts"),
    "utf8",
  );
  const pullRoute = readFileSync(
    join(process.cwd(), "..", "..", "src", "app", "api", "relay", "sync", "pull", "route.ts"),
    "utf8",
  );
  const expectedAcademicSources = [
    "institutions", "academic_years", "profiles", "user_roles", "classes",
    "institution_subjects", "subjects", "teacher_subjects", "class_teachers",
    "educator_class_assignments", "students", "class_enrollments",
    "grade_periods", "institution_level_subjects", "institution_subject_coeffs",
    "institution_subject_grade_policies", "grade_subject_components", "grade_evaluations",
    "student_grades", "grade_published_scores", "grade_publication_events", "grade_adjustments",
    "grade_evaluation_locks", "institution_grade_publication_settings", "bulletin_subject_groups",
    "bulletin_subject_group_items", "bulletin_nc_overrides", "core_subject_weights",
    "institution_conduct_policies", "conduct_settings", "conduct_events", "conduct_penalties",
    "student_penalties", "conduct_average_overrides", "conduct_rubric_overrides",
    "teacher_signatures",
  ];
  for (const table of expectedAcademicSources) {
    assert.match(migration, new RegExp(`(?:'${table}'|ON public\\.${table})`), table);
  }
  for (const table of [
    "institution_periods", "teacher_timetables", "teacher_absence_requests",
    "teacher_sessions", "attendance_marks", "institution_attendance_policies",
    "institution_attendance_zones",
  ]) {
    assert.match(builder, new RegExp(`from\\("${table}"\\)`), table);
  }
  assert.doesNotMatch(
    migration,
    /CREATE TRIGGER trg_(?:attendance_marks|teacher_sessions|teacher_timetables|teacher_absence_requests)_relay_academic_revision/,
  );
  assert.match(migration, /CREATE TRIGGER trg_attendance_marks_attendance_schedule_revision/);
  const manifestDeclaration = builder.slice(
    builder.indexOf("const ACADEMIC_REQUIRED_COLLECTIONS"),
    builder.indexOf("const SCHEDULE_REQUIRED_COLLECTIONS"),
  );
  assert.doesNotMatch(
    manifestDeclaration,
    /attendance_marks|teacher_sessions|teacher_timetables|teacher_absence_requests|institution_periods/,
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.academic_revisions/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.bump_attendance_schedule_revision_value/);
  const academicBump = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision("),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.bump_relay_academic_revision_for_scoped_row("),
  );
  assert.doesNotMatch(academicBump, /attendance_schedule_revisions/);
  assert.doesNotMatch(migration, /trg_[^\s]+_relay_academic_revision[\s\S]{0,200}bump_attendance_schedule_revision/);
  assert.match(migration, /LEFT JOIN public\.attendance_schedule_revisions/);
  assert.doesNotMatch(migration, /finance|payment|receipt|payroll|expense|budget|charge|debt/i);
  assert.match(builder, /from\("academic_revisions"\)/);
  assert.match(builder, /from\("attendance_schedule_revisions"\)/);
  assert.match(pullRoute, /from\("academic_revisions"\)/);
  assert.match(pullRoute, /from\("attendance_schedule_revisions"\)/);
  assert.match(pullRoute, /buildRelayScheduleSnapshot/);
  assert.match(
    pullRoute,
    /cloud_revision: academicChanged \? Number\(snapshot\.academic_revision\) : revision/,
  );
  assert.doesNotMatch(pullRoute, /cloud_revision: Number\(snapshot\.snapshot_revision\)/);
});

test("snapshot académique complet: matérialisation, readiness et idempotence", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  try {
    const first = store.bootstrap(completeAcademicSnapshot(42));
    assert.equal(first.status, "applied");
    assert.equal(first.applied_snapshot_revision, 42);
    assert.equal(getInstitutionMeta(db, INSTITUTION_ID, "attendance_schedule_revision"), "7");
    assert.equal(getInstitutionMeta(db, INSTITUTION_ID, "academic_revision"), "42");
    assert.equal(getInstitutionMeta(db, INSTITUTION_ID, "academic_offline_ready"), "true");
    assert.equal(Number((db.prepare("SELECT score FROM student_grades WHERE institution_id = ? AND id = 'grade-1'").get(INSTITUTION_ID) as { score: number }).score), 15);
    const duplicate = store.bootstrap(completeAcademicSnapshot(42));
    assert.equal(duplicate.status, "duplicate");
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM student_grades").get() as { count: number }).count), 1);
    const academic = store.status().institutions[0]!.academic;
    assert.equal(academic.ready, true);
    assert.equal(academic.revision, 42);
    assert.deepEqual(academic.counts, {
      classes: 1, students: 1, teachers: 1, subjects: 1,
      grading_periods: 1, assessments: 1, grades: 1, published_scores: 1,
    });
  } finally {
    db.close();
  }
});

test("snapshot académique incomplet ou erreur au milieu: rollback et révision inchangée", () => {
  const db = openRelayDatabase(":memory:");
  try {
    applyBootstrap(db, completeAcademicSnapshot(42));
    const missingCollection = completeAcademicSnapshot(43, "academic-43-missing");
    delete missingCollection.entities.student_grades;
    assert.throws(() => applyBootstrap(db, missingCollection), /academic_snapshot_collection_missing:student_grades/);
    assert.equal(getInstitutionMeta(db, INSTITUTION_ID, "academic_revision"), "42");

    const broken = completeAcademicSnapshot(44, "academic-44-broken");
    broken.entities.student_grades![0]!.evaluation_id = "missing-evaluation";
    assert.throws(() => applyBootstrap(db, broken), /academic_snapshot_dependency_missing/);
    assert.equal(getInstitutionMeta(db, INSTITUTION_ID, "academic_revision"), "42");
    assert.equal(Number((db.prepare("SELECT score FROM student_grades WHERE institution_id = ? AND id = 'grade-1'").get(INSTITUTION_ID) as { score: number }).score), 15);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM sync_bootstrap_runs WHERE institution_id = ? AND snapshot_id = 'academic-44-broken'").get(INSTITUTION_ID) as { count: number }).count), 0);
  } finally {
    db.close();
  }
});

test("snapshot plus récent remplace les données; snapshot partiel ne supprime rien", () => {
  const db = openRelayDatabase(":memory:");
  try {
    applyBootstrap(db, completeAcademicSnapshot(42));
    const partial = completeAcademicSnapshot(43, "partial-43");
    delete (partial as any).academic_manifest;
    delete (partial as any).academic_revision;
    partial.snapshot_completeness = "partial";
    partial.entities.student_grades = [];
    (partial.diagnostics as any).skipped_count = 1;
    const partialResult = applyBootstrap(db, partial);
    assert.equal(partialResult.status, "partial");
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM student_grades WHERE deleted_at IS NULL").get() as { count: number }).count), 1);
    assert.equal(getInstitutionMeta(db, INSTITUTION_ID, "academic_revision"), "42");

    const newer = completeAcademicSnapshot(44, "academic-44");
    newer.entities.student_grades = [];
    newer.academic_manifest.collection_counts.student_grades = 0;
    applyBootstrap(db, newer);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM student_grades WHERE deleted_at IS NULL").get() as { count: number }).count), 0);
    assert.equal(getInstitutionMeta(db, INSTITUTION_ID, "academic_revision"), "44");
  } finally {
    db.close();
  }
});

test("isolation multi-écoles, persistance après redémarrage et lecture sans Internet", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-academic-"));
  const databasePath = join(directory, "relay.db");
  try {
    let db = openRelayDatabase(databasePath);
    applyBootstrap(db, completeAcademicSnapshot(10, "school-a-10", "school-a"));
    applyBootstrap(db, completeAcademicSnapshot(20, "school-b-20", "school-b"));
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM student_grades WHERE id = 'grade-1'").get() as { count: number }).count), 2);
    assert.equal(getInstitutionMeta(db, "school-a", "academic_revision"), "10");
    assert.equal(getInstitutionMeta(db, "school-b", "academic_revision"), "20");
    db.close();

    db = openRelayDatabase(databasePath);
    assert.equal(schemaVersion(db), 9);
    assert.equal(Number((db.prepare("SELECT score FROM student_grades WHERE institution_id = 'school-a' AND id = 'grade-1'").get() as { score: number }).score), 15);
    assert.equal(new RelayStore(db).status().institutions.every((row) => row.academic.ready), true);
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Database from "better-sqlite3";
import { applyBootstrap } from "../src/bootstrap.mjs";
import { openRelayDatabase, schemaVersion, type RelayDatabase } from "../src/db.mjs";
import { materializeEntity } from "../src/entity-materializer.mjs";
import { secureTeacherAttendanceOperation, TeacherAttendanceError } from "../src/teacher-attendance.mjs";
import {
  openTeacherAttendanceSession,
  TeacherSessionOpenError,
} from "../src/teacher-session-open.mjs";
import { SYNC_PROTOCOL_VERSION } from "../src/types.mjs";

const WEDNESDAY = new Date("2026-07-22T09:15:00.000Z");
const THURSDAY = new Date("2026-07-23T09:15:00.000Z");
const UPDATED_AT = "2026-07-22T08:00:00.000Z";
const TEST_PRESENCE_SECRET = "8888888888888888888888888888888888888888888888888888888888888888";

type SnapshotOptions = {
  snapshotId: string;
  institutionId?: string;
  institutionCode?: string;
  timetablePrefix: string;
  classCount?: number;
  timetableCount?: number;
  generatedAt?: string;
};

test("schema 8 neuf: identite Cloud composite, anciennes unicites retirees et aucune logique Finance", () => {
  const db = openRelayDatabase(":memory:");
  assert.equal(schemaVersion(db), 9);
  assert.deepEqual(primaryKeyColumns(db, "teacher_timetables"), ["institution_id", "id"]);
  assert.equal(hasLegacyTimetableUnique(db), false);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(String(db.pragma("integrity_check", { simple: true })), "ok");

  const migration = readFileSync(
    fileURLToPath(new URL("../migrations/0008_teacher_timetable_identity.sql", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(migration, /finance|payment|receipt|cash|payroll|expense|budget|charge|debt/i);
  db.close();
});

test("migration 7 vers 8: lignes, dirty, outbox et reference lifecycle sont preservees", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-relay-schema8-"));
  const databasePath = join(directory, "schema7.db");
  try {
    const schema7 = createSchema7Database(databasePath);
    seedSchema7History(schema7);
    schema7.close();

    let migrated = openRelayDatabase(databasePath);
    assert.equal(schemaVersion(migrated), 9);
    assert.equal(rowCount(migrated, "teacher_timetables"), 1);
    assert.equal(rowCount(migrated, "teacher_sessions"), 1);
    assert.equal(rowCount(migrated, "teacher_session_open_operations"), 1);
    assert.equal(rowCount(migrated, "sync_outbox"), 1);
    assert.equal(Number((migrated.prepare(`
      SELECT local_dirty FROM sync_records
      WHERE institution_id = 'inst-legacy'
        AND entity_type = 'teacher_timetable'
        AND entity_id = 'timetable-legacy'
    `).get() as { local_dirty: number }).local_dirty), 1);
    assert.deepEqual(primaryKeyColumns(migrated, "teacher_timetables"), ["institution_id", "id"]);
    assert.equal(hasLegacyTimetableUnique(migrated), false);
    const lifecycleForeignKeys = migrated.pragma(
      "foreign_key_list(teacher_session_open_operations)",
    ) as Array<{ table: string; from: string; to: string }>;
    assert.ok(lifecycleForeignKeys.some((row) =>
      row.table === "teacher_timetables" && row.from === "timetable_id" && row.to === "id"
    ));
    assert.ok(lifecycleForeignKeys.some((row) =>
      row.table === "teacher_timetables" && row.from === "institution_id" &&
      row.to === "institution_id"
    ));
    assert.deepEqual(migrated.pragma("foreign_key_check"), []);
    assert.equal(String(migrated.pragma("integrity_check", { simple: true })), "ok");
    const appliedAt = String((migrated.prepare(`
      SELECT applied_at FROM schema_migrations WHERE version = 8
    `).get() as { applied_at: string }).applied_at);
    migrated.close();

    migrated = openRelayDatabase(databasePath);
    assert.equal(schemaVersion(migrated), 9);
    assert.equal(Number((migrated.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 8
    `).get() as { count: number }).count), 1);
    assert.equal(String((migrated.prepare(`
      SELECT applied_at FROM schema_migrations WHERE version = 8
    `).get() as { applied_at: string }).applied_at), appliedAt);
    assert.equal(rowCount(migrated, "teacher_session_open_operations"), 1);
    assert.deepEqual(migrated.pragma("foreign_key_check"), []);
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration 8: une erreur injectee restaure atomiquement table, index, donnees et version 7", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-relay-schema8-rollback-"));
  const databasePath = join(directory, "schema7.db");
  try {
    const schema7 = createSchema7Database(databasePath);
    seedSchema7History(schema7);
    schema7.exec(`
      CREATE TRIGGER reject_schema_8
      BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 8
      BEGIN
        SELECT RAISE(ABORT, 'injected_schema8_failure');
      END;
    `);
    schema7.close();

    assert.throws(() => openRelayDatabase(databasePath), /injected_schema8_failure/);
    const inspected = new Database(databasePath, { readonly: true, fileMustExist: true });
    assert.equal(schemaVersion(inspected), 7);
    assert.equal(rowCount(inspected, "teacher_timetables"), 1);
    assert.equal(rowCount(inspected, "teacher_session_open_operations"), 1);
    assert.equal(hasLegacyTimetableUnique(inspected), true);
    assert.equal(inspected.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = '__v8_teacher_timetables'
    `).get(), undefined);
    assert.deepEqual(inspected.pragma("foreign_key_check"), []);
    assert.equal(String(inspected.pragma("integrity_check", { simple: true })), "ok");
    inspected.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fixture Notre-Dame: 25 nouveaux UUID, 23 classes, zero rejet et aucune ambiguite", () => {
  const db = openRelayDatabase(":memory:");
  const original = timetableSnapshot({
    snapshotId: "notre-dame-original",
    timetablePrefix: "old",
  });
  const replacement = timetableSnapshot({
    snapshotId: "notre-dame-replacement",
    timetablePrefix: "cloud",
    generatedAt: "2026-07-22T08:30:00.000Z",
  });

  const first = applyBootstrap(db, original);
  assert.equal(first.status, "applied");
  assert.equal(first.rejected_entities, 0);
  assert.equal(activeTimetableCount(db, "inst-1"), 25);

  const second = applyBootstrap(db, replacement);
  assert.equal(second.status, "applied");
  assert.equal(second.rejected_entities, 0);
  assert.equal(second.deferred_entities, 0);
  assert.equal(activeTimetableCount(db, "inst-1"), 25);
  assert.equal(deletedTimetableCount(db, "inst-1"), 25);
  assert.equal(Number((db.prepare(`
    SELECT COUNT(DISTINCT class_id) AS count
    FROM teacher_timetables
    WHERE institution_id = 'inst-1' AND deleted_at IS NULL
  `).get() as { count: number }).count), 23);
  assert.equal(Number((db.prepare(`
    SELECT COUNT(*) AS count
    FROM teacher_timetables
    WHERE institution_id = 'inst-1'
      AND deleted_at IS NULL
      AND id LIKE 'cloud-timetable-%'
  `).get() as { count: number }).count), 25);
  assert.equal(rowCount(db, "sync_materialization_failures"), 0);

  const opened = openTeacherAttendanceSession(
    db,
    openOperation("fixture-open", "class-0", "period-0"),
    teacher("inst-1"),
    WEDNESDAY,
  );
  assert.equal(opened.state, "opened_on_relay");
  assert.equal(String((db.prepare(`
    SELECT timetable_id
    FROM teacher_session_open_operations
    WHERE institution_id = 'inst-1' AND operation_id = 'fixture-open'
  `).get() as { timetable_id: string }).timetable_id), "cloud-timetable-0");

  const repeated = applyBootstrap(db, {
    ...replacement,
    snapshot_id: "notre-dame-repeated",
    generated_at: "2026-07-22T08:45:00.000Z",
  });
  assert.equal(repeated.status, "applied");
  assert.equal(repeated.rejected_entities, 0);
  assert.equal(activeTimetableCount(db, "inst-1"), 25);
  assert.equal(rowCount(db, "teacher_timetables"), 50);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(String(db.pragma("integrity_check", { simple: true })), "ok");
  db.close();
});

test("bootstrap schema 8 conserve independamment local_dirty et une outbox locale", () => {
  const db = openRelayDatabase(":memory:");
  applyBootstrap(db, timetableSnapshot({
    snapshotId: "local-original",
    timetablePrefix: "old",
    classCount: 2,
    timetableCount: 2,
  }));
  db.prepare(`
    UPDATE sync_records
    SET local_dirty = 1
    WHERE institution_id = 'inst-1'
      AND entity_type = 'teacher_timetable'
      AND entity_id = 'old-timetable-0'
  `).run();
  db.prepare(`
    INSERT INTO sync_outbox(
      operation_id, institution_id, device_id, entity_type, entity_id,
      action, base_server_version, payload_json, occurred_at
    ) VALUES (
      'local-timetable-operation', 'inst-1', 'device-1',
      'teacher_timetable', 'old-timetable-1', 'upsert', 1, '{}', ?
    )
  `).run(UPDATED_AT);

  const result = applyBootstrap(db, timetableSnapshot({
    snapshotId: "local-replacement",
    timetablePrefix: "cloud",
    classCount: 2,
    timetableCount: 2,
    generatedAt: "2026-07-22T08:30:00.000Z",
  }));
  assert.equal(result.status, "applied");
  assert.equal(result.rejected_entities, 0);
  assert.equal(result.preserved_local_entities, 2);
  assert.equal(activeTimetableCount(db, "inst-1"), 4);
  assert.equal(deletedTimetableCount(db, "inst-1"), 0);
  assert.equal(Number((db.prepare(`
    SELECT local_dirty FROM sync_records
    WHERE institution_id = 'inst-1'
      AND entity_type = 'teacher_timetable'
      AND entity_id = 'old-timetable-0'
  `).get() as { local_dirty: number }).local_dirty), 1);
  assert.equal(Number((db.prepare(`
    SELECT COUNT(*) AS count FROM sync_outbox
    WHERE institution_id = 'inst-1'
      AND entity_type = 'teacher_timetable'
      AND entity_id = 'old-timetable-1'
  `).get() as { count: number }).count), 1);
  db.close();
});

test("un bootstrap source partiel ne desactive aucun ancien emploi du temps", () => {
  const db = openRelayDatabase(":memory:");
  applyBootstrap(db, timetableSnapshot({
    snapshotId: "partial-original",
    timetablePrefix: "old",
    classCount: 1,
    timetableCount: 1,
  }));
  const partial = timetableSnapshot({
    snapshotId: "partial-replacement",
    timetablePrefix: "cloud",
    classCount: 1,
    timetableCount: 1,
    generatedAt: "2026-07-22T08:30:00.000Z",
  });
  partial.diagnostics.skipped_count = 1;
  (partial.diagnostics.skipped as unknown[]).push({
    collection: "teacher_timetables",
    entity_id: "source-row-with-missing-dependency",
  });
  const result = applyBootstrap(db, partial);
  assert.equal(result.status, "partial");
  assert.equal(result.source_skipped_entities, 1);
  assert.equal(activeTimetableCount(db, "inst-1"), 2);
  assert.equal(deletedTimetableCount(db, "inst-1"), 0);
  db.close();
});

test("les dependances absentes restent diagnostiquees sans masquer une collision", () => {
  const db = openRelayDatabase(":memory:");
  const snapshot = timetableSnapshot({
    snapshotId: "missing-dependency",
    timetablePrefix: "cloud",
    classCount: 1,
    timetableCount: 1,
  });
  snapshot.entities.teacher_timetables[0]!.subject_id = "subject-missing";
  const result = applyBootstrap(db, snapshot);
  assert.equal(result.status, "partial");
  assert.equal(result.deferred_entities, 1);
  assert.equal(result.rejected_entities, 1);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.collection === "teacher_timetables" &&
    diagnostic.entity_id === "cloud-timetable-0" &&
    diagnostic.reason === "dependency_missing" &&
    diagnostic.dependency_type === "subject_id" &&
    diagnostic.dependency_id === "subject-missing"
  ));
  assert.equal(activeTimetableCount(db, "inst-1"), 0);
  db.close();
});

test("deux jours partagent classe, matiere, professeur et plage sans mauvaise ouverture", () => {
  for (const scenario of [
    { now: WEDNESDAY, periodWeekday: 3, otherWeekday: 4, expectedTimetable: "timetable-current" },
    { now: THURSDAY, periodWeekday: 4, otherWeekday: 3, expectedTimetable: "timetable-current" },
  ]) {
    const db = openRelayDatabase(":memory:");
    seedLifecycleSchool(db, "inst-day", scenario.periodWeekday);
    db.prepare(`
      INSERT INTO institution_periods(
        id, institution_id, weekday, label, start_time, end_time, updated_at
      ) VALUES ('period-other-day', 'inst-day', ?, 'Meme plage autre jour', '09:00', '10:00', ?)
    `).run(scenario.otherWeekday, UPDATED_AT);
    insertTimetable(
      db,
      "inst-day",
      "timetable-current",
      "class-a",
      "subject-a",
      scenario.periodWeekday,
    );
    insertTimetable(
      db,
      "inst-day",
      "timetable-other-day",
      "class-a",
      "subject-a",
      scenario.otherWeekday,
      "period-other-day",
    );

    const opened = openTeacherAttendanceSession(
      db,
      openOperation(`open-${scenario.periodWeekday}`, "class-a", "period-main"),
      teacher("inst-day"),
      scenario.now,
    );
    assert.equal(opened.state, "opened_on_relay");
    assert.equal(String((db.prepare(`
      SELECT timetable_id FROM teacher_session_open_operations
      WHERE institution_id = 'inst-day' AND operation_id = ?
    `).get(`open-${scenario.periodWeekday}`) as { timetable_id: string }).timetable_id),
    scenario.expectedTimetable);
    db.close();
  }
});

test("deux contextes distingues par la classe ouvrent le bon cours", () => {
  const db = openRelayDatabase(":memory:");
  seedLifecycleSchool(db, "inst-context", 3);
  insertTimetable(db, "inst-context", "timetable-class-a", "class-a", "subject-a", 3);
  insertTimetable(db, "inst-context", "timetable-class-b", "class-b", "subject-b", 3);

  const opened = openTeacherAttendanceSession(
    db,
    openOperation("open-class-b", "class-b", "period-main"),
    teacher("inst-context"),
    WEDNESDAY,
  );
  assert.equal(opened.session.class_id, "class-b");
  assert.equal(opened.session.subject_id, "subject-b");
  assert.equal(String((db.prepare(`
    SELECT timetable_id FROM teacher_session_open_operations
    WHERE institution_id = 'inst-context' AND operation_id = 'open-class-b'
  `).get() as { timetable_id: string }).timetable_id), "timetable-class-b");
  db.close();
});

test("une vraie ambiguite meme classe, jour et creneau est refusee sans ecriture", () => {
  const db = openRelayDatabase(":memory:");
  seedLifecycleSchool(db, "inst-ambiguous", 3);
  insertTimetable(db, "inst-ambiguous", "timetable-a", "class-a", "subject-a", 3);
  insertTimetable(db, "inst-ambiguous", "timetable-b", "class-a", "subject-b", 3);

  assert.throws(
    () => openTeacherAttendanceSession(
      db,
      openOperation("ambiguous-open", "class-a", "period-main"),
      teacher("inst-ambiguous"),
      WEDNESDAY,
    ),
    (error: unknown) =>
      error instanceof TeacherSessionOpenError &&
      error.status === 409 &&
      error.code === "teacher_timetable_ambiguous",
  );
  assert.equal(rowCount(db, "teacher_sessions"), 0);
  assert.equal(rowCount(db, "teacher_session_open_operations"), 0);
  assert.equal(rowCount(db, "sync_outbox"), 0);
  db.close();
});

test("deux ecoles reutilisent les memes IDs sans collision ni suppression croisee", () => {
  const db = openRelayDatabase(":memory:");
  applyBootstrap(db, timetableSnapshot({
    snapshotId: "school-a",
    institutionId: "inst-a",
    institutionCode: "SCHOOL-A",
    timetablePrefix: "shared",
    classCount: 1,
    timetableCount: 1,
  }));
  applyBootstrap(db, timetableSnapshot({
    snapshotId: "school-b",
    institutionId: "inst-b",
    institutionCode: "SCHOOL-B",
    timetablePrefix: "shared",
    classCount: 1,
    timetableCount: 1,
  }));
  applyBootstrap(db, timetableSnapshot({
    snapshotId: "school-a-replacement",
    institutionId: "inst-a",
    institutionCode: "SCHOOL-A",
    timetablePrefix: "new-a",
    classCount: 1,
    timetableCount: 1,
    generatedAt: "2026-07-22T08:30:00.000Z",
  }));
  assert.equal(activeTimetableCount(db, "inst-a"), 1);
  assert.equal(deletedTimetableCount(db, "inst-a"), 1);
  assert.equal(activeTimetableCount(db, "inst-b"), 1);
  assert.equal(deletedTimetableCount(db, "inst-b"), 0);
  assert.ok(db.prepare(`
    SELECT 1 FROM teacher_timetables
    WHERE institution_id = 'inst-b'
      AND id = 'shared-timetable-0'
      AND deleted_at IS NULL
  `).get());
  db.close();
});

test("update et suppression distante ciblent uniquement l'ID Cloud composite", () => {
  const db = openRelayDatabase(":memory:");
  applyBootstrap(db, timetableSnapshot({
    snapshotId: "exact-a",
    institutionId: "inst-a",
    institutionCode: "EXACT-A",
    timetablePrefix: "shared",
    classCount: 1,
    timetableCount: 1,
  }));
  applyBootstrap(db, timetableSnapshot({
    snapshotId: "exact-b",
    institutionId: "inst-b",
    institutionCode: "EXACT-B",
    timetablePrefix: "shared",
    classCount: 1,
    timetableCount: 1,
  }));
  const payload = {
    id: "shared-timetable-0",
    institution_id: "inst-a",
    academic_year: "2027",
    class_id: "class-0",
    subject_id: "subject-shared",
    teacher_id: "teacher-shared",
    period_id: "period-0",
    weekday: 3,
    updated_at: "2026-07-22T09:00:00.000Z",
  };
  materializeEntity(db, {
    institutionId: "inst-a",
    entityType: "teacher_timetable",
    entityId: "shared-timetable-0",
    action: "upsert",
    payload,
    serverVersion: 2,
    occurredAt: payload.updated_at,
  });
  assert.equal(String((db.prepare(`
    SELECT academic_year FROM teacher_timetables
    WHERE institution_id = 'inst-a' AND id = 'shared-timetable-0'
  `).get() as { academic_year: string }).academic_year), "2027");
  assert.equal(String((db.prepare(`
    SELECT academic_year FROM teacher_timetables
    WHERE institution_id = 'inst-b' AND id = 'shared-timetable-0'
  `).get() as { academic_year: string }).academic_year), "2026");

  materializeEntity(db, {
    institutionId: "inst-a",
    entityType: "teacher_timetable",
    entityId: "shared-timetable-0",
    action: "delete",
    payload: null,
    serverVersion: 3,
    occurredAt: "2026-07-22T09:30:00.000Z",
  });
  assert.equal(activeTimetableCount(db, "inst-a"), 0);
  assert.equal(activeTimetableCount(db, "inst-b"), 1);
  db.close();
});

test("l'appel ne peut pas etre autorise par un emploi du temps d'un autre jour", () => {
  const db = openRelayDatabase(":memory:");
  seedLifecycleSchool(db, "inst-attendance", 3);
  insertTimetable(db, "inst-attendance", "timetable-current", "class-a", "subject-a", 3);
  const opened = openTeacherAttendanceSession(
    db,
    openOperation("attendance-parent", "class-a", "period-main"),
    teacher("inst-attendance"),
    WEDNESDAY,
  );
  db.prepare(`
    UPDATE teacher_timetables
    SET weekday = 4
    WHERE institution_id = 'inst-attendance' AND id = 'timetable-current'
  `).run();

  assert.throws(
    () => secureTeacherAttendanceOperation(db, {
      protocol_version: 1,
      operation_id: "attendance-child",
      operation_type: "attendance.call.submit",
      session_id: opened.session.id,
      class_id: "class-a",
      period_id: "period-main",
      presence_proof: opened.presence_proof,
      marks: [{ student_id: "student-a", status: "present", comment: null }],
    }, teacher("inst-attendance"), WEDNESDAY),
    (error: unknown) =>
      error instanceof TeacherAttendanceError &&
      error.status === 403 &&
      error.code === "teacher_not_scheduled_for_slot",
  );
  assert.equal(rowCount(db, "teacher_attendance_operations"), 0);
  db.close();
});

function timetableSnapshot(options: SnapshotOptions) {
  const institutionId = options.institutionId ?? "inst-1";
  const institutionCode = options.institutionCode ?? "SCHOOL-1";
  const classCount = options.classCount ?? 23;
  const timetableCount = options.timetableCount ?? 25;
  const generatedAt = options.generatedAt ?? UPDATED_AT;
  const classes = Array.from({ length: classCount }, (_, index) => ({
    id: `class-${index}`,
    institution_id: institutionId,
    academic_year: "2026",
    label: `Classe ${index}`,
    level: null,
    server_version: 1,
    updated_at: generatedAt,
  }));
  const periods = Array.from({ length: timetableCount }, (_, index) => ({
    id: `period-${index}`,
    institution_id: institutionId,
    weekday: 3,
    label: `Creneau ${index}`,
    start_time: "09:00",
    end_time: "10:00",
    server_version: 1,
    updated_at: generatedAt,
  }));
  const timetables = Array.from({ length: timetableCount }, (_, index) => ({
    id: `${options.timetablePrefix}-timetable-${index}`,
    institution_id: institutionId,
    academic_year: "2026",
    class_id: `class-${index % classCount}`,
    subject_id: "subject-shared",
    teacher_id: "teacher-shared",
    period_id: `period-${index}`,
    weekday: 3,
    server_version: 1,
    updated_at: generatedAt,
  }));
  return {
    protocol_version: SYNC_PROTOCOL_VERSION,
    snapshot_id: options.snapshotId,
    institution_id: institutionId,
    generated_at: generatedAt,
    cursor: `cursor-${options.snapshotId}`,
    institution: {
      id: institutionId,
      name: institutionCode,
      code: institutionCode,
      timezone: "UTC",
      settings_json: {
        attendance_presence: {
          enabled: true,
          allow_local_relay: true,
          relay_presence_secret: TEST_PRESENCE_SECRET,
          relay_proof_ttl_seconds: 180,
        },
      },
      server_version: 1,
      updated_at: generatedAt,
    },
    entities: {
      profiles: [{
        id: "teacher-shared",
        institution_id: institutionId,
        display_name: "Enseignant test",
        is_active: true,
        server_version: 1,
        updated_at: generatedAt,
      }],
      user_roles: [{
        id: "role-teacher-shared",
        institution_id: institutionId,
        profile_id: "teacher-shared",
        role: "teacher",
        server_version: 1,
        updated_at: generatedAt,
      }],
      classes,
      subjects: [{
        id: "subject-shared",
        institution_id: institutionId,
        base_subject_id: null,
        name: "Matiere test",
        short_name: "TEST",
        server_version: 1,
        updated_at: generatedAt,
      }],
      institution_periods: periods,
      teacher_timetables: timetables,
    },
    diagnostics: {
      skipped_count: 0,
      skipped: [],
    },
  };
}

function createSchema7Database(databasePath: string) {
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
    { version: 1, name: "core", file: "0001_core.sql" },
    { version: 2, name: "bootstrap_dashboard", file: "0002_bootstrap_dashboard.sql" },
    { version: 3, name: "bootstrap_diagnostics", file: "0003_bootstrap_diagnostics.sql" },
    { version: 4, name: "multi_school_partitioning", file: "0004_multi_school_partitioning.sql" },
    { version: 5, name: "teacher_attendance_operations", file: "0005_teacher_attendance_operations.sql" },
    { version: 6, name: "teacher_session_open", file: "0006_teacher_session_open.sql" },
    { version: 7, name: "teacher_session_close_transition", file: "0007_teacher_session_close_transition.sql" },
  ] as const;
  for (const migration of migrations) {
    const sql = readFileSync(
      fileURLToPath(new URL(`../migrations/${migration.file}`, import.meta.url)),
      "utf8",
    );
    const apply = db.transaction(() => {
      db.exec(sql);
      if (migration.version === 7) {
        db.exec(`
          CREATE UNIQUE INDEX teacher_sessions_one_class_date_period
            ON teacher_sessions(institution_id, class_id, session_date, period_id)
            WHERE deleted_at IS NULL AND session_date IS NOT NULL AND period_id IS NOT NULL;
        `);
      }
      db.prepare(`
        INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)
      `).run(migration.version, migration.name, `2026-07-22T08:00:0${migration.version}.000Z`);
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
  assert.equal(schemaVersion(db), 7);
  return db;
}

function seedSchema7History(db: Database.Database) {
  db.prepare(`
    INSERT INTO institutions(id, name, code, timezone, settings_json, updated_at)
    VALUES ('inst-legacy', 'Ecole historique', 'LEGACY', 'UTC', '{}', ?)
  `).run(UPDATED_AT);
  db.prepare(`
    INSERT INTO profiles(id, institution_id, display_name, is_active, updated_at)
    VALUES ('teacher-legacy', 'inst-legacy', 'Enseignant', 1, ?)
  `).run(UPDATED_AT);
  db.prepare(`
    INSERT INTO classes(id, institution_id, academic_year, label, updated_at)
    VALUES ('class-legacy', 'inst-legacy', '2026', 'Classe', ?)
  `).run(UPDATED_AT);
  db.prepare(`
    INSERT INTO subjects(id, institution_id, name, updated_at)
    VALUES ('subject-legacy', 'inst-legacy', 'Matiere', ?)
  `).run(UPDATED_AT);
  db.prepare(`
    INSERT INTO institution_periods(
      id, institution_id, weekday, label, start_time, end_time, updated_at
    ) VALUES ('period-legacy', 'inst-legacy', 3, 'Creneau', '09:00', '10:00', ?)
  `).run(UPDATED_AT);
  db.prepare(`
    INSERT INTO teacher_timetables(
      id, institution_id, academic_year, class_id, subject_id,
      teacher_id, period_id, weekday, updated_at
    ) VALUES (
      'timetable-legacy', 'inst-legacy', '2026', 'class-legacy', 'subject-legacy',
      'teacher-legacy', 'period-legacy', 3, ?
    )
  `).run(UPDATED_AT);
  db.prepare(`
    INSERT INTO teacher_sessions(
      id, institution_id, client_session_id, class_id, subject_id, teacher_id,
      period_id, started_at, actual_call_at, ended_at, origin, updated_at,
      session_date, session_state, scheduled_start_at, requested_start_at,
      actual_started_at, scheduled_end_at, grace_expires_at, local_lifecycle_managed
    ) VALUES (
      'session-legacy', 'inst-legacy', 'session-legacy', 'class-legacy',
      'subject-legacy', 'teacher-legacy', 'period-legacy',
      '2026-07-22T09:00:00.000Z', '2026-07-22T09:00:00.000Z', NULL, 'teacher', ?,
      '2026-07-22', 'open', '2026-07-22T09:00:00.000Z',
      '2026-07-22T09:00:00.000Z', '2026-07-22T09:00:00.000Z',
      '2026-07-22T10:00:00.000Z', '2026-07-22T10:10:00.000Z', 1
    )
  `).run(UPDATED_AT);
  db.prepare(`
    INSERT INTO teacher_session_open_operations(
      operation_id, institution_id, protocol_version, operation_type,
      teacher_profile_id, class_id, period_id, timetable_id, subject_id,
      local_session_id, remote_session_id, payload_fingerprint, payload_json,
      created_locally, state, accepted_at, updated_at
    ) VALUES (
      'open-legacy', 'inst-legacy', 1, 'attendance.session.open',
      'teacher-legacy', 'class-legacy', 'period-legacy', 'timetable-legacy',
      'subject-legacy', 'session-legacy', NULL,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{}', 1, 'opened_on_relay', ?, ?
    )
  `).run(UPDATED_AT, UPDATED_AT);
  db.prepare(`
    INSERT INTO sync_records(
      institution_id, entity_type, entity_id, payload_json, server_version,
      local_dirty, deleted_at, updated_at
    ) VALUES (
      'inst-legacy', 'teacher_timetable', 'timetable-legacy', '{}', 1, 1, NULL, ?
    )
  `).run(UPDATED_AT);
  db.prepare(`
    INSERT INTO sync_outbox(
      operation_id, institution_id, device_id, entity_type, entity_id,
      action, base_server_version, payload_json, occurred_at
    ) VALUES (
      'outbox-legacy', 'inst-legacy', 'device-legacy',
      'teacher_timetable', 'timetable-legacy', 'upsert', 1, '{}', ?
    )
  `).run(UPDATED_AT);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
}

function seedLifecycleSchool(
  db: RelayDatabase,
  institutionId: string,
  periodWeekday: number,
) {
  db.prepare(`
    INSERT INTO institutions(id, name, code, timezone, settings_json, updated_at)
    VALUES (?, ?, ?, 'UTC', ?, ?)
  `).run(
    institutionId,
    institutionId,
    institutionId,
    JSON.stringify({
      attendance_presence: {
        enabled: true,
        allow_local_relay: true,
        relay_presence_secret: TEST_PRESENCE_SECRET,
        relay_proof_ttl_seconds: 180,
      },
    }),
    UPDATED_AT,
  );
  db.prepare(`
    INSERT INTO profiles(id, institution_id, display_name, is_active, updated_at)
    VALUES ('teacher-shared', ?, 'Enseignant', 1, ?)
  `).run(institutionId, UPDATED_AT);
  db.prepare(`
    INSERT INTO user_roles(id, institution_id, profile_id, role, updated_at)
    VALUES ('role-teacher', ?, 'teacher-shared', 'teacher', ?)
  `).run(institutionId, UPDATED_AT);
  for (const [classId, label] of [["class-a", "Classe A"], ["class-b", "Classe B"]]) {
    db.prepare(`
      INSERT INTO classes(id, institution_id, academic_year, label, updated_at)
      VALUES (?, ?, '2026', ?, ?)
    `).run(classId, institutionId, label, UPDATED_AT);
  }
  for (const [subjectId, name] of [["subject-a", "Matiere A"], ["subject-b", "Matiere B"]]) {
    db.prepare(`
      INSERT INTO subjects(id, institution_id, name, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(subjectId, institutionId, name, UPDATED_AT);
  }
  db.prepare(`
    INSERT INTO institution_periods(
      id, institution_id, weekday, label, start_time, end_time, updated_at
    ) VALUES ('period-main', ?, ?, 'Creneau', '09:00', '10:00', ?)
  `).run(institutionId, periodWeekday, UPDATED_AT);
  db.prepare(`
    INSERT INTO students(id, institution_id, display_name, is_active, updated_at)
    VALUES ('student-a', ?, 'Eleve', 1, ?)
  `).run(institutionId, UPDATED_AT);
  db.prepare(`
    INSERT INTO class_enrollments(
      id, institution_id, class_id, student_id, start_date, end_date, updated_at
    ) VALUES ('enrollment-a', ?, 'class-a', 'student-a', '2026-01-01', NULL, ?)
  `).run(institutionId, UPDATED_AT);
}

function insertTimetable(
  db: RelayDatabase,
  institutionId: string,
  timetableId: string,
  classId: string,
  subjectId: string,
  weekday: number,
  periodId = "period-main",
) {
  db.prepare(`
    INSERT INTO teacher_timetables(
      id, institution_id, academic_year, class_id, subject_id,
      teacher_id, period_id, weekday, updated_at
    ) VALUES (?, ?, '2026', ?, ?, 'teacher-shared', ?, ?, ?)
  `).run(timetableId, institutionId, classId, subjectId, periodId, weekday, UPDATED_AT);
}

function openOperation(operationId: string, classId: string, periodId: string) {
  return {
    protocol_version: 1 as const,
    operation_id: operationId,
    operation_type: "attendance.session.open" as const,
    class_id: classId,
    period_id: periodId,
  };
}

function teacher(institutionId: string) {
  return {
    institution_id: institutionId,
    actor_profile_id: "teacher-shared",
  };
}

function primaryKeyColumns(db: Database.Database, table: string) {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string; pk: number }>)
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
}

function hasLegacyTimetableUnique(db: Database.Database) {
  const indexes = db.pragma("index_list(teacher_timetables)") as Array<{
    name: string;
    unique: number;
  }>;
  return indexes.some((index) => {
    if (index.unique !== 1) return false;
    const columns = (db.pragma(`index_info(${JSON.stringify(index.name)})`) as Array<{
      name: string;
      seqno: number;
    }>)
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name);
    return columns.join(",") === "institution_id,class_id,subject_id,teacher_id,period_id";
  });
}

function rowCount(db: Database.Database, table: string) {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function activeTimetableCount(db: Database.Database, institutionId: string) {
  return Number((db.prepare(`
    SELECT COUNT(*) AS count FROM teacher_timetables
    WHERE institution_id = ? AND deleted_at IS NULL
  `).get(institutionId) as { count: number }).count);
}

function deletedTimetableCount(db: Database.Database, institutionId: string) {
  return Number((db.prepare(`
    SELECT COUNT(*) AS count FROM teacher_timetables
    WHERE institution_id = ? AND deleted_at IS NOT NULL
  `).get(institutionId) as { count: number }).count);
}

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import {
  openRelayDatabase,
  schemaVersion,
  setInstitutionMeta,
  type RelayDatabase,
} from "../src/db.mjs";
import { canonicalJson } from "../src/json.mjs";
import { createRelayServer } from "../src/server.mjs";
import { RelayStore } from "../src/store.mjs";
import { secureTeacherAttendanceOperation } from "../src/teacher-attendance.mjs";
import {
  openTeacherAttendanceSession,
  TeacherSessionOpenError,
} from "../src/teacher-session-open.mjs";

const NOW = new Date("2026-07-22T09:15:00.000Z");
const SCHOOL_ONE_SECRET = "1111111111111111111111111111111111111111111111111111111111111111";
const SCHOOL_TWO_SECRET = "2222222222222222222222222222222222222222222222222222222222222222";
const ADMIN_TOKEN = "admin-token-never-valid-for-teacher-route";

type SchoolSeed = {
  institutionId: string;
  code: string;
  secret: string;
  teacherId?: string;
  prefix?: string;
  activeTeacher?: boolean;
  teacherRole?: boolean;
  weekday?: number;
  startTime?: string;
  endTime?: string;
};

function ids(seed: SchoolSeed) {
  const prefix = seed.prefix || "shared";
  return {
    teacherId: seed.teacherId || "teacher-shared",
    classId: `${prefix}-class`,
    subjectId: `${prefix}-subject`,
    periodId: `${prefix}-period`,
    timetableId: `${prefix}-timetable`,
    studentId: `${prefix}-student`,
  };
}

function seedSchool(db: RelayDatabase, seed: SchoolSeed) {
  const value = ids(seed);
  const updatedAt = NOW.toISOString();
  db.prepare(`
    INSERT INTO institutions(id, name, code, timezone, settings_json, updated_at)
    VALUES (?, ?, ?, 'UTC', ?, ?)
  `).run(
    seed.institutionId,
    seed.code,
    seed.code,
    JSON.stringify({
      attendance_presence: {
        enabled: true,
        allow_local_relay: true,
        relay_presence_secret: seed.secret,
        relay_proof_ttl_seconds: 180,
      },
    }),
    updatedAt,
  );
  db.prepare(`
    INSERT INTO profiles(id, institution_id, display_name, is_active, updated_at)
    VALUES (?, ?, 'Professeur', ?, ?)
  `).run(
    value.teacherId,
    seed.institutionId,
    seed.activeTeacher === false ? 0 : 1,
    updatedAt,
  );
  if (seed.teacherRole !== false) {
    db.prepare(`
      INSERT INTO user_roles(id, institution_id, profile_id, role, updated_at)
      VALUES (?, ?, ?, 'teacher', ?)
    `).run(`role:${value.teacherId}`, seed.institutionId, value.teacherId, updatedAt);
  }
  db.prepare(`
    INSERT INTO classes(id, institution_id, academic_year, label, updated_at)
    VALUES (?, ?, '2026', 'Classe test', ?)
  `).run(value.classId, seed.institutionId, updatedAt);
  db.prepare(`
    INSERT INTO subjects(id, institution_id, name, updated_at)
    VALUES (?, ?, 'Matière test', ?)
  `).run(value.subjectId, seed.institutionId, updatedAt);
  db.prepare(`
    INSERT INTO students(id, institution_id, display_name, is_active, updated_at)
    VALUES (?, ?, 'Élève test', 1, ?)
  `).run(value.studentId, seed.institutionId, updatedAt);
  db.prepare(`
    INSERT INTO class_enrollments(
      id, institution_id, class_id, student_id, start_date, end_date, updated_at
    ) VALUES (?, ?, ?, ?, '2026-01-01', NULL, ?)
  `).run(
    `enrollment:${value.studentId}`,
    seed.institutionId,
    value.classId,
    value.studentId,
    updatedAt,
  );
  db.prepare(`
    INSERT INTO institution_periods(
      id, institution_id, weekday, label, start_time, end_time, updated_at
    ) VALUES (?, ?, ?, 'Créneau test', ?, ?, ?)
  `).run(
    value.periodId,
    seed.institutionId,
    seed.weekday ?? 3,
    seed.startTime || "09:00",
    seed.endTime || "10:00",
    updatedAt,
  );
  db.prepare(`
    INSERT INTO teacher_timetables(
      id, institution_id, class_id, subject_id, teacher_id,
      period_id, weekday, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.timetableId,
    seed.institutionId,
    value.classId,
    value.subjectId,
    value.teacherId,
    value.periodId,
    seed.weekday ?? 3,
    updatedAt,
  );
  return value;
}

function teacherToken(seed: SchoolSeed, now = NOW) {
  const value = ids(seed);
  const payload = {
    v: 1,
    purpose: "attendance_relay_access",
    institution_id: seed.institutionId,
    actor_profile_id: value.teacherId,
    issued_at: new Date(now.getTime() - 60_000).toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${createHmac("sha256", seed.secret).update(encoded).digest("base64url")}`;
}

function operation(seed: SchoolSeed, operationId = "session-open-operation") {
  const value = ids(seed);
  return {
    protocol_version: 1,
    operation_id: operationId,
    operation_type: "attendance.session.open",
    class_id: value.classId,
    period_id: value.periodId,
  };
}

function teacher(seed: SchoolSeed) {
  return {
    institution_id: seed.institutionId,
    actor_profile_id: ids(seed).teacherId,
  };
}

function count(db: RelayDatabase | Database.Database, table: string) {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function createSchema5(path: string) {
  const db = new Database(path);
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
  ] as const;
  for (const [version, name, file] of migrations) {
    if (version === 4) db.pragma("foreign_keys = OFF");
    const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare(`
        INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)
      `).run(version, name, NOW.toISOString());
    })();
    if (version === 4) db.pragma("foreign_keys = ON");
  }
  return db;
}

function relayConfig(codes: string[], enabled = true) {
  return {
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: ADMIN_TOKEN,
    institutionCodes: codes,
    institutions: codes.map((code) => ({ code, name: code, admin_token: `${code}-admin` })),
    teacherAttendanceWritesEnabled: enabled,
  };
}

async function startRelay(db: RelayDatabase, codes: string[], enabled = true) {
  const server = createRelayServer(relayConfig(codes, enabled), new RelayStore(db), {
    now: () => NOW,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    ),
  };
}

function postOpen(url: string, body: unknown, token?: string) {
  return fetch(`${url}/v1/teacher/attendance-sessions/open`, {
    method: "POST",
    headers: {
      Origin: "https://mon-cahier.com",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("le schéma 6 est neuf, migre une base schéma 5 peuplée et ne se rejoue pas", () => {
  const fresh = openRelayDatabase(":memory:");
  assert.equal(schemaVersion(fresh), 8);
  assert.ok(fresh.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teacher_session_open_operations'
  `).get());
  assert.ok(fresh.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_outbox_dependencies'
  `).get());
  fresh.close();

  const directory = mkdtempSync(join(tmpdir(), "moncahier-relay-v6-"));
  const path = join(directory, "schema5.db");
  try {
    const schema5 = createSchema5(path);
    schema5.prepare(`
      INSERT INTO institutions(id, name, code, updated_at)
      VALUES ('inst-legacy', 'Legacy', 'LEG-1', ?)
    `).run(NOW.toISOString());
    schema5.prepare(`
      INSERT INTO sync_outbox(
        operation_id, institution_id, device_id, entity_type, entity_id,
        action, base_server_version, occurred_at, protocol_version
      ) VALUES ('legacy-op', 'inst-legacy', 'legacy-device', 'profile', 'profile-1',
                'upsert', 0, ?, 1)
    `).run(NOW.toISOString());
    schema5.close();

    let migrated = openRelayDatabase(path);
    assert.equal(schemaVersion(migrated), 8);
    assert.equal(count(migrated, "sync_outbox"), 1);
    assert.deepEqual(migrated.pragma("foreign_key_check"), []);
    assert.equal(String(migrated.pragma("integrity_check", { simple: true })), "ok");
    migrated.close();

    migrated = openRelayDatabase(path);
    assert.equal(schemaVersion(migrated), 8);
    assert.equal(Number((migrated.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 6
    `).get() as { count: number }).count), 1);
    assert.equal(count(migrated, "sync_outbox"), 1);
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("un échec injecté de migration 6 revient entièrement au schéma 5", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-relay-v6-rollback-"));
  const path = join(directory, "rollback.db");
  try {
    const schema5 = createSchema5(path);
    schema5.exec(`
      CREATE TRIGGER reject_schema_6
      BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 6
      BEGIN
        SELECT RAISE(ABORT, 'injected_migration_failure');
      END;
    `);
    schema5.close();
    assert.throws(() => openRelayDatabase(path), /injected_migration_failure/);
    const inspected = new Database(path, { readonly: true });
    assert.equal(schemaVersion(inspected), 5);
    assert.equal(inspected.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teacher_session_open_operations'
    `).get(), undefined);
    assert.equal(inspected.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_outbox_dependencies'
    `).get(), undefined);
    assert.equal(String(inspected.pragma("integrity_check", { simple: true })), "ok");
    inspected.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("le flag désactivé refuse l'ouverture sans écriture et conserve connectivity-check", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  seedSchool(db, school);
  const relay = await startRelay(db, [school.code], false);
  const changesBefore = Number((db.prepare("SELECT total_changes() AS count").get() as { count: number }).count);
  try {
    const refused = await postOpen(relay.url, operation(school), teacherToken(school));
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), { error: "teacher_attendance_writes_disabled" });
    assert.equal(Number((db.prepare("SELECT total_changes() AS count").get() as { count: number }).count), changesBefore);

    const connectivity = await fetch(`${relay.url}/v1/teacher/connectivity-check`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${teacherToken(school)}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(connectivity.status, 200);
  } finally {
    await relay.close();
    db.close();
  }
});

test("un professeur valide ouvre une séance dérivée de l'emploi du temps", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  const relay = await startRelay(db, [school.code]);
  const token = teacherToken(school);
  try {
    const response = await postOpen(relay.url, operation(school), token);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://mon-cahier.com");
    const body = await response.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.operation_id, "session-open-operation");
    assert.equal(body.session.class_id, value.classId);
    assert.equal(body.session.subject_id, value.subjectId);
    assert.equal(body.session.period_id, value.periodId);
    assert.notEqual(body.session.id, operation(school).operation_id);
    assert.equal(body.session.client_session_id, body.session.id);
    assert.equal(body.session.started_at, "2026-07-22T09:00:00.000Z");
    assert.ok(String(body.presence_proof).length > 40);

    assert.equal(count(db, "teacher_sessions"), 1);
    assert.equal(count(db, "teacher_session_open_operations"), 1);
    assert.equal(count(db, "sync_outbox"), 1);
    assert.equal(count(db, "sync_records"), 1);
    const receipt = db.prepare(`
      SELECT timetable_id, subject_id, local_session_id, remote_session_id, created_locally
      FROM teacher_session_open_operations
    `).get() as any;
    assert.equal(receipt.timetable_id, value.timetableId);
    assert.equal(receipt.subject_id, value.subjectId);
    assert.equal(receipt.local_session_id, body.session.id);
    assert.equal(receipt.remote_session_id, null);
    assert.equal(receipt.created_locally, 1);

    const stored = db.prepare(`
      SELECT payload_json FROM teacher_session_open_operations
      UNION ALL SELECT payload_json FROM sync_outbox
      UNION ALL SELECT payload_json FROM sync_records
      UNION ALL SELECT details_json AS payload_json FROM audit_log
    `).all().map((row) => String((row as { payload_json: string | null }).payload_json || "")).join("\n");
    assert.equal(stored.includes(token), false);
    assert.equal(stored.includes(String(body.presence_proof)), false);
  } finally {
    await relay.close();
    db.close();
  }
});

test("jeton absent, invalide, Admin, professeur inactif et école non configurée sont refusés", async () => {
  const db = openRelayDatabase(":memory:");
  const active: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const inactive: SchoolSeed = {
    institutionId: "inst-2", code: "SCH-000002", secret: SCHOOL_TWO_SECRET,
    teacherId: "teacher-inactive", prefix: "inactive", activeTeacher: false,
  };
  seedSchool(db, active);
  seedSchool(db, inactive);
  const noRole: SchoolSeed = {
    institutionId: "inst-4", code: "SCH-000004", secret: SCHOOL_TWO_SECRET,
    teacherId: "teacher-no-role", prefix: "no-role", teacherRole: false,
  };
  seedSchool(db, noRole);
  const relay = await startRelay(db, [active.code]);
  try {
    assert.equal((await postOpen(relay.url, operation(active))).status, 401);
    assert.equal((await postOpen(relay.url, operation(active), "invalid-token")).status, 401);
    assert.equal((await postOpen(relay.url, operation(active), ADMIN_TOKEN)).status, 401);
    assert.equal((await postOpen(relay.url, operation(inactive), teacherToken(inactive))).status, 401);
    assert.equal((await postOpen(relay.url, operation(noRole), teacherToken(noRole))).status, 401);

    const other: SchoolSeed = {
      institutionId: "inst-3", code: "SCH-000003", secret: SCHOOL_TWO_SECRET,
      teacherId: "teacher-other", prefix: "other",
    };
    seedSchool(db, other);
    assert.equal((await postOpen(relay.url, operation(other), teacherToken(other))).status, 403);
    assert.equal(count(db, "teacher_sessions"), 0);
  } finally {
    await relay.close();
    db.close();
  }
});

test("classe, créneau et emploi du temps restent cloisonnés par établissement", () => {
  const db = openRelayDatabase(":memory:");
  const schoolOne: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const schoolTwo: SchoolSeed = {
    institutionId: "inst-2", code: "SCH-000002", secret: SCHOOL_TWO_SECRET,
    prefix: "school-two",
  };
  seedSchool(db, schoolOne);
  const second = seedSchool(db, schoolTwo);

  assert.throws(() => openTeacherAttendanceSession(
    db,
    { ...operation(schoolOne), class_id: second.classId },
    teacher(schoolOne),
    NOW,
  ), (error: unknown) => error instanceof TeacherSessionOpenError && error.code === "class_not_found");
  assert.throws(() => openTeacherAttendanceSession(
    db,
    { ...operation(schoolOne), period_id: second.periodId },
    teacher(schoolOne),
    NOW,
  ), (error: unknown) => error instanceof TeacherSessionOpenError && error.code === "period_not_found");

  db.prepare("DELETE FROM teacher_timetables WHERE institution_id = ?").run(schoolOne.institutionId);
  assert.throws(() => openTeacherAttendanceSession(
    db,
    operation(schoolOne, "no-timetable"),
    teacher(schoolOne),
    NOW,
  ), (error: unknown) =>
    error instanceof TeacherSessionOpenError && error.code === "teacher_not_scheduled_for_slot"
  );
  assert.equal(count(db, "teacher_sessions"), 0);
  db.close();
});

test("une correspondance d'emploi du temps ambiguë est refusée", () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  db.prepare(`
    INSERT INTO subjects(id, institution_id, name, updated_at)
    VALUES ('subject-2', ?, 'Autre matière', ?)
  `).run(school.institutionId, NOW.toISOString());
  db.prepare(`
    INSERT INTO teacher_timetables(
      id, institution_id, class_id, subject_id, teacher_id, period_id, weekday, updated_at
    ) VALUES ('timetable-2', ?, ?, 'subject-2', ?, ?, 3, ?)
  `).run(school.institutionId, value.classId, value.teacherId, value.periodId, NOW.toISOString());
  assert.throws(() => openTeacherAttendanceSession(
    db,
    operation(school),
    teacher(school),
    NOW,
  ), (error: unknown) =>
    error instanceof TeacherSessionOpenError && error.code === "teacher_timetable_ambiguous"
  );
  assert.equal(count(db, "teacher_sessions"), 0);
  db.close();
});

test("hors fenêtre, jour non programmé et dimanche sont refusés selon l'heure du relais", () => {
  const outsideDb = openRelayDatabase(":memory:");
  const outside: SchoolSeed = {
    institutionId: "inst-out", code: "SCH-OUT", secret: SCHOOL_ONE_SECRET,
  };
  seedSchool(outsideDb, outside);
  assert.throws(() => openTeacherAttendanceSession(
    outsideDb,
    operation(outside),
    teacher(outside),
    new Date("2026-07-22T10:00:00.000Z"),
  ), (error: unknown) =>
    error instanceof TeacherSessionOpenError && error.code === "attendance_outside_slot"
  );
  outsideDb.close();

  const wrongDayDb = openRelayDatabase(":memory:");
  const wrongDay: SchoolSeed = {
    institutionId: "inst-day", code: "SCH-DAY", secret: SCHOOL_ONE_SECRET, weekday: 4,
  };
  seedSchool(wrongDayDb, wrongDay);
  assert.throws(() => openTeacherAttendanceSession(
    wrongDayDb,
    operation(wrongDay),
    teacher(wrongDay),
    NOW,
  ), (error: unknown) =>
    error instanceof TeacherSessionOpenError && error.code === "attendance_outside_slot"
  );
  wrongDayDb.close();

  const sundayDb = openRelayDatabase(":memory:");
  const sunday: SchoolSeed = {
    institutionId: "inst-sun", code: "SCH-SUN", secret: SCHOOL_ONE_SECRET, weekday: 7,
  };
  seedSchool(sundayDb, sunday);
  assert.throws(() => openTeacherAttendanceSession(
    sundayDb,
    operation(sunday),
    teacher(sunday),
    new Date("2026-07-26T09:15:00.000Z"),
  ), (error: unknown) =>
    error instanceof TeacherSessionOpenError && error.code === "attendance_sunday_not_allowed"
  );
  sundayDb.close();
});

test("le même operation_id est idempotent et un contenu différent retourne 409", () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  seedSchool(db, school);
  const first = openTeacherAttendanceSession(db, operation(school), teacher(school), NOW);
  const retry = openTeacherAttendanceSession(db, operation(school), teacher(school), NOW);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.session.id, first.session.id);
  assert.equal(count(db, "teacher_sessions"), 1);
  assert.equal(count(db, "sync_outbox"), 1);
  assert.throws(() => openTeacherAttendanceSession(
    db,
    { ...operation(school), class_id: "different-class" },
    teacher(school),
    NOW,
  ), (error: unknown) =>
    error instanceof TeacherSessionOpenError &&
    error.code === "operation_id_reused_with_different_payload"
  );
  db.close();
});

test("une ouverture live déjà acceptée reste idempotente lors du rejeu hors ligne", () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-live-replay",
    code: "SCH-LIVE-REPLAY",
    secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  setInstitutionMeta(db, school.institutionId, "attendance_schedule_revision", "1");

  const operationId = "live-response-lost-operation";
  const first = openTeacherAttendanceSession(
    db,
    operation(school, operationId),
    teacher(school),
    NOW,
  );

  // Le planning a changé après l'acceptation. Le rejeu ne doit pas recréer ni
  // refuser une opération déjà durablement enregistrée sur le relais.
  setInstitutionMeta(db, school.institutionId, "attendance_schedule_revision", "2");
  const retry = openTeacherAttendanceSession(
    db,
    {
      protocol_version: 2,
      operation_id: operationId,
      operation_type: "attendance.session.open",
      class_id: value.classId,
      period_id: value.periodId,
      event_at: NOW.toISOString(),
      replay_context: {
        mode: "offline_replay",
        queued_at: new Date(NOW.getTime() + 60_000).toISOString(),
        client_session_id: `client:${operationId}`,
        schedule_revision: 1,
        timezone: "UTC",
        scheduled_start_at: "2026-07-22T09:00:00.000Z",
      },
    },
    teacher(school),
    new Date("2026-07-22T11:00:00.000Z"),
  );

  assert.equal(retry.idempotent, true);
  assert.equal(retry.session.id, first.session.id);
  assert.equal(count(db, "teacher_sessions"), 1);
  assert.equal(count(db, "teacher_session_open_operations"), 1);
  assert.equal(count(db, "sync_outbox"), 1);
  db.close();
});

test("plusieurs clics concurrents et une réponse perdue retrouvent une seule séance", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  seedSchool(db, school);
  const relay = await startRelay(db, [school.code]);
  try {
    const requests = await Promise.all(Array.from({ length: 5 }, () =>
      postOpen(relay.url, operation(school, "rapid-click"), teacherToken(school))
    ));
    const bodies = await Promise.all(requests.map((response) => response.json() as Promise<any>));
    assert.ok(requests.every((response) => response.status === 201 || response.status === 200));
    assert.equal(new Set(bodies.map((body) => body.session.id)).size, 1);
    assert.equal(count(db, "teacher_sessions"), 1);
    assert.equal(count(db, "teacher_session_open_operations"), 1);
    assert.equal(count(db, "sync_outbox"), 1);

    const lostResponseRetry = await postOpen(
      relay.url,
      operation(school, "rapid-click"),
      teacherToken(school),
    );
    assert.equal(lostResponseRetry.status, 200);
    assert.equal((await lostResponseRetry.json() as any).session.id, bodies[0].session.id);
  } finally {
    await relay.close();
    db.close();
  }
});

test("un redémarrage conserve l'identité locale et le registre remote nullable", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-session-restart-"));
  const path = join(directory, "relay.db");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  try {
    const firstDb = openRelayDatabase(path);
    seedSchool(firstDb, school);
    const first = openTeacherAttendanceSession(firstDb, operation(school), teacher(school), NOW);
    firstDb.close();

    const reopened = openRelayDatabase(path);
    const retry = openTeacherAttendanceSession(reopened, operation(school), teacher(school), NOW);
    assert.equal(retry.session.id, first.session.id);
    const mapping = reopened.prepare(`
      SELECT local_session_id, remote_session_id FROM teacher_session_open_operations
    `).get() as { local_session_id: string; remote_session_id: string | null };
    assert.equal(mapping.local_session_id, first.session.id);
    assert.equal(mapping.remote_session_id, null);
    reopened.prepare(`
      UPDATE teacher_session_open_operations
      SET remote_session_id = 'cloud-session-1', state = 'synced_with_cloud', updated_at = ?
      WHERE institution_id = ? AND operation_id = ?
    `).run(NOW.toISOString(), school.institutionId, operation(school).operation_id);
    reopened.close();

    const reconciled = openRelayDatabase(path);
    const durableMapping = reconciled.prepare(`
      SELECT local_session_id, remote_session_id, state
      FROM teacher_session_open_operations
    `).get() as { local_session_id: string; remote_session_id: string; state: string };
    assert.deepEqual(durableMapping, {
      local_session_id: first.session.id,
      remote_session_id: "cloud-session-1",
      state: "synced_with_cloud",
    });
    reconciled.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deux écoles peuvent réutiliser les mêmes identifiants et operation_id", () => {
  const db = openRelayDatabase(":memory:");
  const schoolOne: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const schoolTwo: SchoolSeed = {
    institutionId: "inst-2", code: "SCH-000002", secret: SCHOOL_TWO_SECRET,
  };
  seedSchool(db, schoolOne);
  seedSchool(db, schoolTwo);
  const first = openTeacherAttendanceSession(db, operation(schoolOne, "same-op"), teacher(schoolOne), NOW);
  const second = openTeacherAttendanceSession(db, operation(schoolTwo, "same-op"), teacher(schoolTwo), NOW);
  assert.notEqual(first.session.id, second.session.id);
  assert.equal(count(db, "teacher_session_open_operations"), 2);
  assert.equal(count(db, "teacher_sessions"), 2);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("la route d'un relais de groupe ouvre et cloisonne les deux écoles autorisées", async () => {
  const db = openRelayDatabase(":memory:");
  const schoolOne: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const schoolTwo: SchoolSeed = {
    institutionId: "inst-2", code: "SCH-000002", secret: SCHOOL_TWO_SECRET,
  };
  seedSchool(db, schoolOne);
  seedSchool(db, schoolTwo);
  const relay = await startRelay(db, [schoolOne.code, schoolTwo.code]);
  try {
    const first = await postOpen(relay.url, operation(schoolOne, "group-shared-op"), teacherToken(schoolOne));
    const second = await postOpen(relay.url, operation(schoolTwo, "group-shared-op"), teacherToken(schoolTwo));
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstBody = await first.json() as any;
    const secondBody = await second.json() as any;
    assert.notEqual(firstBody.session.id, secondBody.session.id);
    assert.equal(Number((db.prepare(`
      SELECT COUNT(*) AS count FROM teacher_sessions WHERE institution_id = ?
    `).get(schoolOne.institutionId) as { count: number }).count), 1);
    assert.equal(Number((db.prepare(`
      SELECT COUNT(*) AS count FROM teacher_sessions WHERE institution_id = ?
    `).get(schoolTwo.institutionId) as { count: number }).count), 1);
    assert.equal(Number((db.prepare(`
      SELECT COUNT(*) AS count FROM teacher_session_open_operations
      WHERE operation_id = 'group-shared-op'
    `).get() as { count: number }).count), 2);
  } finally {
    await relay.close();
    db.close();
  }
});

test("une séance concurrente différente est refusée et jamais terminée automatiquement", () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  db.prepare(`
    INSERT INTO teacher_sessions(
      id, institution_id, client_session_id, class_id, subject_id, teacher_id,
      period_id, started_at, actual_call_at, ended_at, origin, updated_at
    ) VALUES ('existing-session', ?, 'existing-session', ?, ?, ?, ?,
              '2026-07-21T08:00:00.000Z', NULL, NULL, 'teacher', ?)
  `).run(
    school.institutionId,
    value.classId,
    value.subjectId,
    value.teacherId,
    value.periodId,
    NOW.toISOString(),
  );
  assert.throws(() => openTeacherAttendanceSession(
    db,
    operation(school),
    teacher(school),
    NOW,
  ), (error: unknown) =>
    error instanceof TeacherSessionOpenError && error.code === "concurrent_session_open"
  );
  const existing = db.prepare(`
    SELECT ended_at FROM teacher_sessions WHERE institution_id = ? AND id = 'existing-session'
  `).get(school.institutionId) as { ended_at: string | null };
  assert.equal(existing.ended_at, null);
  assert.equal(count(db, "teacher_session_open_operations"), 0);
  db.close();
});

test("l'appel utilise immédiatement la preuve et dépend de l'ouverture dans l'outbox", () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  const opened = openTeacherAttendanceSession(
    db,
    operation(school, "parent-open"),
    teacher(school),
    NOW,
  );
  const attendance = secureTeacherAttendanceOperation(db, {
    protocol_version: 1,
    operation_id: "child-attendance",
    operation_type: "attendance.call.submit",
    session_id: opened.session.id,
    class_id: value.classId,
    period_id: value.periodId,
    presence_proof: opened.presence_proof,
    marks: [{ student_id: value.studentId, status: "present", comment: null }],
  }, teacher(school), NOW);
  assert.equal(attendance.state, "secured_on_relay");
  assert.equal(count(db, "sync_outbox"), 2);
  assert.equal(count(db, "sync_outbox_dependencies"), 1);
  const dependency = db.prepare(`
    SELECT operation_id, depends_on_operation_id FROM sync_outbox_dependencies
  `).get() as { operation_id: string; depends_on_operation_id: string };
  assert.deepEqual(dependency, {
    operation_id: "child-attendance",
    depends_on_operation_id: "parent-open",
  });

  const store = new RelayStore(db);
  assert.deepEqual(store.listPending().map((item: any) => item.operation_id), ["parent-open"]);
  db.prepare(`
    DELETE FROM sync_outbox WHERE institution_id = ? AND operation_id = 'parent-open'
  `).run(school.institutionId);
  assert.deepEqual(store.listPending().map((item: any) => item.operation_id), ["child-attendance"]);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(String(db.pragma("integrity_check", { simple: true })), "ok");
  db.close();
});

test("une interruption transactionnelle ne laisse aucune demi-séance", () => {
  for (const stage of ["after_session", "after_receipt", "after_outbox", "after_sync_record"] as const) {
    const db = openRelayDatabase(":memory:");
    const school: SchoolSeed = {
      institutionId: `inst-${stage}`, code: `SCH-${stage}`, secret: SCHOOL_ONE_SECRET,
    };
    seedSchool(db, school);
    assert.throws(() => openTeacherAttendanceSession(
      db,
      operation(school),
      teacher(school),
      NOW,
      { faultInjector: (current) => {
        if (current === stage) throw new Error("injected_transaction_failure");
      } },
    ), /injected_transaction_failure/);
    assert.equal(count(db, "teacher_sessions"), 0);
    assert.equal(count(db, "teacher_session_open_operations"), 0);
    assert.equal(count(db, "sync_outbox"), 0);
    assert.equal(count(db, "sync_records"), 0);
    assert.equal(count(db, "audit_log"), 0);
    db.close();
  }
});

test("un bootstrap ultérieur ne remplace pas la séance locale dirty", () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  const opened = openTeacherAttendanceSession(db, operation(school), teacher(school), NOW);
  const settings = {
    attendance_presence: {
      enabled: true,
      allow_local_relay: true,
      relay_presence_secret: school.secret,
      relay_proof_ttl_seconds: 180,
    },
  };
  const result = new RelayStore(db).bootstrap({
    protocol_version: 1,
    snapshot_id: "cloud-after-local-session",
    institution_id: school.institutionId,
    generated_at: "2026-07-22T09:20:00.000Z",
    cursor: "2026-07-22T09:20:00.000Z",
    institution: {
      id: school.institutionId,
      name: school.code,
      code: school.code,
      timezone: "UTC",
      settings_json: settings,
      server_version: 1,
      updated_at: "2026-07-22T09:20:00.000Z",
    },
    entities: {
      teacher_sessions: [{
        id: opened.session.id,
        institution_id: school.institutionId,
        client_session_id: opened.session.id,
        class_id: value.classId,
        subject_id: value.subjectId,
        teacher_id: value.teacherId,
        period_id: value.periodId,
        started_at: "2026-07-22T09:00:00.000Z",
        actual_call_at: null,
        ended_at: "2026-07-22T09:05:00.000Z",
        origin: "teacher",
        server_version: 2,
        updated_at: "2026-07-22T09:20:00.000Z",
      }],
    },
    diagnostics: { skipped_count: 0, skipped: [] },
  });
  assert.equal(result.preserved_local_entities, 1);
  const session = db.prepare(`
    SELECT actual_call_at, ended_at FROM teacher_sessions
    WHERE institution_id = ? AND id = ?
  `).get(school.institutionId, opened.session.id) as {
    actual_call_at: string | null;
    ended_at: string | null;
  };
  assert.equal(session.actual_call_at, NOW.toISOString());
  assert.equal(session.ended_at, null);
  assert.equal(count(db, "sync_outbox"), 1);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("CORS, taille du corps, intégrité et absence de Finance restent garantis", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  seedSchool(db, school);
  const relay = await startRelay(db, [school.code]);
  try {
    const preflight = await fetch(`${relay.url}/v1/teacher/attendance-sessions/open`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://mon-cahier.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://mon-cahier.com");
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

    const inventedSession = await postOpen(
      relay.url,
      {
        ...operation(school),
        session_id: "phone-chosen-session",
        started_at: "2026-07-22T09:15:00.000Z",
      },
      teacherToken(school),
    );
    assert.equal(inventedSession.status, 400);
    assert.deepEqual(await inventedSession.json(), { error: "operation_field_not_supported" });
    assert.equal(count(db, "teacher_sessions"), 0);

    const oversized = await postOpen(
      relay.url,
      { ...operation(school), padding: "x".repeat(20_000) },
      teacherToken(school),
    );
    assert.equal(oversized.status, 413);
    assert.equal(count(db, "teacher_sessions"), 0);

    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.equal(String(db.pragma("integrity_check", { simple: true })), "ok");
    const migrationSql = readFileSync(
      new URL("../migrations/0006_teacher_session_open.sql", import.meta.url),
      "utf8",
    );
    assert.equal(/finance|payment|receipt|cash|payroll|expense|budget/i.test(migrationSql), false);
    assert.equal(canonicalJson(operation(school)).includes("token"), false);
  } finally {
    await relay.close();
    db.close();
  }
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { attendanceMonitor } from "../src/attendance-monitor.mjs";
import { openRelayDatabase, schemaVersion, type RelayDatabase } from "../src/db.mjs";
import { canonicalJson } from "../src/json.mjs";
import { createRelayServer } from "../src/server.mjs";
import { RelayStore } from "../src/store.mjs";
import { secureTeacherAttendanceOperation } from "../src/teacher-attendance.mjs";

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
  presenceEnabled?: boolean;
  activeTeacher?: boolean;
};

function ids(seed: SchoolSeed) {
  const prefix = seed.prefix || "shared";
  return {
    teacherId: seed.teacherId || "teacher-shared",
    classId: `${prefix}-class`,
    subjectId: `${prefix}-subject`,
    periodId: `${prefix}-period`,
    sessionId: `${prefix}-session`,
    clientSessionId: `${prefix}-client-session`,
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
        enabled: seed.presenceEnabled !== false,
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
  `).run(value.teacherId, seed.institutionId, seed.activeTeacher === false ? 0 : 1, updatedAt);
  db.prepare(`
    INSERT INTO user_roles(id, institution_id, profile_id, role, updated_at)
    VALUES (?, ?, ?, 'teacher', ?)
  `).run(`role:${value.teacherId}`, seed.institutionId, value.teacherId, updatedAt);
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
    ) VALUES (?, ?, 3, 'Créneau test', '09:00', '10:00', ?)
  `).run(value.periodId, seed.institutionId, updatedAt);
  db.prepare(`
    INSERT INTO teacher_timetables(
      id, institution_id, class_id, subject_id, teacher_id,
      period_id, weekday, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 3, ?)
  `).run(
    `timetable:${value.teacherId}`,
    seed.institutionId,
    value.classId,
    value.subjectId,
    value.teacherId,
    value.periodId,
    updatedAt,
  );
  db.prepare(`
    INSERT INTO teacher_sessions(
      id, institution_id, client_session_id, class_id, subject_id,
      teacher_id, period_id, started_at, actual_call_at, origin, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-07-22T09:00:00.000Z', NULL, 'teacher', ?)
  `).run(
    value.sessionId,
    seed.institutionId,
    value.clientSessionId,
    value.classId,
    value.subjectId,
    value.teacherId,
    value.periodId,
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

function presenceProof(
  seed: SchoolSeed,
  options: { clientSessionId?: string; issuedAt?: Date; expiresAt?: Date } = {},
) {
  const value = ids(seed);
  const issuedAt = options.issuedAt || new Date(NOW.getTime() - 30_000);
  const expiresAt = options.expiresAt || new Date(NOW.getTime() + 150_000);
  const payload = {
    v: 1,
    institution_id: seed.institutionId,
    actor_profile_id: value.teacherId,
    client_session_id: options.clientSessionId || value.clientSessionId,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    source: "local_relay",
  };
  const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  return `${encoded}.${createHmac("sha256", seed.secret).update(encoded).digest("base64url")}`;
}

function operation(seed: SchoolSeed, operationId = "attendance-operation-1") {
  const value = ids(seed);
  return {
    protocol_version: 1,
    operation_id: operationId,
    operation_type: "attendance.call.submit",
    session_id: value.sessionId,
    class_id: value.classId,
    period_id: value.periodId,
    presence_proof: presenceProof(seed),
    marks: [
      { student_id: value.studentId, status: "late", comment: "Transport local" },
    ],
  };
}

function relayConfig(codes: string[], enabled: boolean) {
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

async function startRelay(
  db: RelayDatabase,
  codes: string[],
  enabled = true,
  now = NOW,
) {
  const server = createRelayServer(relayConfig(codes, enabled), new RelayStore(db), {
    now: () => now,
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

function postOperation(url: string, body: unknown, token?: string) {
  return fetch(`${url}/v1/teacher/attendance-operations`, {
    method: "POST",
    headers: {
      Origin: "https://mon-cahier.com",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function count(db: RelayDatabase, table: string) {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function createSchema4(path: string) {
  const db = new Database(path);
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
  ] as const;
  for (const [version, name, file] of migrations) {
    const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    if (version === 4) db.pragma("foreign_keys = OFF");
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

test("le schéma 5 est neuf, rejouable et préserve une base schéma 4 peuplée", () => {
  const fresh = openRelayDatabase(":memory:");
  assert.equal(schemaVersion(fresh), 8);
  assert.ok(fresh.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teacher_attendance_operations'
  `).get());
  const outboxColumns = fresh.pragma("table_info(sync_outbox)") as Array<{ name: string }>;
  assert.ok(outboxColumns.some((column) => column.name === "protocol_version"));
  assert.ok(outboxColumns.some((column) => column.name === "payload_fingerprint"));
  fresh.close();

  const directory = mkdtempSync(join(tmpdir(), "moncahier-relay-v5-"));
  const path = join(directory, "schema4.db");
  try {
    const schema4 = createSchema4(path);
    schema4.prepare(`
      INSERT INTO institutions(id, name, code, updated_at) VALUES ('inst-legacy', 'Legacy', 'LEG-1', ?)
    `).run(NOW.toISOString());
    schema4.prepare(`
      INSERT INTO sync_outbox(
        operation_id, institution_id, device_id, entity_type, entity_id,
        action, base_server_version, occurred_at
      ) VALUES ('legacy-op', 'inst-legacy', 'legacy-device', 'profile', 'profile-1',
                'upsert', 0, ?)
    `).run(NOW.toISOString());
    schema4.close();

    const migrated = openRelayDatabase(path);
    assert.equal(schemaVersion(migrated), 8);
    const legacy = migrated.prepare(`
      SELECT protocol_version, payload_fingerprint FROM sync_outbox
      WHERE institution_id = 'inst-legacy' AND operation_id = 'legacy-op'
    `).get() as { protocol_version: number; payload_fingerprint: string | null };
    assert.equal(legacy.protocol_version, 1);
    assert.equal(legacy.payload_fingerprint, null);
    migrated.close();

    const replayed = openRelayDatabase(path);
    assert.equal(schemaVersion(replayed), 8);
    assert.equal(Number((replayed.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 5
    `).get() as { count: number }).count), 1);
    replayed.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("un échec de migration 5 revient entièrement au schéma 4", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-relay-v5-rollback-"));
  const path = join(directory, "rollback.db");
  try {
    const schema4 = createSchema4(path);
    schema4.exec(`
      CREATE TRIGGER reject_schema_5
      BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 5
      BEGIN
        SELECT RAISE(ABORT, 'injected_migration_failure');
      END;
    `);
    schema4.close();
    assert.throws(() => openRelayDatabase(path), /injected_migration_failure/);

    const inspected = new Database(path, { readonly: true });
    assert.equal(Number((inspected.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get() as { version: number }).version), 4);
    assert.equal(inspected.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teacher_attendance_operations'
    `).get(), undefined);
    const columns = inspected.pragma("table_info(sync_outbox)") as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === "protocol_version"), false);
    assert.equal(columns.some((column) => column.name === "payload_fingerprint"), false);
    inspected.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("le feature flag désactivé refuse toute écriture mais conserve connectivity-check", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  seedSchool(db, school);
  const relay = await startRelay(db, [school.code], false);
  const changesBefore = db.prepare("SELECT total_changes() AS count").get() as { count: number };
  try {
    const refused = await postOperation(relay.url, operation(school), teacherToken(school));
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), { error: "teacher_attendance_writes_disabled" });
    assert.equal(count(db, "teacher_attendance_operations"), 0);
    assert.equal(count(db, "sync_outbox"), 0);
    assert.deepEqual(db.prepare("SELECT total_changes() AS count").get(), changesBefore);

    const connectivity = await fetch(`${relay.url}/v1/teacher/connectivity-check`, {
      method: "POST",
      headers: {
        Origin: "https://mon-cahier.com",
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken(school)}`,
      },
      body: "{}",
    });
    assert.equal(connectivity.status, 200);
  } finally {
    await relay.close();
    db.close();
  }
});

test("un professeur valide sécurise et matérialise atomiquement son appel", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  const token = teacherToken(school);
  const proof = presenceProof(school);
  const body = { ...operation(school), presence_proof: proof };
  const relay = await startRelay(db, [school.code]);
  try {
    const response = await postOperation(relay.url, body, token);
    assert.equal(response.status, 202);
    const result = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(result).sort(), [
      "idempotent", "ok", "operation_id", "relay_time", "state",
    ]);
    assert.equal(result.state, "secured_on_relay");
    assert.equal(result.idempotent, false);
    assert.equal(count(db, "teacher_attendance_operations"), 1);
    assert.equal(count(db, "sync_outbox"), 1);
    assert.equal(count(db, "attendance_marks"), 1);
    const materializedMark = db.prepare(`
      SELECT id FROM attendance_marks
      WHERE institution_id = ? AND session_id = ? AND student_id = ?
    `).get(school.institutionId, value.sessionId, value.studentId) as { id: string };
    assert.equal(materializedMark.id, `${value.sessionId}:${value.studentId}`);
    const outbox = db.prepare(`
      SELECT institution_id, actor_profile_id, entity_type, state,
             protocol_version, payload_fingerprint
      FROM sync_outbox
    `).get() as Record<string, unknown>;
    assert.equal(outbox.institution_id, school.institutionId);
    assert.equal(outbox.actor_profile_id, value.teacherId);
    assert.equal(outbox.entity_type, "attendance_call");
    assert.equal(outbox.state, "pending");
    assert.equal(outbox.protocol_version, 1);
    assert.match(String(outbox.payload_fingerprint), /^[a-f0-9]{64}$/);
    const session = db.prepare(`
      SELECT actual_call_at, period_id FROM teacher_sessions
      WHERE institution_id = ? AND id = ?
    `).get(school.institutionId, value.sessionId) as {
      actual_call_at: string | null;
      period_id: string | null;
    };
    assert.equal(session.actual_call_at, NOW.toISOString());
    assert.equal(session.period_id, value.periodId);
    const dirty = db.prepare(`
      SELECT entity_type, local_dirty FROM sync_records
      WHERE institution_id = ? ORDER BY entity_type
    `).all(school.institutionId) as Array<{ entity_type: string; local_dirty: number }>;
    assert.deepEqual(dirty.map((row) => row.entity_type), ["attendance_mark", "teacher_session"]);
    assert.ok(dirty.every((row) => row.local_dirty === 1));

    const monitor = attendanceMonitor(db, {
      institutionId: school.institutionId,
      from: "2026-07-22",
      to: "2026-07-22",
      now: NOW,
    });
    assert.equal(monitor.length, 1);
    assert.equal(monitor[0]?.status, "ok");

    const storedText = (db.prepare(`
      SELECT group_concat(value, '') AS value FROM (
        SELECT payload_json AS value FROM teacher_attendance_operations
        UNION ALL SELECT payload_json FROM sync_outbox
        UNION ALL SELECT details_json FROM audit_log
      )
    `).get() as { value: string }).value;
    assert.equal(storedText.includes(token), false);
    assert.equal(storedText.includes(proof), false);
  } finally {
    await relay.close();
    db.close();
  }
});

test("captured_at_device reste distinct de l'acceptation relais et pilote l'heure métier", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  const capturedAt = "2026-07-22T09:10:00.000Z";
  const relay = await startRelay(db, [school.code]);
  try {
    const response = await postOperation(relay.url, {
      ...operation(school, "captured-attendance"),
      captured_at_device: capturedAt,
    }, teacherToken(school));
    assert.equal(response.status, 202);

    const receipt = db.prepare(`
      SELECT accepted_at, payload_json
      FROM teacher_attendance_operations
      WHERE institution_id = ? AND operation_id = ?
    `).get(school.institutionId, "captured-attendance") as {
      accepted_at: string;
      payload_json: string;
    };
    assert.equal(receipt.accepted_at, NOW.toISOString());
    assert.equal(JSON.parse(receipt.payload_json).captured_at_device, capturedAt);
    const outbox = db.prepare(`
      SELECT occurred_at FROM sync_outbox
      WHERE institution_id = ? AND operation_id = ?
    `).get(school.institutionId, "captured-attendance") as { occurred_at: string };
    assert.equal(outbox.occurred_at, capturedAt);
    const session = db.prepare(`
      SELECT actual_call_at, attendance_durable_at, updated_at
      FROM teacher_sessions WHERE institution_id = ? AND id = ?
    `).get(school.institutionId, value.sessionId) as {
      actual_call_at: string;
      attendance_durable_at: string;
      updated_at: string;
    };
    assert.equal(session.actual_call_at, capturedAt);
    assert.equal(session.attendance_durable_at, NOW.toISOString());
    assert.equal(session.updated_at, NOW.toISOString());
  } finally {
    await relay.close();
    db.close();
  }
});

test("l'authentification refuse absence, invalidité, jeton Admin et professeur inactif", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  const relay = await startRelay(db, [school.code]);
  try {
    assert.equal((await postOperation(relay.url, operation(school))).status, 401);
    assert.equal((await postOperation(relay.url, operation(school), "invalid-token")).status, 401);
    assert.equal((await postOperation(relay.url, operation(school), ADMIN_TOKEN)).status, 401);
    db.prepare(`UPDATE profiles SET is_active = 0 WHERE institution_id = ? AND id = ?`)
      .run(school.institutionId, value.teacherId);
    assert.equal((await postOperation(relay.url, operation(school), teacherToken(school))).status, 401);
    assert.equal(count(db, "teacher_attendance_operations"), 0);
    assert.equal(count(db, "sync_outbox"), 0);
  } finally {
    await relay.close();
    db.close();
  }
});

test("un relais de groupe cloisonne écoles, professeurs et operation_id identiques", async () => {
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
    const sharedOperationId = "same-operation-in-two-schools";
    assert.equal((await postOperation(
      relay.url,
      operation(schoolOne, sharedOperationId),
      teacherToken(schoolOne),
    )).status, 202);
    assert.equal((await postOperation(
      relay.url,
      operation(schoolTwo, sharedOperationId),
      teacherToken(schoolTwo),
    )).status, 202);
    assert.equal(Number((db.prepare(`
      SELECT COUNT(*) AS count FROM teacher_attendance_operations WHERE operation_id = ?
    `).get(sharedOperationId) as { count: number }).count), 2);
    assert.equal(Number((db.prepare(`
      SELECT COUNT(DISTINCT institution_id) AS count
      FROM sync_outbox WHERE operation_id = ?
    `).get(sharedOperationId) as { count: number }).count), 2);
  } finally {
    await relay.close();
    db.close();
  }
});

test("un établissement non configuré et les identifiants d'une autre école sont refusés", async () => {
  const db = openRelayDatabase(":memory:");
  const schoolOne: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET, prefix: "one",
  };
  const schoolTwo: SchoolSeed = {
    institutionId: "inst-2", code: "SCH-000002", secret: SCHOOL_TWO_SECRET, prefix: "two",
  };
  seedSchool(db, schoolOne);
  const second = seedSchool(db, schoolTwo);
  const relay = await startRelay(db, [schoolOne.code]);
  try {
    const unconfigured = await postOperation(
      relay.url,
      operation(schoolTwo),
      teacherToken(schoolTwo),
    );
    assert.equal(unconfigured.status, 403);
    assert.deepEqual(await unconfigured.json(), { error: "institution_not_allowed" });

    const wrongStudent = operation(schoolOne, "wrong-school-student");
    wrongStudent.marks[0]!.student_id = second.studentId;
    const refusedStudent = await postOperation(relay.url, wrongStudent, teacherToken(schoolOne));
    assert.equal(refusedStudent.status, 404);
    assert.deepEqual(await refusedStudent.json(), { error: "student_not_found" });

    const wrongSession = {
      ...operation(schoolOne, "wrong-school-session"),
      session_id: second.sessionId,
    };
    assert.equal((await postOperation(relay.url, wrongSession, teacherToken(schoolOne))).status, 404);

    const wrongClass = {
      ...operation(schoolOne, "wrong-school-class"),
      class_id: second.classId,
    };
    const refusedClass = await postOperation(relay.url, wrongClass, teacherToken(schoolOne));
    assert.equal(refusedClass.status, 403);
    assert.deepEqual(await refusedClass.json(), { error: "class_mismatch" });

    const wrongPeriod = {
      ...operation(schoolOne, "wrong-school-period"),
      period_id: second.periodId,
    };
    const refusedPeriod = await postOperation(relay.url, wrongPeriod, teacherToken(schoolOne));
    assert.equal(refusedPeriod.status, 403);
    assert.deepEqual(await refusedPeriod.json(), { error: "period_mismatch" });
    assert.equal(count(db, "teacher_attendance_operations"), 0);
  } finally {
    await relay.close();
    db.close();
  }
});

test("la preuve locale reste optionnelle lorsque la politique de présence est désactivée", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1",
    code: "SCH-000001",
    secret: SCHOOL_ONE_SECRET,
    presenceEnabled: false,
  };
  seedSchool(db, school);
  const body = operation(school, "presence-not-required") as Record<string, unknown>;
  delete body.presence_proof;
  const relay = await startRelay(db, [school.code]);
  try {
    const response = await postOperation(relay.url, body, teacherToken(school));
    assert.equal(response.status, 202);
    assert.equal((await response.json() as Record<string, unknown>).state, "secured_on_relay");
    assert.equal(count(db, "teacher_attendance_operations"), 1);
  } finally {
    await relay.close();
    db.close();
  }
});

test("l'idempotence réutilise le même résultat et détecte le contenu différent", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  seedSchool(db, school);
  const relay = await startRelay(db, [school.code]);
  const body = operation(school, "stable-operation-id");
  try {
    const first = await postOperation(relay.url, body, teacherToken(school));
    assert.equal(first.status, 202);
    const firstBody = await first.json() as Record<string, unknown>;
    const duplicate = await postOperation(relay.url, body, teacherToken(school));
    assert.equal(duplicate.status, 200);
    const duplicateBody = await duplicate.json() as Record<string, unknown>;
    assert.equal(duplicateBody.idempotent, true);
    assert.equal(duplicateBody.relay_time, firstBody.relay_time);
    assert.equal(count(db, "teacher_attendance_operations"), 1);
    assert.equal(count(db, "sync_outbox"), 1);

    const changed = structuredClone(body);
    changed.marks[0]!.status = "absent";
    const conflict = await postOperation(relay.url, changed, teacherToken(school));
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {
      error: "operation_id_reused_with_different_payload",
    });
  } finally {
    await relay.close();
    db.close();
  }
});

test("les dépendances absentes et l'affectation professeur sont diagnostiquées", async () => {
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };

  const cases: Array<{
    name: string;
    expected: string;
    mutate: (db: RelayDatabase, body: ReturnType<typeof operation>, value: ReturnType<typeof ids>) => void;
  }> = [
    {
      name: "session",
      expected: "session_not_found",
      mutate: (_db, body) => { body.session_id = "missing-session"; },
    },
    {
      name: "classe",
      expected: "class_not_found",
      mutate: (db, _body, value) => {
        db.pragma("foreign_keys = OFF");
        db.prepare("DELETE FROM classes WHERE institution_id = ? AND id = ?")
          .run(school.institutionId, value.classId);
        db.pragma("foreign_keys = ON");
      },
    },
    {
      name: "créneau",
      expected: "period_not_found",
      mutate: (db, _body, value) => {
        db.pragma("foreign_keys = OFF");
        db.prepare("DELETE FROM institution_periods WHERE institution_id = ? AND id = ?")
          .run(school.institutionId, value.periodId);
        db.pragma("foreign_keys = ON");
      },
    },
    {
      name: "élève",
      expected: "student_not_found",
      mutate: (_db, body) => { body.marks[0]!.student_id = "missing-student"; },
    },
    {
      name: "inscription",
      expected: "student_not_enrolled",
      mutate: (db) => { db.prepare("DELETE FROM class_enrollments").run(); },
    },
    {
      name: "affectation",
      expected: "teacher_not_scheduled_for_slot",
      mutate: (db) => { db.prepare("DELETE FROM teacher_timetables").run(); },
    },
  ];

  for (const scenario of cases) {
    const db = openRelayDatabase(":memory:");
    const value = seedSchool(db, school);
    const body = operation(school, `missing-${scenario.name}`);
    scenario.mutate(db, body, value);
    const relay = await startRelay(db, [school.code]);
    try {
      const response = await postOperation(relay.url, body, teacherToken(school));
      assert.deepEqual(await response.json(), { error: scenario.expected });
      assert.equal(count(db, "teacher_attendance_operations"), 0);
      assert.equal(count(db, "sync_outbox"), 0);
    } finally {
      await relay.close();
      db.close();
    }
  }
});

test("les preuves de présence absente, invalide, expirée ou d'une autre séance sont refusées", async () => {
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const cases = [
    { proof: undefined, status: 428, error: "attendance_presence_required" },
    { proof: "invalid-proof", status: 403, error: "relay_proof_invalid" },
    {
      proof: presenceProof(school, {
        issuedAt: new Date(NOW.getTime() - 10 * 60_000),
        expiresAt: new Date(NOW.getTime() - 9 * 60_000),
      }),
      status: 403,
      error: "relay_proof_expired",
    },
    {
      proof: presenceProof(school, { clientSessionId: "another-session" }),
      status: 403,
      error: "relay_proof_mismatch",
    },
  ] as const;

  for (let index = 0; index < cases.length; index += 1) {
    const scenario = cases[index]!;
    const db = openRelayDatabase(":memory:");
    seedSchool(db, school);
    const body = operation(school, `proof-case-${index}`) as Record<string, unknown>;
    if (scenario.proof === undefined) delete body.presence_proof;
    else body.presence_proof = scenario.proof;
    const relay = await startRelay(db, [school.code]);
    try {
      const response = await postOperation(relay.url, body, teacherToken(school));
      assert.equal(response.status, scenario.status);
      assert.deepEqual(await response.json(), { error: scenario.error });
      assert.equal(count(db, "teacher_attendance_operations"), 0);
    } finally {
      await relay.close();
      db.close();
    }
  }
});

test("la fenêtre serveur, la taille, le JSON, les champs et statuts inconnus sont refusés", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  seedSchool(db, school);
  const relay = await startRelay(db, [school.code], true, new Date("2026-07-22T12:00:00.000Z"));
  try {
    const outside = await postOperation(relay.url, operation(school, "outside"), teacherToken(school));
    assert.equal(outside.status, 409);
    assert.deepEqual(await outside.json(), { error: "attendance_outside_slot" });

    const unknownType = { ...operation(school, "unknown-type"), operation_type: "unknown" };
    assert.equal((await postOperation(relay.url, unknownType, teacherToken(school))).status, 400);
    const unknownStatus = operation(school, "unknown-status");
    const firstUnknownMark = unknownStatus.marks[0];
    assert.ok(firstUnknownMark);
    firstUnknownMark.status = "missing";
    assert.equal((await postOperation(relay.url, unknownStatus, teacherToken(school))).status, 400);
    const injectedIdentity = { ...operation(school, "identity"), institution_id: school.institutionId };
    const unknownFieldResponse = await postOperation(relay.url, injectedIdentity, teacherToken(school));
    assert.equal(unknownFieldResponse.status, 400);
    assert.deepEqual(await unknownFieldResponse.json(), { error: "operation_field_not_supported" });

    const oversized = await fetch(`${relay.url}/v1/teacher/attendance-operations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken(school)}`,
      },
      body: JSON.stringify({ padding: "x".repeat(140 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    const invalidJson = await fetch(`${relay.url}/v1/teacher/attendance-operations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken(school)}`,
      },
      body: "{invalid-json",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal(count(db, "teacher_attendance_operations"), 0);
  } finally {
    await relay.close();
    db.close();
  }
});

test("une interruption de transaction ne laisse aucune demi-écriture", () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  assert.throws(() => secureTeacherAttendanceOperation(
    db,
    operation(school, "interrupted-operation"),
    { institution_id: school.institutionId, actor_profile_id: value.teacherId },
    NOW,
    { faultInjector: (stage) => {
      if (stage === "after_outbox") throw new Error("injected_transaction_failure");
    } },
  ), /injected_transaction_failure/);
  assert.equal(count(db, "teacher_attendance_operations"), 0);
  assert.equal(count(db, "sync_outbox"), 0);
  assert.equal(count(db, "attendance_marks"), 0);
  assert.equal(count(db, "sync_records"), 0);
  const session = db.prepare(`
    SELECT actual_call_at FROM teacher_sessions WHERE institution_id = ? AND id = ?
  `).get(school.institutionId, value.sessionId) as { actual_call_at: string | null };
  assert.equal(session.actual_call_at, null);
  db.close();
});

test("un redémarrage simulé conserve le reçu, l'outbox et la matérialisation", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-relay-attendance-restart-"));
  const path = join(directory, "relay.db");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  try {
    const first = openRelayDatabase(path);
    const value = seedSchool(first, school);
    secureTeacherAttendanceOperation(
      first,
      operation(school, "restart-operation"),
      { institution_id: school.institutionId, actor_profile_id: value.teacherId },
      NOW,
    );
    first.close();

    const reopened = openRelayDatabase(path);
    assert.equal(schemaVersion(reopened), 8);
    assert.equal(count(reopened, "teacher_attendance_operations"), 1);
    assert.equal(count(reopened, "sync_outbox"), 1);
    assert.equal(count(reopened, "attendance_marks"), 1);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("un bootstrap ultérieur préserve la séance et les marques locales dirty", () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  const value = seedSchool(db, school);
  secureTeacherAttendanceOperation(
    db,
    operation(school, "bootstrap-preserved"),
    { institution_id: school.institutionId, actor_profile_id: value.teacherId },
    NOW,
  );
  const legacyMarkId = "relay-attendance-legacy-dirty";
  db.prepare(`
    UPDATE attendance_marks
    SET id = ?
    WHERE institution_id = ? AND session_id = ? AND student_id = ?
  `).run(legacyMarkId, school.institutionId, value.sessionId, value.studentId);
  db.prepare(`
    UPDATE sync_records
    SET entity_id = ?
    WHERE institution_id = ? AND entity_type = 'attendance_mark'
      AND entity_id = ?
  `).run(
    legacyMarkId,
    school.institutionId,
    `${value.sessionId}:${value.studentId}`,
  );
  const mark = db.prepare(`
    SELECT id, updated_at FROM attendance_marks
    WHERE institution_id = ? AND session_id = ? AND student_id = ?
  `).get(school.institutionId, value.sessionId, value.studentId) as {
    id: string;
    updated_at: string;
  };
  const result = new RelayStore(db).bootstrap({
    protocol_version: 1,
    snapshot_id: "cloud-after-local-attendance",
    institution_id: school.institutionId,
    generated_at: "2026-07-22T09:20:00.000Z",
    cursor: "2026-07-22T09:20:00.000Z",
    institution: {
      id: school.institutionId,
      name: school.code,
      code: school.code,
      timezone: "UTC",
      settings_json: {},
      server_version: 1,
      updated_at: "2026-07-22T09:20:00.000Z",
    },
    entities: {
      teacher_sessions: [{
        id: value.sessionId,
        institution_id: school.institutionId,
        client_session_id: value.clientSessionId,
        class_id: value.classId,
        subject_id: value.subjectId,
        teacher_id: value.teacherId,
        period_id: value.periodId,
        started_at: "2026-07-22T09:00:00.000Z",
        actual_call_at: null,
        ended_at: null,
        origin: "teacher",
        server_version: 2,
        updated_at: "2026-07-22T09:20:00.000Z",
      }],
      attendance_marks: [{
        id: `${value.sessionId}:${value.studentId}`,
        institution_id: school.institutionId,
        session_id: value.sessionId,
        student_id: value.studentId,
        status: "absent",
        late_minutes: null,
        comment: "cloud stale",
        server_version: 2,
        updated_at: "2026-07-22T09:20:00.000Z",
      }],
    },
    diagnostics: { skipped_count: 0, skipped: [] },
  });
  assert.ok(result.preserved_local_entities >= 2);
  const preservedSession = db.prepare(`
    SELECT actual_call_at FROM teacher_sessions WHERE institution_id = ? AND id = ?
  `).get(school.institutionId, value.sessionId) as { actual_call_at: string | null };
  assert.equal(preservedSession.actual_call_at, NOW.toISOString());
  const preservedMark = db.prepare(`
    SELECT status, comment FROM attendance_marks WHERE institution_id = ? AND id = ?
  `).get(school.institutionId, mark.id) as { status: string; comment: string | null };
  assert.equal(preservedMark.status, "late");
  assert.equal(preservedMark.comment, "Transport local");
  assert.equal(count(db, "sync_outbox"), 1);
  db.close();
});

test("CORS, réseau privé, intégrité et absence de collection financière sont conservés", async () => {
  const db = openRelayDatabase(":memory:");
  const school: SchoolSeed = {
    institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET,
  };
  seedSchool(db, school);
  const relay = await startRelay(db, [school.code]);
  try {
    const preflight = await fetch(`${relay.url}/v1/teacher/attendance-operations`, {
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
    assert.match(String(preflight.headers.get("access-control-allow-methods")), /POST/);
    assert.match(String(preflight.headers.get("access-control-allow-headers")), /Authorization/i);
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

    assert.equal((await postOperation(
      relay.url,
      operation(school, "integrity-operation"),
      teacherToken(school),
    )).status, 202);
    const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    assert.deepEqual(integrity, [{ integrity_check: "ok" }]);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    const migrationSql = readFileSync(
      new URL("../migrations/0005_teacher_attendance_operations.sql", import.meta.url),
      "utf8",
    );
    assert.equal(/finance|payment|receipt|cash|payroll|expense|budget/i.test(migrationSql), false);
    const operationCollections = db.prepare(`
      SELECT entity_type FROM sync_outbox
      UNION ALL SELECT entity_type FROM sync_records
    `).all() as Array<{ entity_type: string }>;
    assert.equal(operationCollections.some((row) =>
      /finance|payment|receipt|cash|payroll|expense|budget/i.test(row.entity_type)
    ), false);
  } finally {
    await relay.close();
    db.close();
  }
});

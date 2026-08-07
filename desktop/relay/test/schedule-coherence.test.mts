import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type Database from "better-sqlite3";
import {
  getInstitutionMeta,
  openRelayDatabase,
  setInstitutionMeta,
  type RelayDatabase,
} from "../src/db.mjs";
import { createRelayServer } from "../src/server.mjs";
import { RelayStore } from "../src/store.mjs";

const SCHOOL_ONE_SECRET =
  "1111111111111111111111111111111111111111111111111111111111111111";
const SCHOOL_TWO_SECRET =
  "2222222222222222222222222222222222222222222222222222222222222222";

function token(secret: string, institutionId: string, teacherId: string) {
  const now = new Date();
  const payload = {
    v: 1,
    purpose: "attendance_relay_access",
    institution_id: institutionId,
    actor_profile_id: teacherId,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

function seedInstitution(
  db: RelayDatabase,
  institutionId: string,
  code: string,
  secret: string,
) {
  db.prepare(`
    INSERT INTO institutions(id, name, code, settings_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    institutionId,
    code,
    code,
    JSON.stringify({
      attendance_presence: { relay_presence_secret: secret },
    }),
    new Date().toISOString(),
  );
}

function seedTeacherSchedule(
  db: RelayDatabase,
  institutionId: string,
  teacherId: string,
  suffix: string,
) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO profiles(
      id, institution_id, display_name, is_active, server_version, updated_at
    ) VALUES (?, ?, ?, 1, 0, ?)
  `).run(teacherId, institutionId, `Prof ${suffix}`, now);
  db.prepare(`
    INSERT INTO user_roles(
      id, institution_id, profile_id, role, server_version, updated_at
    ) VALUES (?, ?, ?, 'teacher', 0, ?)
  `).run(`role-${suffix}`, institutionId, teacherId, now);
  db.prepare(`
    INSERT INTO classes(
      id, institution_id, academic_year, label, level, server_version, updated_at
    ) VALUES (?, ?, '2026', ?, '6e', 0, ?)
  `).run(`class-${suffix}`, institutionId, `Classe ${suffix}`, now);
  db.prepare(`
    INSERT INTO subjects(
      id, institution_id, name, server_version, updated_at
    ) VALUES (?, ?, ?, 0, ?)
  `).run(`subject-${suffix}`, institutionId, `Matière ${suffix}`, now);
  db.prepare(`
    INSERT INTO institution_periods(
      id, institution_id, weekday, label, start_time, end_time,
      server_version, updated_at
    ) VALUES (?, ?, 1, 'Cours', '08:00', '09:00', 0, ?)
  `).run(`period-${suffix}`, institutionId, now);
  db.prepare(`
    INSERT INTO teacher_timetables(
      id, institution_id, class_id, subject_id, teacher_id, period_id,
      weekday, server_version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
  `).run(
    `timetable-${suffix}`,
    institutionId,
    `class-${suffix}`,
    `subject-${suffix}`,
    teacherId,
    `period-${suffix}`,
    now,
  );
  db.prepare(`
    INSERT INTO students(
      id, institution_id, display_name, is_active, server_version, updated_at
    ) VALUES (?, ?, ?, 1, 0, ?)
  `).run(`student-${suffix}`, institutionId, `Élève ${suffix}`, now);
  db.prepare(`
    INSERT INTO class_enrollments(
      id, institution_id, class_id, student_id, start_date,
      server_version, updated_at
    ) VALUES (?, ?, ?, ?, '2026-01-01', 0, ?)
  `).run(
    `enrollment-${suffix}`,
    institutionId,
    `class-${suffix}`,
    `student-${suffix}`,
    now,
  );
}

function totalChanges(db: Database.Database) {
  return Number(
    (db.prepare("SELECT total_changes() AS count").get() as { count: number })
      .count,
  );
}

async function startRelay(store: RelayStore) {
  const server = createRelayServer(
    {
      databasePath: ":memory:",
      host: "127.0.0.1",
      port: 4317,
      token: "group-admin",
      institutionCodes: ["SCH-000001", "SCH-000002"],
      institutions: [
        {
          code: "SCH-000001",
          name: "École 1",
          admin_token: "school-one-admin",
        },
        {
          code: "SCH-000002",
          name: "École 2",
          admin_token: "school-two-admin",
        },
      ],
      teacherAttendanceWritesEnabled: true,
    },
    store,
  );
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test("seul un snapshot explicitement complet fait avancer la révision SQLite", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  try {
    const complete = store.bootstrap({
      protocol_version: 1,
      snapshot_id: "snapshot-revision-7",
      institution_id: "inst-revision",
      snapshot_revision: 7,
      snapshot_completeness: "complete",
      schedule_manifest: {
        class_teachers: [{ institution_id: "inst-revision", teacher_id: "teacher-1" }],
      },
      generated_at: "2026-07-28T08:00:00.000Z",
      institution: {
        id: "inst-revision",
        name: "École révision",
        code: "REV-000001",
      },
      entities: {},
      diagnostics: { skipped_count: 0 },
    });
    assert.equal(complete.status, "applied");
    assert.equal(complete.applied_snapshot_revision, 7);
    assert.equal(
      getInstitutionMeta(
        db,
        "inst-revision",
        "attendance_schedule_revision",
      ),
      "7",
    );
    assert.match(
      String(
        getInstitutionMeta(
          db,
          "inst-revision",
          "attendance_schedule_manifest",
        ),
      ),
      /teacher-1/,
    );

    const partial = store.bootstrap({
      protocol_version: 1,
      snapshot_id: "snapshot-revision-8-partial",
      institution_id: "inst-revision",
      snapshot_revision: 8,
      snapshot_completeness: "partial",
      schedule_manifest: {
        class_teachers: [{ institution_id: "inst-revision", teacher_id: "teacher-2" }],
      },
      generated_at: "2026-07-28T08:05:00.000Z",
      institution: {
        id: "inst-revision",
        name: "École révision",
        code: "REV-000001",
      },
      entities: {},
      diagnostics: { skipped_count: 1 },
    });
    assert.equal(partial.status, "partial");
    assert.equal(partial.applied_snapshot_revision, 7);
    assert.equal(
      getInstitutionMeta(
        db,
        "inst-revision",
        "attendance_schedule_revision",
      ),
      "7",
    );
    assert.doesNotMatch(
      String(
        getInstitutionMeta(
          db,
          "inst-revision",
          "attendance_schedule_manifest",
        ),
      ),
      /teacher-2/,
    );

    const replay = store.bootstrap({
      protocol_version: 1,
      snapshot_id: "snapshot-revision-7",
      institution_id: "inst-revision",
      snapshot_revision: 7,
      snapshot_completeness: "complete",
      schedule_manifest: {
        class_teachers: [{ institution_id: "inst-revision", teacher_id: "teacher-1" }],
      },
      generated_at: "2026-07-28T08:00:00.000Z",
      institution: {
        id: "inst-revision",
        name: "École révision",
        code: "REV-000001",
      },
      entities: {},
      diagnostics: { skipped_count: 0 },
    });
    assert.equal(replay.status, "duplicate");
    assert.equal(replay.applied_snapshot_revision, 7);
    assert.equal(
      db.pragma("integrity_check", { simple: true }),
      "ok",
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }
});

test("health et connectivity exposent le contrat sans secret", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  seedInstitution(db, "inst-1", "SCH-000001", SCHOOL_ONE_SECRET);
  seedTeacherSchedule(db, "inst-1", "teacher-1", "one");
  setInstitutionMeta(db, "inst-1", "attendance_schedule_revision", "12");
  setInstitutionMeta(
    db,
    "inst-1",
    "attendance_schedule_generated_at",
    "2026-07-28T09:00:00.000Z",
  );
  const relay = await startRelay(store);
  const before = totalChanges(db);
  try {
    const health = await fetch(`${relay.url}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as any;
    assert.equal(healthBody.relay_version, "0.2.0");
    assert.equal(healthBody.schema_version, 8);
    assert.equal(healthBody.protocol_version, 1);
    assert.equal(healthBody.teacher_attendance_writes_enabled, true);
    assert.equal(healthBody.snapshot_revision, 12);
    assert.equal(healthBody.schedule_status, "ready");
    assert.equal(JSON.stringify(healthBody).includes(SCHOOL_ONE_SECRET), false);

    const connectivity = await fetch(
      `${relay.url}/v1/teacher/connectivity-check`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token(
            SCHOOL_ONE_SECRET,
            "inst-1",
            "teacher-1",
          )}`,
          "Content-Type": "application/json",
          Origin: "https://mon-cahier.com",
        },
        body: "{}",
      },
    );
    assert.equal(connectivity.status, 200);
    const body = await connectivity.json() as any;
    assert.equal(body.snapshot_revision, 12);
    assert.equal(body.schedule_status, "ready");
    assert.equal(body.teacher_attendance_writes_enabled, true);
    assert.equal(body.capabilities.attendance_transition, true);
    assert.equal(body.capabilities.class_device_scope_v1, true);
    assert.equal(body.capabilities.bootstrap_revision_ack_v1, true);
    assert.equal(body.capabilities.admin_schedule_status_v1, true);
    assert.equal(JSON.stringify(body).includes(SCHOOL_ONE_SECRET), false);

    const status = await fetch(
      `${relay.url}/v1/admin/schedule-status?institution_id=inst-1`,
      { headers: { Authorization: "Bearer school-one-admin" } },
    );
    assert.equal(status.status, 200);
    const statusBody = await status.json() as any;
    assert.equal(statusBody.ok, true);
    assert.equal(statusBody.institution_id, "inst-1");
    assert.equal(statusBody.snapshot_revision, 12);
    assert.equal(statusBody.schedule_status, "ready");
    assert.equal(statusBody.relay_version, "0.2.0");
    assert.equal(statusBody.capabilities.bootstrap_revision_ack_v1, true);

    const unauthorizedStatus = await fetch(
      `${relay.url}/v1/admin/schedule-status?institution_id=inst-1`,
      { headers: { Authorization: "Bearer school-two-admin" } },
    );
    assert.equal(unauthorizedStatus.status, 401);
    assert.equal(totalChanges(db), before);
  } finally {
    await relay.close();
    db.close();
  }
});

test("l'actualisation professeur depuis le relais reste complète, en lecture seule et cloisonnée", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  seedInstitution(db, "inst-1", "SCH-000001", SCHOOL_ONE_SECRET);
  seedInstitution(db, "inst-2", "SCH-000002", SCHOOL_TWO_SECRET);
  seedTeacherSchedule(db, "inst-1", "teacher-shared", "one");
  seedTeacherSchedule(db, "inst-2", "teacher-shared", "two");
  setInstitutionMeta(db, "inst-1", "attendance_schedule_revision", "21");
  setInstitutionMeta(db, "inst-1", "attendance_schedule_generated_at", "2026-07-28T10:00:00.000Z");
  setInstitutionMeta(
    db,
    "inst-1",
    "attendance_schedule_manifest",
    JSON.stringify({
      class_teachers: [{
        institution_id: "inst-1",
        class_id: "class-one",
        teacher_id: "teacher-shared",
        subject_id: "subject-one",
      }],
    }),
  );
  setInstitutionMeta(db, "inst-2", "attendance_schedule_revision", "34");
  setInstitutionMeta(db, "inst-2", "attendance_schedule_generated_at", "2026-07-28T10:05:00.000Z");
  setInstitutionMeta(
    db,
    "inst-2",
    "attendance_schedule_manifest",
    JSON.stringify({
      class_teachers: [{
        institution_id: "inst-2",
        class_id: "class-two",
        teacher_id: "teacher-shared",
        subject_id: "subject-two",
      }],
    }),
  );
  const relay = await startRelay(store);
  const before = totalChanges(db);
  try {
    const response = await fetch(
      `${relay.url}/v1/teacher/offline-schedule`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token(
            SCHOOL_ONE_SECRET,
            "inst-1",
            "teacher-shared",
          )}`,
          "Content-Type": "application/json",
          Origin: "https://mon-cahier.com",
        },
        body: "{}",
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.institution_id, "inst-1");
    assert.equal(body.schedule_revision, 21);
    assert.equal(body.snapshot_completeness, "complete");
    assert.equal(body.slots.length, 1);
    assert.equal(body.slots[0].items[0].class_id, "class-one");
    assert.equal(body.rosters["class-one"].items[0].id, "student-one");
    assert.equal(body.assignments[0].class_id, "class-one");
    assert.equal(JSON.stringify(body).includes("class-two"), false);
    assert.equal(JSON.stringify(body).includes("student-two"), false);
    assert.equal(JSON.stringify(body).includes(SCHOOL_ONE_SECRET), false);
    assert.equal(totalChanges(db), before);
  } finally {
    await relay.close();
    db.close();
  }
});

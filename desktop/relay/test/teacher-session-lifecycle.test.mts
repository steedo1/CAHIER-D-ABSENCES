import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { adminDashboard } from "../src/admin-dashboard.mjs";
import { openRelayDatabase, schemaVersion, type RelayDatabase } from "../src/db.mjs";
import { issueAttendancePresenceProofForTeacher } from "../src/presence-proof.mjs";
import { createRelayServer } from "../src/server.mjs";
import { RelayStore } from "../src/store.mjs";
import { secureTeacherAttendanceOperation, TeacherAttendanceError } from "../src/teacher-attendance.mjs";
import {
  closeTeacherAttendanceSession,
  maintainTeacherAttendanceSessions,
  TeacherSessionLifecycleError,
  transitionTeacherAttendanceSession,
} from "../src/teacher-session-lifecycle.mjs";
import {
  openTeacherAttendanceSession,
  TeacherSessionOpenError,
} from "../src/teacher-session-open.mjs";

const SECRET = "3333333333333333333333333333333333333333333333333333333333333333";
const ADMIN_TOKEN = "admin-token-not-valid-on-teacher-routes";
const WEDNESDAY = 3;
const AT_0730 = new Date("2026-07-22T07:30:00.000Z");
const AT_0800 = new Date("2026-07-22T08:00:00.000Z");
const AT_0801 = new Date("2026-07-22T08:01:00.000Z");
const AT_0805 = new Date("2026-07-22T08:05:00.000Z");
const AT_080959 = new Date("2026-07-22T08:09:59.000Z");
const AT_0810 = new Date("2026-07-22T08:10:00.000Z");

type Seed = {
  institutionId?: string;
  code?: string;
  prefix?: string;
  nextTeacherId?: string;
  nextClassId?: string;
};

function ids(seed: Seed = {}) {
  const prefix = seed.prefix || "shared";
  return {
    institutionId: seed.institutionId || "inst-1",
    code: seed.code || "SCH-000001",
    oldTeacherId: `${prefix}-teacher-old`,
    nextTeacherId: seed.nextTeacherId || `${prefix}-teacher-next`,
    outsiderId: `${prefix}-teacher-outsider`,
    classId: `${prefix}-class`,
    nextClassId: seed.nextClassId || `${prefix}-class`,
    oldSubjectId: `${prefix}-subject-old`,
    nextSubjectId: `${prefix}-subject-next`,
    oldPeriodId: `${prefix}-period-1`,
    nextPeriodId: `${prefix}-period-2`,
    oldTimetableId: `${prefix}-timetable-1`,
    nextTimetableId: `${prefix}-timetable-2`,
    studentOneId: `${prefix}-student-1`,
    studentTwoId: `${prefix}-student-2`,
  };
}

function seedSchool(db: Database.Database, seed: Seed = {}) {
  const value = ids(seed);
  const at = AT_0730.toISOString();
  db.prepare(`
    INSERT INTO institutions(id, name, code, timezone, settings_json, updated_at)
    VALUES (?, ?, ?, 'UTC', ?, ?)
  `).run(
    value.institutionId,
    value.code,
    value.code,
    JSON.stringify({
      attendance_presence: {
        enabled: true,
        allow_local_relay: true,
        relay_presence_secret: SECRET,
        relay_proof_ttl_seconds: 180,
      },
    }),
    at,
  );
  const profiles = new Map([
    [value.oldTeacherId, "Ancien professeur"],
    [value.nextTeacherId, "Professeur suivant"],
    [value.outsiderId, "Professeur sans cours"],
  ]);
  for (const [profileId, label] of profiles) {
    db.prepare(`
      INSERT INTO profiles(id, institution_id, display_name, is_active, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(profileId, value.institutionId, label, at);
    db.prepare(`
      INSERT INTO user_roles(id, institution_id, profile_id, role, updated_at)
      VALUES (?, ?, ?, 'teacher', ?)
    `).run(`role:${profileId}`, value.institutionId, profileId, at);
  }
  const classes = new Set([value.classId, value.nextClassId]);
  for (const classId of classes) {
    db.prepare(`
      INSERT INTO classes(id, institution_id, academic_year, label, updated_at)
      VALUES (?, ?, '2026', ?, ?)
    `).run(classId, value.institutionId, `Classe ${classId}`, at);
  }
  db.prepare(`
    INSERT INTO subjects(id, institution_id, name, updated_at)
    VALUES (?, ?, 'Mathématiques', ?), (?, ?, 'Français', ?)
  `).run(
    value.oldSubjectId, value.institutionId, at,
    value.nextSubjectId, value.institutionId, at,
  );
  db.prepare(`
    INSERT INTO institution_periods(
      id, institution_id, weekday, label, start_time, end_time, updated_at
    ) VALUES (?, ?, ?, '07h00–08h00', '07:00', '08:00', ?),
             (?, ?, ?, '08h00–09h00', '08:00', '09:00', ?)
  `).run(
    value.oldPeriodId, value.institutionId, WEDNESDAY, at,
    value.nextPeriodId, value.institutionId, WEDNESDAY, at,
  );
  db.prepare(`
    INSERT INTO teacher_timetables(
      id, institution_id, class_id, subject_id, teacher_id,
      period_id, weekday, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.oldTimetableId, value.institutionId, value.classId,
    value.oldSubjectId, value.oldTeacherId, value.oldPeriodId, WEDNESDAY, at,
    value.nextTimetableId, value.institutionId, value.nextClassId,
    value.nextSubjectId, value.nextTeacherId, value.nextPeriodId, WEDNESDAY, at,
  );
  for (const [studentId, label] of [
    [value.studentOneId, "Élève 1"],
    [value.studentTwoId, "Élève 2"],
  ]) {
    db.prepare(`
      INSERT INTO students(id, institution_id, display_name, is_active, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(studentId, value.institutionId, label, at);
    db.prepare(`
      INSERT INTO class_enrollments(
        id, institution_id, class_id, student_id, start_date, updated_at
      ) VALUES (?, ?, ?, ?, '2026-01-01', ?)
    `).run(`enrollment:${value.classId}:${studentId}`, value.institutionId, value.classId, studentId, at);
    if (value.nextClassId !== value.classId) {
      db.prepare(`
        INSERT INTO class_enrollments(
          id, institution_id, class_id, student_id, start_date, updated_at
        ) VALUES (?, ?, ?, ?, '2026-01-01', ?)
      `).run(
        `enrollment:${value.nextClassId}:${studentId}`,
        value.institutionId,
        value.nextClassId,
        studentId,
        at,
      );
    }
  }
  return value;
}

function teacher(institutionId: string, profileId: string) {
  return { institution_id: institutionId, actor_profile_id: profileId };
}

function openOperation(value: ReturnType<typeof ids>, operationId = "open-old") {
  return {
    protocol_version: 1,
    operation_id: operationId,
    operation_type: "attendance.session.open",
    class_id: value.classId,
    period_id: value.oldPeriodId,
  };
}

function openOld(db: RelayDatabase, value: ReturnType<typeof ids>, operationId = "open-old") {
  return openTeacherAttendanceSession(
    db,
    openOperation(value, operationId),
    teacher(value.institutionId, value.oldTeacherId),
    AT_0730,
  );
}

function closeOperation(sessionId: string, operationId = "close-old") {
  return {
    protocol_version: 1,
    operation_id: operationId,
    operation_type: "attendance.session.close",
    session_id: sessionId,
  };
}

function transitionOperation(value: ReturnType<typeof ids>, operationId = "transition-next") {
  return {
    protocol_version: 1,
    operation_id: operationId,
    operation_type: "attendance.session.transition",
    class_id: value.nextClassId,
    period_id: value.nextPeriodId,
  };
}

function count(db: Database.Database, table: string) {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function secureCompleteAttendance(
  db: RelayDatabase,
  value: ReturnType<typeof ids>,
  sessionId: string,
  now = AT_0805,
  operationId = "attendance-old-latest",
) {
  const actor = teacher(value.institutionId, value.oldTeacherId);
  const proof = issueAttendancePresenceProofForTeacher(db, actor, sessionId, now);
  return secureTeacherAttendanceOperation(db, {
    protocol_version: 1,
    operation_id: operationId,
    operation_type: "attendance.call.submit",
    session_id: sessionId,
    class_id: value.classId,
    period_id: value.oldPeriodId,
    presence_proof: proof.proof,
    marks: [
      { student_id: value.studentOneId, status: "present", comment: null },
      { student_id: value.studentTwoId, status: "absent", comment: "Absent" },
    ],
  }, actor, now);
}

function createSchema6(path: string) {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    );
    CREATE TABLE relay_meta (
      key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL
    );
  `);
  const migrations = [
    [1, "core", "0001_core.sql"],
    [2, "bootstrap_dashboard", "0002_bootstrap_dashboard.sql"],
    [3, "bootstrap_diagnostics", "0003_bootstrap_diagnostics.sql"],
    [4, "multi_school_partitioning", "0004_multi_school_partitioning.sql"],
    [5, "teacher_attendance_operations", "0005_teacher_attendance_operations.sql"],
    [6, "teacher_session_open", "0006_teacher_session_open.sql"],
  ] as const;
  for (const [version, name, file] of migrations) {
    if (version === 4) db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
      db.prepare(`
        INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)
      `).run(version, name, AT_0730.toISOString());
    })();
    if (version === 4) db.pragma("foreign_keys = ON");
  }
  return db;
}

function teacherToken(value: ReturnType<typeof ids>, profileId: string, now = AT_0801) {
  const payload = {
    v: 1,
    purpose: "attendance_relay_access",
    institution_id: value.institutionId,
    actor_profile_id: profileId,
    issued_at: new Date(now.getTime() - 60_000).toISOString(),
    expires_at: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${createHmac("sha256", SECRET).update(encoded).digest("base64url")}`;
}

function relayConfig(code: string, enabled = true) {
  return {
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: ADMIN_TOKEN,
    institutionCodes: [code],
    institutions: [{ code, name: code, admin_token: `${code}-admin` }],
    teacherAttendanceWritesEnabled: enabled,
  };
}

test("la fin du créneau devient finalizing et le propriétaire peut enregistrer puis fermer", () => {
  const db = openRelayDatabase(":memory:");
  const value = seedSchool(db);
  const opened = openOld(db, value);
  const maintenance = maintainTeacherAttendanceSessions(db, AT_0800);
  assert.equal(maintenance.finalized, 1);
  let session = db.prepare(`
    SELECT session_state, payable_end_at FROM teacher_sessions
    WHERE institution_id = ? AND id = ?
  `).get(value.institutionId, opened.session.id) as any;
  assert.deepEqual(session, { session_state: "finalizing", payable_end_at: null });

  secureCompleteAttendance(db, value, opened.session.id);
  const closed = closeTeacherAttendanceSession(
    db,
    closeOperation(opened.session.id),
    teacher(value.institutionId, value.oldTeacherId),
    AT_0805,
  );
  assert.equal(closed.session.session_state, "closed");
  assert.equal(closed.session.closure_source, "teacher_confirmed");
  assert.equal(closed.session.closure_confirmation, "confirmed");
  assert.equal(closed.session.payable_end_at, "2026-07-22T08:00:00.000Z");
  assert.equal(closed.session.requires_payroll_review, false);
  session = db.prepare(`
    SELECT attendance_snapshot_status FROM teacher_sessions
    WHERE institution_id = ? AND id = ?
  `).get(value.institutionId, opened.session.id) as any;
  assert.equal(session.attendance_snapshot_status, "complete");
  assert.equal(count(db, "teacher_session_closure_events"), 1);
  assert.equal(adminDashboard(db, {
    institutionId: value.institutionId,
    date: "2026-07-22",
    now: AT_0805,
  }).session_reviews.count, 0);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("une fermeture live déjà acceptée reste idempotente lors du rejeu hors ligne", () => {
  const db = openRelayDatabase(":memory:");
  const value = seedSchool(db);
  const opened = openOld(db, value);
  maintainTeacherAttendanceSessions(db, AT_0800);
  secureCompleteAttendance(db, value, opened.session.id);

  const operationId = "close-response-lost";
  const first = closeTeacherAttendanceSession(
    db,
    closeOperation(opened.session.id, operationId),
    teacher(value.institutionId, value.oldTeacherId),
    AT_0805,
  );
  const retry = closeTeacherAttendanceSession(
    db,
    {
      protocol_version: 2,
      operation_id: operationId,
      operation_type: "attendance.session.close",
      session_id: opened.session.id,
      event_at: AT_0805.toISOString(),
      replay_context: {
        mode: "offline_replay",
        queued_at: new Date(AT_0805.getTime() + 60_000).toISOString(),
        client_session_id: `client:${opened.session.client_session_id}`,
        schedule_revision: 0,
        timezone: "UTC",
        scheduled_start_at: "2026-07-22T07:00:00.000Z",
      },
    },
    teacher(value.institutionId, value.oldTeacherId),
    new Date("2026-07-22T10:00:00.000Z"),
  );

  assert.equal(first.idempotent, false);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.session.id, first.session.id);
  assert.equal(retry.session.closed_at, first.session.closed_at);
  assert.equal(count(db, "teacher_session_closure_events"), 1);
  assert.equal(
    Number((db.prepare(`
      SELECT COUNT(*) AS count FROM sync_outbox
      WHERE institution_id = ? AND operation_id = ?
    `).get(value.institutionId, operationId) as { count: number }).count),
    1,
  );
  db.close();
});

test("seul le propriétaire ferme normalement et le professeur suivant effectue un takeover", () => {
  const db = openRelayDatabase(":memory:");
  const value = seedSchool(db);
  const opened = openOld(db, value);
  maintainTeacherAttendanceSessions(db, AT_0800);
  assert.throws(() => closeTeacherAttendanceSession(
    db,
    closeOperation(opened.session.id, "other-close"),
    teacher(value.institutionId, value.nextTeacherId),
    AT_0801,
  ), (error: unknown) =>
    error instanceof TeacherSessionLifecycleError && error.code === "forbidden_not_owner"
  );

  secureCompleteAttendance(db, value, opened.session.id, AT_0801);
  const transitioned = transitionTeacherAttendanceSession(
    db,
    transitionOperation(value),
    teacher(value.institutionId, value.nextTeacherId),
    AT_0801,
  );
  assert.equal(transitioned.requested_start_at, AT_0801.toISOString());
  assert.equal(transitioned.previous_session.closure_source, "next_slot_takeover");
  assert.equal(transitioned.previous_session.closure_confirmation, "unconfirmed");
  assert.equal(transitioned.previous_session.requires_payroll_review, true);
  assert.equal(transitioned.previous_session.attendance_snapshot_status, "complete");
  assert.equal(transitioned.session.class_id, value.nextClassId);
  assert.equal(transitioned.session.period_id, value.nextPeriodId);
  assert.notEqual(transitioned.session.id, opened.session.id);
  assert.equal(JSON.stringify(transitioned).includes("student"), false);
  assert.equal(JSON.stringify(transitioned).includes("marks"), false);

  const retry = transitionTeacherAttendanceSession(
    db,
    transitionOperation(value),
    teacher(value.institutionId, value.nextTeacherId),
    new Date("2026-07-22T08:01:03.000Z"),
  );
  assert.equal(retry.idempotent, true);
  assert.equal(retry.session.id, transitioned.session.id);
  assert.equal(retry.requested_start_at, AT_0801.toISOString());
  assert.throws(() => transitionTeacherAttendanceSession(
    db,
    { ...transitionOperation(value), class_id: "different-class" },
    teacher(value.institutionId, value.nextTeacherId),
    new Date("2026-07-22T08:01:04.000Z"),
  ), (error: unknown) =>
    error instanceof TeacherSessionLifecycleError &&
    error.code === "operation_id_reused_with_different_payload"
  );
  assert.throws(() => secureCompleteAttendance(
    db,
    value,
    opened.session.id,
    AT_0805,
    "attendance-after-takeover",
  ),
    (error: unknown) => error instanceof TeacherAttendanceError && error.code === "session_closed");

  const review = adminDashboard(db, {
    institutionId: value.institutionId,
    date: "2026-07-22",
    now: AT_0805,
  }).session_reviews;
  assert.equal(review.count, 1);
  assert.equal((review.items[0] as any).proposed_minutes, 60);
  assert.equal((review.items[0] as any).proposed_amount, null);
  const dependencies = db.prepare(`
    SELECT child.entity_type AS child_type, parent.entity_type AS parent_type
    FROM sync_outbox_dependencies dependency
    JOIN sync_outbox child
      ON child.institution_id = dependency.institution_id
     AND child.operation_id = dependency.operation_id
    JOIN sync_outbox parent
      ON parent.institution_id = dependency.institution_id
     AND parent.operation_id = dependency.depends_on_operation_id
    WHERE dependency.institution_id = ?
  `).all(value.institutionId) as Array<{ child_type: string; parent_type: string }>;
  assert.ok(dependencies.some((row) => row.child_type === "teacher_session" && row.parent_type === "attendance_call"));
  assert.ok(dependencies.filter((row) => row.child_type === "teacher_session").length >= 2);
  const transitionReceipt = db.prepare(`
    SELECT close_operation_id, open_operation_id
    FROM teacher_session_transition_operations
    WHERE institution_id = ? AND operation_id = ?
  `).get(value.institutionId, "transition-next") as {
    close_operation_id: string;
    open_operation_id: string;
  };
  const dependencyEdges = db.prepare(`
    SELECT operation_id, depends_on_operation_id
    FROM sync_outbox_dependencies
    WHERE institution_id = ?
  `).all(value.institutionId) as Array<{
    operation_id: string;
    depends_on_operation_id: string;
  }>;
  const exactEdges = new Set(dependencyEdges.map((row) =>
    `${row.operation_id}<-${row.depends_on_operation_id}`
  ));
  assert.ok(exactEdges.has("attendance-old-latest<-open-old"));
  assert.ok(exactEdges.has(`${transitionReceipt.close_operation_id}<-open-old`));
  assert.ok(exactEdges.has(
    `${transitionReceipt.close_operation_id}<-attendance-old-latest`,
  ));
  assert.ok(exactEdges.has(
    `${transitionReceipt.open_operation_id}<-${transitionReceipt.close_operation_id}`,
  ));
  assert.equal(count(db, "teacher_session_transition_operations"), 1);
  assert.equal(count(db, "teacher_session_closure_events"), 1);
  assert.equal(count(db, "teacher_session_open_operations"), 2);
  db.close();
});

test("un professeur sans cours suivant ne peut ni finaliser ni demander la transition", () => {
  const db = openRelayDatabase(":memory:");
  const value = seedSchool(db);
  openOld(db, value);
  maintainTeacherAttendanceSessions(db, AT_0800);
  assert.throws(() => transitionTeacherAttendanceSession(
    db,
    transitionOperation(value, "outsider-transition"),
    teacher(value.institutionId, value.outsiderId),
    AT_0801,
  ), (error: unknown) =>
    error instanceof TeacherSessionLifecycleError && error.code === "teacher_not_scheduled_for_slot"
  );
  assert.equal(count(db, "teacher_session_transition_operations"), 0);
  assert.equal(count(db, "teacher_session_closure_events"), 0);
  db.close();
});

test("la grâce expirée ferme automatiquement sans prolonger la paie", () => {
  const db = openRelayDatabase(":memory:");
  const value = seedSchool(db);
  const opened = openOld(db, value);
  const result = maintainTeacherAttendanceSessions(db, AT_0810);
  assert.equal(result.closed, 1);
  const session = db.prepare(`
    SELECT session_state, closed_at, payable_end_at, closure_source,
           closure_confirmation, requires_payroll_review, attendance_snapshot_status
    FROM teacher_sessions WHERE institution_id = ? AND id = ?
  `).get(value.institutionId, opened.session.id) as any;
  assert.deepEqual(session, {
    session_state: "closed",
    closed_at: AT_0810.toISOString(),
    payable_end_at: "2026-07-22T08:00:00.000Z",
    closure_source: "automatic_grace_expired",
    closure_confirmation: "unconfirmed",
    requires_payroll_review: 1,
    attendance_snapshot_status: "none",
  });
  assert.equal(maintainTeacherAttendanceSessions(db, new Date("2026-07-22T08:20:00.000Z")).closed, 0);
  assert.equal(count(db, "teacher_session_closure_events"), 1);
  const ownerLate = closeTeacherAttendanceSession(
    db,
    closeOperation(opened.session.id, "late-owner-close"),
    teacher(value.institutionId, value.oldTeacherId),
    new Date("2026-07-22T08:20:00.000Z"),
  );
  assert.equal(ownerLate.already_closed, true);
  assert.equal(ownerLate.session.closure_source, "automatic_grace_expired");
  assert.equal(count(db, "teacher_session_closure_events"), 1);
  db.close();
});

test("les courses fermeture manuelle, automatique et transition ne produisent qu'une fermeture", () => {
  const manualFirst = openRelayDatabase(":memory:");
  const firstValue = seedSchool(manualFirst);
  const firstOpen = openOld(manualFirst, firstValue);
  maintainTeacherAttendanceSessions(manualFirst, AT_0800);
  closeTeacherAttendanceSession(
    manualFirst,
    closeOperation(firstOpen.session.id, "manual-wins"),
    teacher(firstValue.institutionId, firstValue.oldTeacherId),
    AT_080959,
  );
  maintainTeacherAttendanceSessions(manualFirst, AT_0810);
  assert.equal(count(manualFirst, "teacher_session_closure_events"), 1);
  assert.equal((manualFirst.prepare(`SELECT closure_source FROM teacher_sessions`).get() as any).closure_source,
    "teacher_confirmed");
  manualFirst.close();

  const automaticFirst = openRelayDatabase(":memory:");
  const secondValue = seedSchool(automaticFirst);
  const secondOpen = openOld(automaticFirst, secondValue);
  maintainTeacherAttendanceSessions(automaticFirst, AT_0810);
  closeTeacherAttendanceSession(
    automaticFirst,
    closeOperation(secondOpen.session.id, "manual-loses"),
    teacher(secondValue.institutionId, secondValue.oldTeacherId),
    AT_0810,
  );
  assert.equal(count(automaticFirst, "teacher_session_closure_events"), 1);
  assert.equal((automaticFirst.prepare(`SELECT closure_source FROM teacher_sessions`).get() as any).closure_source,
    "automatic_grace_expired");
  automaticFirst.close();

  const takeoverFirst = openRelayDatabase(":memory:");
  const thirdValue = seedSchool(takeoverFirst);
  const thirdOpen = openOld(takeoverFirst, thirdValue);
  maintainTeacherAttendanceSessions(takeoverFirst, AT_0800);
  transitionTeacherAttendanceSession(
    takeoverFirst,
    transitionOperation(thirdValue, "takeover-wins"),
    teacher(thirdValue.institutionId, thirdValue.nextTeacherId),
    AT_0801,
  );
  const oldResponse = closeTeacherAttendanceSession(
    takeoverFirst,
    closeOperation(thirdOpen.session.id, "old-teacher-loses"),
    teacher(thirdValue.institutionId, thirdValue.oldTeacherId),
    AT_0801,
  );
  assert.equal(oldResponse.already_closed, true);
  assert.equal(oldResponse.session.closure_source, "next_slot_takeover");
  assert.equal(count(takeoverFirst, "teacher_session_closure_events"), 1);
  takeoverFirst.close();
});

test("une seule séance existe par école, classe, date et créneau", () => {
  const db = openRelayDatabase(":memory:");
  const value = seedSchool(db);
  const first = openOld(db, value, "start-one");
  const second = openTeacherAttendanceSession(
    db,
    openOperation(value, "start-two"),
    teacher(value.institutionId, value.oldTeacherId),
    new Date("2026-07-22T07:31:00.000Z"),
  );
  assert.equal(first.session.id, second.session.id);
  assert.equal(count(db, "teacher_sessions"), 1);
  closeTeacherAttendanceSession(
    db,
    closeOperation(first.session.id),
    teacher(value.institutionId, value.oldTeacherId),
    new Date("2026-07-22T07:40:00.000Z"),
  );
  assert.throws(() => openTeacherAttendanceSession(
    db,
    openOperation(value, "start-after-close"),
    teacher(value.institutionId, value.oldTeacherId),
    new Date("2026-07-22T07:45:00.000Z"),
  ), (error: unknown) =>
    error instanceof TeacherSessionOpenError && error.code === "session_slot_already_closed"
  );
  assert.equal(count(db, "teacher_sessions"), 1);
  db.close();
});

test("le même professeur ferme son premier cours avant d'ouvrir la classe suivante", () => {
  const db = openRelayDatabase(":memory:");
  const seed: Seed = {
    nextTeacherId: "shared-teacher-old",
    nextClassId: "shared-class-next",
  };
  const value = seedSchool(db, seed);
  const first = openOld(db, value);
  maintainTeacherAttendanceSessions(db, AT_0800);
  assert.throws(() => transitionTeacherAttendanceSession(
    db,
    transitionOperation(value, "same-owner-transition"),
    teacher(value.institutionId, value.oldTeacherId),
    AT_0801,
  ), (error: unknown) =>
    error instanceof TeacherSessionLifecycleError && error.code === "previous_session_owner_must_confirm"
  );
  closeTeacherAttendanceSession(
    db,
    closeOperation(first.session.id, "same-owner-close"),
    teacher(value.institutionId, value.oldTeacherId),
    AT_0801,
  );
  const next = openTeacherAttendanceSession(db, {
    protocol_version: 1,
    operation_id: "same-owner-next-open",
    operation_type: "attendance.session.open",
    class_id: value.nextClassId,
    period_id: value.nextPeriodId,
  }, teacher(value.institutionId, value.oldTeacherId), AT_0801);
  assert.notEqual(next.session.id, first.session.id);
  const sessions = db.prepare(`
    SELECT class_id, session_state FROM teacher_sessions ORDER BY started_at
  `).all() as any[];
  assert.deepEqual(sessions, [
    { class_id: value.classId, session_state: "closed" },
    { class_id: value.nextClassId, session_state: "open" },
  ]);
  db.close();
});

test("deux écoles réutilisent les mêmes identifiants et operation_id sans collision", () => {
  const db = openRelayDatabase(":memory:");
  const firstSeed: Seed = { institutionId: "inst-1", code: "SCH-1", prefix: "shared" };
  const secondSeed: Seed = { institutionId: "inst-2", code: "SCH-2", prefix: "shared" };
  const firstValue = seedSchool(db, firstSeed);
  const secondValue = seedSchool(db, secondSeed);
  const first = openOld(db, firstValue, "same-open");
  const second = openOld(db, secondValue, "same-open");
  closeTeacherAttendanceSession(
    db,
    closeOperation(first.session.id, "same-close"),
    teacher(firstValue.institutionId, firstValue.oldTeacherId),
    new Date("2026-07-22T07:50:00.000Z"),
  );
  closeTeacherAttendanceSession(
    db,
    closeOperation(second.session.id, "same-close"),
    teacher(secondValue.institutionId, secondValue.oldTeacherId),
    new Date("2026-07-22T07:50:00.000Z"),
  );
  assert.equal(count(db, "teacher_sessions"), 2);
  assert.equal(count(db, "teacher_session_closure_events"), 2);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("chaque interruption de transition annule fermeture, nouvelle séance et outbox", () => {
  for (const stage of [
    "after_previous_close",
    "after_new_session",
    "after_new_open_outbox",
    "after_transition_receipt",
  ] as const) {
    const db = openRelayDatabase(":memory:");
    const value = seedSchool(db);
    const opened = openOld(db, value);
    maintainTeacherAttendanceSessions(db, AT_0800);
    const outboxBefore = count(db, "sync_outbox");
    assert.throws(() => transitionTeacherAttendanceSession(
      db,
      transitionOperation(value, `fault-${stage}`),
      teacher(value.institutionId, value.nextTeacherId),
      AT_0801,
      { faultInjector: (current) => {
        if (current === stage) throw new Error("injected_transition_failure");
      } },
    ), /injected_transition_failure/);
    const session = db.prepare(`
      SELECT session_state, ended_at FROM teacher_sessions
      WHERE institution_id = ? AND id = ?
    `).get(value.institutionId, opened.session.id) as any;
    assert.deepEqual(session, { session_state: "finalizing", ended_at: null });
    assert.equal(count(db, "teacher_sessions"), 1);
    assert.equal(count(db, "teacher_session_closure_events"), 0);
    assert.equal(count(db, "teacher_session_transition_operations"), 0);
    assert.equal(count(db, "sync_outbox"), outboxBefore);
    db.close();
  }
});

test("la migration 6 vers 7 est atomique, rejouable et refuse les doublons", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-schema7-"));
  try {
    const path = join(directory, "schema6.db");
    const schema6 = createSchema6(path);
    const value = seedSchool(schema6);
    schema6.prepare(`
      INSERT INTO teacher_sessions(
        id, institution_id, client_session_id, class_id, subject_id, teacher_id,
        period_id, started_at, actual_call_at, ended_at, origin, updated_at
      ) VALUES ('legacy-session', ?, 'legacy-session', ?, ?, ?, ?,
                '2026-07-22T07:00:00.000Z', '2026-07-22T07:02:00.000Z', NULL,
                'teacher', ?)
    `).run(
      value.institutionId,
      value.classId,
      value.oldSubjectId,
      value.oldTeacherId,
      value.oldPeriodId,
      AT_0730.toISOString(),
    );
    schema6.close();
    let migrated = openRelayDatabase(path);
    assert.equal(schemaVersion(migrated), 8);
    const backfilled = migrated.prepare(`
      SELECT session_date, session_state, scheduled_start_at, scheduled_end_at,
             grace_expires_at
      FROM teacher_sessions WHERE id = 'legacy-session'
    `).get() as any;
    assert.deepEqual(backfilled, {
      session_date: "2026-07-22",
      session_state: "open",
      scheduled_start_at: "2026-07-22T07:00:00.000Z",
      scheduled_end_at: "2026-07-22T08:00:00.000Z",
      grace_expires_at: "2026-07-22T08:10:00.000Z",
    });
    assert.equal(String(migrated.pragma("integrity_check", { simple: true })), "ok");
    assert.deepEqual(migrated.pragma("foreign_key_check"), []);
    migrated.close();
    migrated = openRelayDatabase(path);
    assert.equal(Number((migrated.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 7
    `).get() as any).count), 1);
    migrated.close();

    const rollbackPath = join(directory, "rollback.db");
    const rollback = createSchema6(rollbackPath);
    rollback.exec(`
      CREATE TRIGGER reject_schema_7 BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 7 BEGIN SELECT RAISE(ABORT, 'injected_schema7_failure'); END;
    `);
    rollback.close();
    assert.throws(() => openRelayDatabase(rollbackPath), /injected_schema7_failure/);
    const inspected = new Database(rollbackPath, { readonly: true });
    assert.equal(schemaVersion(inspected), 6);
    assert.equal(inspected.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table'
        AND name = 'teacher_session_closure_events'
    `).get(), undefined);
    inspected.close();

    const duplicatePath = join(directory, "duplicate.db");
    const duplicate = createSchema6(duplicatePath);
    const duplicateValue = seedSchool(duplicate);
    const insert = duplicate.prepare(`
      INSERT INTO teacher_sessions(
        id, institution_id, client_session_id, class_id, subject_id, teacher_id,
        period_id, started_at, origin, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-07-22T07:00:00.000Z', 'teacher', ?)
    `);
    insert.run(
      "duplicate-1", duplicateValue.institutionId, "duplicate-1",
      duplicateValue.classId, duplicateValue.oldSubjectId, duplicateValue.oldTeacherId,
      duplicateValue.oldPeriodId, AT_0730.toISOString(),
    );
    insert.run(
      "duplicate-2", duplicateValue.institutionId, "duplicate-2",
      duplicateValue.classId, duplicateValue.oldSubjectId, duplicateValue.oldTeacherId,
      duplicateValue.oldPeriodId, AT_0730.toISOString(),
    );
    duplicate.close();
    assert.throws(() => openRelayDatabase(duplicatePath), /duplicate_class_date_period/);
    const duplicateInspected = new Database(duplicatePath, { readonly: true });
    assert.equal(schemaVersion(duplicateInspected), 6);
    duplicateInspected.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("le redémarrage du serveur ferme une séance expirée", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-restart-close-"));
  const path = join(directory, "relay.db");
  try {
    let db = openRelayDatabase(path);
    const value = seedSchool(db);
    const opened = openOld(db, value);
    db.close();
    db = openRelayDatabase(path);
    const server = createRelayServer(
      relayConfig(value.code, true),
      new RelayStore(db),
      { now: () => AT_0810 },
    );
    const session = db.prepare(`
      SELECT session_state, closure_source FROM teacher_sessions
      WHERE institution_id = ? AND id = ?
    `).get(value.institutionId, opened.session.id) as any;
    assert.deepEqual(session, {
      session_state: "closed",
      closure_source: "automatic_grace_expired",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("flag désactivé, ancien jeton Admin, CORS et taille de corps restent sûrs", async () => {
  const db = openRelayDatabase(":memory:");
  const value = seedSchool(db);
  const opened = openOld(db, value);
  maintainTeacherAttendanceSessions(db, AT_0800);
  const changesBefore = Number((db.prepare(`SELECT total_changes() AS count`).get() as any).count);
  const server = createRelayServer(
    relayConfig(value.code, false),
    new RelayStore(db),
    { now: () => AT_0801 },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const token = teacherToken(value, value.oldTeacherId);
    const disabled = await fetch(`${url}/v1/teacher/attendance-sessions/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(closeOperation(opened.session.id)),
    });
    assert.equal(disabled.status, 503);
    const admin = await fetch(`${url}/v1/teacher/attendance-sessions/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(closeOperation(opened.session.id, "admin-close")),
    });
    assert.equal(admin.status, 401);
    const options = await fetch(`${url}/v1/teacher/attendance-sessions/transition`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://mon-cahier.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("access-control-allow-origin"), "https://mon-cahier.com");
    assert.equal(options.headers.get("access-control-allow-private-network"), "true");
    const oversized = await fetch(`${url}/v1/teacher/attendance-sessions/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...closeOperation(opened.session.id), padding: "x".repeat(20_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(Number((db.prepare(`SELECT total_changes() AS count`).get() as any).count), changesBefore);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test("un bootstrap ultérieur préserve la fermeture locale dirty", () => {
  const db = openRelayDatabase(":memory:");
  const value = seedSchool(db);
  const opened = openOld(db, value);
  secureCompleteAttendance(db, value, opened.session.id, new Date("2026-07-22T07:50:00.000Z"));
  closeTeacherAttendanceSession(
    db,
    closeOperation(opened.session.id),
    teacher(value.institutionId, value.oldTeacherId),
    AT_0805,
  );
  const result = new RelayStore(db).bootstrap({
    protocol_version: 1,
    snapshot_id: "cloud-after-local-close",
    institution_id: value.institutionId,
    generated_at: "2026-07-22T08:06:00.000Z",
    cursor: "2026-07-22T08:06:00.000Z",
    institution: {
      id: value.institutionId,
      name: value.code,
      code: value.code,
      timezone: "UTC",
      settings_json: {
        attendance_presence: {
          enabled: true,
          allow_local_relay: true,
          relay_presence_secret: SECRET,
        },
      },
      server_version: 2,
      updated_at: "2026-07-22T08:06:00.000Z",
    },
    entities: {
      teacher_sessions: [{
        id: opened.session.id,
        institution_id: value.institutionId,
        client_session_id: opened.session.id,
        class_id: value.classId,
        subject_id: value.oldSubjectId,
        teacher_id: value.oldTeacherId,
        period_id: value.oldPeriodId,
        started_at: "2026-07-22T07:00:00.000Z",
        actual_call_at: "2026-07-22T07:30:00.000Z",
        ended_at: null,
        origin: "teacher",
        server_version: 2,
        updated_at: "2026-07-22T08:06:00.000Z",
      }],
    },
    diagnostics: { skipped_count: 0, skipped: [] },
  });
  assert.equal(result.preserved_local_entities, 1);
  const session = db.prepare(`
    SELECT session_state, closure_source, payable_end_at
    FROM teacher_sessions WHERE institution_id = ? AND id = ?
  `).get(value.institutionId, opened.session.id) as any;
  assert.deepEqual(session, {
    session_state: "closed",
    closure_source: "teacher_confirmed",
    payable_end_at: "2026-07-22T08:00:00.000Z",
  });
  db.close();
});

test("intégrité, secrets, absence de collection Finance et contrôle Admin local", () => {
  const db = openRelayDatabase(":memory:");
  const value = seedSchool(db);
  const opened = openOld(db, value);
  maintainTeacherAttendanceSessions(db, AT_0810);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(String(db.pragma("integrity_check", { simple: true })), "ok");
  const migration = readFileSync(
    new URL("../migrations/0007_teacher_session_close_transition.sql", import.meta.url),
    "utf8",
  );
  assert.equal(/CREATE\s+TABLE\s+(?:finance\.)/i.test(migration), false);
  const collections = db.prepare(`
    SELECT DISTINCT entity_type FROM sync_outbox ORDER BY entity_type
  `).all().map((row) => String((row as any).entity_type));
  assert.equal(collections.some((name) => /finance|payment|receipt|cash|expense|budget/i.test(name)), false);
  const persisted = db.prepare(`
    SELECT payload_json AS value FROM sync_outbox
    UNION ALL SELECT payload_json FROM teacher_session_open_operations
    UNION ALL SELECT payload_json FROM teacher_session_closure_events
    UNION ALL SELECT details_json FROM audit_log
  `).all().map((row) => String((row as any).value || "")).join("\n");
  const token = teacherToken(value, value.oldTeacherId);
  assert.equal(persisted.includes(token), false);
  assert.equal(persisted.includes(opened.presence_proof), false);
  const dashboard = adminDashboard(db, {
    institutionId: value.institutionId,
    date: "2026-07-22",
    now: AT_0810,
  });
  assert.equal(dashboard.session_reviews.count, 1);
  assert.equal((dashboard.session_reviews.items[0] as any).closure_source,
    "automatic_grace_expired");
  db.close();
});

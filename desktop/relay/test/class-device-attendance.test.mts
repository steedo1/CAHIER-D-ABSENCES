import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { openRelayDatabase, type RelayDatabase } from "../src/db.mjs";
import { issueAttendancePresenceProof } from "../src/presence-proof.mjs";
import { secureTeacherAttendanceOperation } from "../src/teacher-attendance.mjs";
import { authenticateRelayTeacherAccess } from "../src/teacher-auth.mjs";
import { closeTeacherAttendanceSession } from "../src/teacher-session-lifecycle.mjs";
import {
  openTeacherAttendanceSession,
  TeacherSessionOpenError,
} from "../src/teacher-session-open.mjs";

const SECRET = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const INSTITUTION_ID = "inst-class-device";
const TEACHER_ID = "teacher-class-device";
const CLASS_ID = "class-device-bound-class";
const OTHER_CLASS_ID = "class-device-other-class";
const SUBJECT_ID = "subject-class-device";
const PERIOD_ID = "period-class-device";
const STUDENT_ID = "student-class-device";

function seed(db: RelayDatabase) {
  const updatedAt = "2026-07-22T09:00:00.000Z";
  db.prepare(`
    INSERT INTO institutions(id, name, code, timezone, settings_json, updated_at)
    VALUES (?, 'École test', 'ECD-1', 'UTC', ?, ?)
  `).run(
    INSTITUTION_ID,
    JSON.stringify({
      attendance_presence: {
        enabled: true,
        allow_local_relay: true,
        relay_presence_secret: SECRET,
        relay_proof_ttl_seconds: 600,
      },
    }),
    updatedAt,
  );
  db.prepare(`
    INSERT INTO profiles(id, institution_id, display_name, is_active, updated_at)
    VALUES (?, ?, 'Professeur prévu', 1, ?)
  `).run(TEACHER_ID, INSTITUTION_ID, updatedAt);
  db.prepare(`
    INSERT INTO user_roles(id, institution_id, profile_id, role, updated_at)
    VALUES ('role-class-device-teacher', ?, ?, 'teacher', ?)
  `).run(INSTITUTION_ID, TEACHER_ID, updatedAt);
  for (const [id, label] of [[CLASS_ID, "1ère D1"], [OTHER_CLASS_ID, "2nde A"]]) {
    db.prepare(`
      INSERT INTO classes(id, institution_id, academic_year, label, updated_at)
      VALUES (?, ?, '2026', ?, ?)
    `).run(id, INSTITUTION_ID, label, updatedAt);
  }
  db.prepare(`
    INSERT INTO subjects(id, institution_id, name, updated_at)
    VALUES (?, ?, 'Mathématiques', ?)
  `).run(SUBJECT_ID, INSTITUTION_ID, updatedAt);
  db.prepare(`
    INSERT INTO students(id, institution_id, display_name, is_active, updated_at)
    VALUES (?, ?, 'YAO Kevin', 1, ?)
  `).run(STUDENT_ID, INSTITUTION_ID, updatedAt);
  db.prepare(`
    INSERT INTO class_enrollments(
      id, institution_id, class_id, student_id, start_date, end_date, updated_at
    ) VALUES ('enrollment-class-device', ?, ?, ?, '2026-01-01', NULL, ?)
  `).run(INSTITUTION_ID, CLASS_ID, STUDENT_ID, updatedAt);
  db.prepare(`
    INSERT INTO institution_periods(
      id, institution_id, weekday, label, start_time, end_time, updated_at
    ) VALUES (?, ?, 3, '14h00-15h00', '09:00', '10:00', ?)
  `).run(PERIOD_ID, INSTITUTION_ID, updatedAt);
  db.prepare(`
    INSERT INTO teacher_timetables(
      id, institution_id, class_id, subject_id, teacher_id,
      period_id, weekday, updated_at
    ) VALUES ('timetable-class-device', ?, ?, ?, ?, ?, 3, ?)
  `).run(INSTITUTION_ID, CLASS_ID, SUBJECT_ID, TEACHER_ID, PERIOD_ID, updatedAt);
}

function classActor() {
  return {
    institution_id: INSTITUTION_ID,
    actor_profile_id: "class-device-user",
    actor_kind: "class_device" as const,
    class_id: CLASS_ID,
  };
}

function classDeviceToken(now: Date) {
  const payload = {
    v: 2,
    purpose: "attendance_relay_access",
    institution_id: INSTITUTION_ID,
    actor_profile_id: "class-device-user",
    actor_kind: "class_device",
    class_id: CLASS_ID,
    issued_at: new Date(now.getTime() - 60_000).toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${createHmac("sha256", SECRET).update(encoded).digest("base64url")}`;
}

test("le jeton v2 du téléphone de classe est borné à sa classe", () => {
  const db = openRelayDatabase(":memory:");
  try {
    seed(db);
    const now = new Date("2026-07-22T09:05:00.000Z");
    const actor = authenticateRelayTeacherAccess(db, classDeviceToken(now), now);
    assert.equal(actor.actor_kind, "class_device");
    assert.equal(actor.class_id, CLASS_ID);
    assert.equal(actor.actor_profile_id, "class-device-user");
  } finally {
    db.close();
  }
});

test("le téléphone de classe ouvre, enregistre 17 minutes puis ferme via le relais", () => {
  const db = openRelayDatabase(":memory:");
  try {
    seed(db);
    const actor = classActor();
    const opened = openTeacherAttendanceSession(db, {
      protocol_version: 1,
      operation_id: "class-device-open-1",
      operation_type: "attendance.session.open",
      class_id: CLASS_ID,
      period_id: PERIOD_ID,
    }, actor, new Date("2026-07-22T09:05:00.000Z"));

    assert.equal(opened.session.class_id, CLASS_ID);
    const localSession = db.prepare(`
      SELECT teacher_id, origin, session_state
      FROM teacher_sessions
      WHERE institution_id = ? AND id = ?
    `).get(INSTITUTION_ID, opened.session.id) as {
      teacher_id: string;
      origin: string;
      session_state: string;
    };
    assert.deepEqual(localSession, {
      teacher_id: TEACHER_ID,
      origin: "class_device",
      session_state: "open",
    });

    const saveAt = new Date("2026-07-22T09:31:00.000Z");
    const freshProof = issueAttendancePresenceProof(db, {
      institution_id: INSTITUTION_ID,
      actor_profile_id: "class-device-user",
      client_session_id: opened.session.id,
      access_token: classDeviceToken(saveAt),
    }, saveAt);

    const saved = secureTeacherAttendanceOperation(db, {
      protocol_version: 1,
      operation_id: "class-device-call-1",
      operation_type: "attendance.call.submit",
      session_id: opened.session.id,
      class_id: CLASS_ID,
      period_id: PERIOD_ID,
      presence_proof: freshProof.proof,
      marks: [{
        student_id: STUDENT_ID,
        status: "late",
        observed_at: "2026-07-22T09:17:00.000Z",
        comment: null,
      }],
    }, actor, saveAt);
    assert.equal(saved.state, "secured_on_relay");

    const mark = db.prepare(`
      SELECT status, late_minutes
      FROM attendance_marks
      WHERE institution_id = ? AND session_id = ? AND student_id = ?
    `).get(INSTITUTION_ID, opened.session.id, STUDENT_ID) as {
      status: string;
      late_minutes: number | null;
    };
    assert.deepEqual(mark, { status: "late", late_minutes: 17 });

    const callPayload = JSON.parse(String((db.prepare(`
      SELECT payload_json FROM teacher_attendance_operations
      WHERE institution_id = ? AND operation_id = 'class-device-call-1'
    `).get(INSTITUTION_ID) as { payload_json: string }).payload_json));
    assert.equal(callPayload.teacher_profile_id, TEACHER_ID);
    assert.equal(callPayload.auth_actor_kind, "class_device");
    assert.equal(callPayload.marks[0].observed_at, "2026-07-22T09:17:00.000Z");
    assert.equal(callPayload.marks[0].late_minutes, 17);

    const outbox = db.prepare(`
      SELECT device_id, actor_profile_id
      FROM sync_outbox
      WHERE institution_id = ? AND operation_id = 'class-device-call-1'
    `).get(INSTITUTION_ID) as { device_id: string; actor_profile_id: string };
    assert.deepEqual(outbox, {
      device_id: `class_device:${CLASS_ID}`,
      actor_profile_id: TEACHER_ID,
    });

    const closed = closeTeacherAttendanceSession(db, {
      protocol_version: 1,
      operation_id: "class-device-close-1",
      operation_type: "attendance.session.close",
      session_id: opened.session.id,
    }, actor, new Date("2026-07-22T09:35:00.000Z"));
    assert.equal(closed.session.session_state, "closed");
    assert.equal(closed.session.closure_confirmation, "confirmed");
  } finally {
    db.close();
  }
});

test("le téléphone de classe ne peut pas ouvrir une autre classe", () => {
  const db = openRelayDatabase(":memory:");
  try {
    seed(db);
    assert.throws(
      () => openTeacherAttendanceSession(db, {
        protocol_version: 1,
        operation_id: "class-device-cross-class",
        operation_type: "attendance.session.open",
        class_id: OTHER_CLASS_ID,
        period_id: PERIOD_ID,
      }, classActor(), new Date("2026-07-22T09:05:00.000Z")),
      (error: unknown) =>
        error instanceof TeacherSessionOpenError &&
        error.status === 403 &&
        error.code === "class_device_class_mismatch",
    );
  } finally {
    db.close();
  }
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { openRelayDatabase, setInstitutionMeta, type RelayDatabase } from "../src/db.mjs";
import { relayGradeWorkspace, RelayGradeWorkspaceError } from "../src/grade-workspace.mjs";
import { createRelayServer } from "../src/server.mjs";
import { RelayStore } from "../src/store.mjs";

const SECRET = "3333333333333333333333333333333333333333333333333333333333333333";
const INSTITUTION_ID = "inst-grade-workspace";
const CLASS_ID = "class-grade-workspace";
const OTHER_CLASS_ID = "other-class-grade-workspace";
const TEACHER_ID = "teacher-grade-workspace";
const CLASS_DEVICE_ID = "class-device-grade-workspace";
const SUBJECT_ID = "subject-grade-workspace";
const OTHER_SUBJECT_ID = "subject-other";
const STUDENT_ID = "student-grade-workspace";
const PERIOD_ID = "period-grade-workspace";
const EVALUATION_ID = "evaluation-grade-workspace";

function seed(db: RelayDatabase) {
  const now = "2026-08-15T03:00:00.000Z";
  db.prepare(`
    INSERT INTO institutions(id, name, code, settings_json, updated_at)
    VALUES (?, 'École notes', 'NOTE-1', ?, ?)
  `).run(
    INSTITUTION_ID,
    JSON.stringify({ attendance_presence: { relay_presence_secret: SECRET } }),
    now,
  );
  db.prepare(`
    INSERT INTO profiles(id, institution_id, display_name, is_active, updated_at)
    VALUES (?, ?, 'Prof Notes', 1, ?)
  `).run(TEACHER_ID, INSTITUTION_ID, now);
  db.prepare(`
    INSERT INTO user_roles(id, institution_id, profile_id, role, updated_at)
    VALUES ('role-grade-teacher', ?, ?, 'teacher', ?)
  `).run(INSTITUTION_ID, TEACHER_ID, now);
  for (const [id, label] of [[CLASS_ID, "6e1"], [OTHER_CLASS_ID, "6e2"]]) {
    db.prepare(`
      INSERT INTO classes(id, institution_id, academic_year, label, level, updated_at)
      VALUES (?, ?, '2026-2027', ?, '6e', ?)
    `).run(id, INSTITUTION_ID, label, now);
  }
  for (const [id, name] of [[SUBJECT_ID, "Mathématiques"], [OTHER_SUBJECT_ID, "Français"]]) {
    db.prepare(`
      INSERT INTO subjects(id, institution_id, name, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, INSTITUTION_ID, name, now);
  }
  db.prepare(`
    INSERT INTO class_teachers(
      id, institution_id, class_id, subject_id, teacher_id, start_date, end_date, updated_at
    ) VALUES ('ct-grade', ?, ?, ?, ?, '2026-08-01', NULL, ?)
  `).run(INSTITUTION_ID, CLASS_ID, SUBJECT_ID, TEACHER_ID, now);
  db.prepare(`
    INSERT INTO students(
      id, institution_id, registration_number, first_name, last_name, display_name, is_active, updated_at
    ) VALUES (?, ?, 'MAT-001', 'Aya', 'KOFFI', 'KOFFI Aya', 1, ?)
  `).run(STUDENT_ID, INSTITUTION_ID, now);
  db.prepare(`
    INSERT INTO class_enrollments(
      id, institution_id, class_id, student_id, start_date, end_date, updated_at
    ) VALUES ('enroll-grade', ?, ?, ?, '2026-08-01', NULL, ?)
  `).run(INSTITUTION_ID, CLASS_ID, STUDENT_ID, now);
  db.prepare(`
    INSERT INTO grade_periods(
      id, institution_id, academic_year, label, start_date, end_date,
      is_locked, server_version, updated_at, code, short_label, order_index, is_active
    ) VALUES (?, ?, '2026-2027', 'Trimestre 1', '2026-09-01', '2026-12-20', 0, 4, ?, 'T1', 'T1', 1, 1)
  `).run(PERIOD_ID, INSTITUTION_ID, now);
  db.prepare(`
    INSERT INTO grade_evaluations(
      id, institution_id, class_id, subject_id, teacher_id, grade_period_id,
      title, evaluation_date, max_score, coefficient, is_published, is_locked,
      server_version, updated_at, eval_kind, grading_period_id, publication_status,
      publication_version
    ) VALUES (?, ?, ?, ?, ?, ?, 'Devoir 1', '2026-09-15', 20, 1, 0, 0, 7, ?, 'devoir', ?, 'draft', 0)
  `).run(
    EVALUATION_ID,
    INSTITUTION_ID,
    CLASS_ID,
    SUBJECT_ID,
    TEACHER_ID,
    PERIOD_ID,
    now,
    PERIOD_ID,
  );
  db.prepare(`
    INSERT INTO student_grades(
      id, institution_id, evaluation_id, student_id, score, comment,
      server_version, updated_at, updated_by
    ) VALUES ('grade-1', ?, ?, ?, 14.5, 'Bien', 3, ?, ?)
  `).run(INSTITUTION_ID, EVALUATION_ID, STUDENT_ID, now, TEACHER_ID);

  setInstitutionMeta(db, INSTITUTION_ID, "academic_revision", "42");
  setInstitutionMeta(db, INSTITUTION_ID, "academic_snapshot_complete", "true");
  setInstitutionMeta(db, INSTITUTION_ID, "academic_offline_ready", "true");
}

function classActor() {
  return {
    institution_id: INSTITUTION_ID,
    actor_profile_id: CLASS_DEVICE_ID,
    actor_kind: "class_device" as const,
    class_id: CLASS_ID,
  };
}

function teacherActor() {
  return {
    institution_id: INSTITUTION_ID,
    actor_profile_id: TEACHER_ID,
    actor_kind: "teacher" as const,
    class_id: null,
  };
}

function classDeviceToken(now: Date) {
  const payload = {
    v: 2,
    purpose: "attendance_relay_access",
    institution_id: INSTITUTION_ID,
    actor_profile_id: CLASS_DEVICE_ID,
    actor_kind: "class_device",
    class_id: CLASS_ID,
    issued_at: new Date(now.getTime() - 60_000).toISOString(),
    expires_at: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${createHmac("sha256", SECRET).update(encoded).digest("base64url")}`;
}

test("LOT3A: le téléphone de classe lit notes, élèves et périodes depuis SQLite sans emploi du temps", () => {
  const db = openRelayDatabase(":memory:");
  try {
    seed(db);
    const result = relayGradeWorkspace(db, classActor(), {
      class_id: CLASS_ID,
      subject_id: SUBJECT_ID,
      grading_period_id: PERIOD_ID,
    });
    assert.equal(result.source, "relay");
    assert.equal(result.academic_revision, 42);
    assert.equal(result.class_id, CLASS_ID);
    assert.equal(result.assignments.length, 1);
    assert.equal(result.assignments[0]?.subject_name, "Mathématiques");
    assert.equal(result.roster.length, 1);
    assert.equal(result.roster[0]?.full_name, "KOFFI Aya");
    assert.equal(result.grading_periods.length, 1);
    assert.equal(result.evaluations.length, 1);
    assert.equal(result.evaluations[0]?.id, EVALUATION_ID);
    assert.equal(result.scores.length, 1);
    assert.equal(result.scores[0]?.score, 14.5);
  } finally {
    db.close();
  }
});

test("LOT3A: le téléphone de classe ne peut jamais demander une autre classe", () => {
  const db = openRelayDatabase(":memory:");
  try {
    seed(db);
    assert.throws(
      () => relayGradeWorkspace(db, classActor(), { class_id: OTHER_CLASS_ID }),
      (error) =>
        error instanceof RelayGradeWorkspaceError &&
        error.status === 403 &&
        error.code === "grade_class_not_allowed",
    );
  } finally {
    db.close();
  }
});

test("LOT3A: le professeur n'accède qu'à ses affectations classe-matière", () => {
  const db = openRelayDatabase(":memory:");
  try {
    seed(db);
    const ok = relayGradeWorkspace(db, teacherActor(), {
      class_id: CLASS_ID,
      subject_id: SUBJECT_ID,
    });
    assert.equal(ok.assignments.length, 1);
    assert.throws(
      () => relayGradeWorkspace(db, teacherActor(), {
        class_id: CLASS_ID,
        subject_id: OTHER_SUBJECT_ID,
      }),
      (error) =>
        error instanceof RelayGradeWorkspaceError &&
        error.status === 403 &&
        error.code === "grade_subject_not_allowed",
    );
  } finally {
    db.close();
  }
});

test("LOT3A: l'API LAN expose le workspace au jeton borné du téléphone de classe", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  seed(db);
  const now = new Date("2026-08-15T03:05:00.000Z");
  const server = createRelayServer({
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: null,
    institutionCode: "NOTE-1",
    institutionCodes: ["NOTE-1"],
  }, store, { now: () => now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/grades/workspace`, {
      method: "POST",
      headers: {
        Origin: "https://mon-cahier.com",
        "Content-Type": "application/json",
        Authorization: `Bearer ${classDeviceToken(now)}`,
      },
      body: JSON.stringify({
        class_id: CLASS_ID,
        subject_id: SUBJECT_ID,
        grading_period_id: PERIOD_ID,
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.source, "relay");
    assert.equal(body.class_id, CLASS_ID);
    assert.equal(body.evaluations[0]?.id, EVALUATION_ID);
    assert.equal(body.scores[0]?.score, 14.5);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
    db.close();
  }
});

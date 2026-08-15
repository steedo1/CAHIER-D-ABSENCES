import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  openRelayDatabase,
  setInstitutionMeta,
  type RelayDatabase,
} from "../src/db.mjs";
import {
  RelayGradeWriteError,
  secureGradeScoreOperation,
} from "../src/grade-write.mjs";
import { createRelayServer } from "../src/server.mjs";
import { RelayStore } from "../src/store.mjs";

const SECRET = "4444444444444444444444444444444444444444444444444444444444444444";
const INSTITUTION_ID = "inst-grade-write";
const CLASS_ID = "class-grade-write";
const OTHER_CLASS_ID = "other-class-grade-write";
const TEACHER_ID = "teacher-grade-write";
const OTHER_TEACHER_ID = "other-teacher-grade-write";
const CLASS_DEVICE_ID = "class-device-grade-write";
const SUBJECT_ID = "subject-grade-write";
const STUDENT_ID = "student-grade-write";
const STUDENT_2_ID = "student-grade-write-2";
const PERIOD_ID = "period-grade-write";
const EVALUATION_ID = "evaluation-grade-write";

function seed(db: RelayDatabase) {
  const now = "2026-08-15T03:00:00.000Z";
  db.prepare(`
    INSERT INTO institutions(
      id, name, code, timezone, settings_json, updated_at
    ) VALUES (?, 'École notes', 'NOTE-WRITE', 'Africa/Abidjan', ?, ?)
  `).run(
    INSTITUTION_ID,
    JSON.stringify({ attendance_presence: { relay_presence_secret: SECRET } }),
    now,
  );
  for (const [id, name] of [
    [TEACHER_ID, "Prof Notes"],
    [OTHER_TEACHER_ID, "Autre Prof"],
  ]) {
    db.prepare(`
      INSERT INTO profiles(
        id, institution_id, display_name, is_active, updated_at
      ) VALUES (?, ?, ?, 1, ?)
    `).run(id, INSTITUTION_ID, name, now);
  }
  db.prepare(`
    INSERT INTO user_roles(
      id, institution_id, profile_id, role, updated_at
    ) VALUES ('role-grade-write-teacher', ?, ?, 'teacher', ?)
  `).run(INSTITUTION_ID, TEACHER_ID, now);
  db.prepare(`
    INSERT INTO user_roles(
      id, institution_id, profile_id, role, updated_at
    ) VALUES ('role-grade-write-other', ?, ?, 'teacher', ?)
  `).run(INSTITUTION_ID, OTHER_TEACHER_ID, now);

  for (const [id, label] of [
    [CLASS_ID, "6e1"],
    [OTHER_CLASS_ID, "6e2"],
  ]) {
    db.prepare(`
      INSERT INTO classes(
        id, institution_id, academic_year, label, level, updated_at
      ) VALUES (?, ?, '2026-2027', ?, '6e', ?)
    `).run(id, INSTITUTION_ID, label, now);
  }
  db.prepare(`
    INSERT INTO subjects(id, institution_id, name, updated_at)
    VALUES (?, ?, 'Mathématiques', ?)
  `).run(SUBJECT_ID, INSTITUTION_ID, now);
  db.prepare(`
    INSERT INTO class_teachers(
      id, institution_id, class_id, subject_id, teacher_id,
      start_date, end_date, updated_at
    ) VALUES (
      'ct-grade-write', ?, ?, ?, ?, '2026-08-01', NULL, ?
    )
  `).run(INSTITUTION_ID, CLASS_ID, SUBJECT_ID, TEACHER_ID, now);

  for (const [id, matricule, name] of [
    [STUDENT_ID, "MAT-001", "KOFFI Aya"],
    [STUDENT_2_ID, "MAT-002", "YAO Jean"],
  ]) {
    db.prepare(`
      INSERT INTO students(
        id, institution_id, registration_number, display_name,
        is_active, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, INSTITUTION_ID, matricule, name, now);
    db.prepare(`
      INSERT INTO class_enrollments(
        id, institution_id, class_id, student_id,
        start_date, end_date, updated_at
      ) VALUES (?, ?, ?, ?, '2026-08-01', NULL, ?)
    `).run(`enroll-${id}`, INSTITUTION_ID, CLASS_ID, id, now);
  }

  db.prepare(`
    INSERT INTO grade_periods(
      id, institution_id, academic_year, label,
      start_date, end_date, is_locked, server_version,
      updated_at, code, short_label, order_index, is_active
    ) VALUES (
      ?, ?, '2026-2027', 'Trimestre 1',
      '2026-08-01', '2026-12-20', 0, 4,
      ?, 'T1', 'T1', 1, 1
    )
  `).run(PERIOD_ID, INSTITUTION_ID, now);

  db.prepare(`
    INSERT INTO grade_evaluations(
      id, institution_id, class_id, subject_id, teacher_id,
      grade_period_id, title, evaluation_date, max_score,
      coefficient, is_published, is_locked, server_version,
      updated_at, eval_kind, grading_period_id,
      publication_status, publication_version
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      'Devoir 1', '2026-09-15', 20,
      1, 0, 0, 7, ?, 'devoir', ?,
      'draft', 0
    )
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
      id, institution_id, evaluation_id, student_id,
      score, comment, server_version, updated_at, updated_by
    ) VALUES (
      'grade-existing', ?, ?, ?, 14.5, 'Bien', 3, ?, ?
    )
  `).run(
    INSTITUTION_ID,
    EVALUATION_ID,
    STUDENT_ID,
    now,
    TEACHER_ID,
  );

  setInstitutionMeta(db, INSTITUTION_ID, "academic_revision", "50");
  setInstitutionMeta(db, INSTITUTION_ID, "academic_snapshot_complete", "true");
  setInstitutionMeta(db, INSTITUTION_ID, "academic_offline_ready", "true");
}

function teacherActor(profileId = TEACHER_ID) {
  return {
    institution_id: INSTITUTION_ID,
    actor_profile_id: profileId,
    actor_kind: "teacher" as const,
    class_id: null,
  };
}

function classActor(classId = CLASS_ID) {
  return {
    institution_id: INSTITUTION_ID,
    actor_profile_id: CLASS_DEVICE_ID,
    actor_kind: "class_device" as const,
    class_id: classId,
  };
}

function requestBody(
  operationId: string,
  score: number | null,
  studentId = STUDENT_ID,
) {
  return {
    protocol_version: 1,
    operation_id: operationId,
    operation_type: "grades.score.set",
    captured_at_device: "2026-08-15T03:05:00.000Z",
    evaluation_id: EVALUATION_ID,
    student_id: studentId,
    score,
    comment: score === null ? null : "Saisi hors ligne",
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
  return `${encoded}.${createHmac("sha256", SECRET)
    .update(encoded)
    .digest("base64url")}`;
}

test("LOT3B: une note est matérialisée dans SQLite et mise dans l'outbox", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  try {
    seed(db);
    const result = secureGradeScoreOperation(
      store,
      requestBody("grade-op-1", 18),
      teacherActor(),
      new Date("2026-08-15T03:05:01.000Z"),
    );

    assert.equal(result.action, "upsert");
    assert.equal(result.state, "secured_on_relay");
    assert.equal(result.idempotent, false);

    const grade = db.prepare(`
      SELECT score, comment, updated_by, server_version
      FROM student_grades
      WHERE institution_id = ?
        AND evaluation_id = ?
        AND student_id = ?
        AND deleted_at IS NULL
    `).get(INSTITUTION_ID, EVALUATION_ID, STUDENT_ID) as any;
    assert.equal(grade.score, 18);
    assert.equal(grade.comment, "Saisi hors ligne");
    assert.equal(grade.updated_by, TEACHER_ID);
    assert.equal(grade.server_version, 3);

    const outbox = db.prepare(`
      SELECT entity_type, entity_id, action, base_server_version, state
      FROM sync_outbox
      WHERE operation_id = 'grade-op-1'
    `).get() as any;
    assert.equal(outbox.entity_type, "student_grade");
    assert.equal(outbox.entity_id, "grade-existing");
    assert.equal(outbox.action, "upsert");
    assert.equal(outbox.base_server_version, 3);
    assert.equal(outbox.state, "pending");

    const tracked = db.prepare(`
      SELECT local_dirty
      FROM sync_records
      WHERE institution_id = ?
        AND entity_type = 'student_grade'
        AND entity_id = 'grade-existing'
    `).get(INSTITUTION_ID) as any;
    assert.equal(tracked.local_dirty, 1);
  } finally {
    db.close();
  }
});

test("LOT3B: le même operation_id est idempotent et une nouvelle note reçoit une identité stable", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  try {
    seed(db);
    const first = secureGradeScoreOperation(
      store,
      requestBody("grade-op-new", 16, STUDENT_2_ID),
      classActor(),
      new Date("2026-08-15T03:05:01.000Z"),
    );
    const second = secureGradeScoreOperation(
      store,
      requestBody("grade-op-new", 16, STUDENT_2_ID),
      classActor(),
      new Date("2026-08-15T03:05:02.000Z"),
    );

    assert.match(String(first.entity_id), /^[0-9a-f-]{36}$/);
    assert.equal(second.entity_id, first.entity_id);
    assert.equal(second.idempotent, true);
    assert.equal(
      (db.prepare(`
        SELECT COUNT(*) AS n
        FROM sync_outbox
        WHERE operation_id = 'grade-op-new'
      `).get() as any).n,
      1,
    );
    assert.equal(
      (db.prepare(`
        SELECT COUNT(*) AS n
        FROM student_grades
        WHERE institution_id = ?
          AND evaluation_id = ?
          AND student_id = ?
          AND deleted_at IS NULL
      `).get(INSTITUTION_ID, EVALUATION_ID, STUDENT_2_ID) as any).n,
      1,
    );
  } finally {
    db.close();
  }
});

test("LOT3B: l'écriture dépend de l'affectation classe-matière, jamais de l'emploi du temps", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  try {
    seed(db);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM teacher_timetables").get() as any).n,
      0,
    );
    assert.doesNotThrow(() =>
      secureGradeScoreOperation(
        store,
        requestBody("grade-op-no-timetable", 17),
        teacherActor(),
        new Date("2026-08-15T03:05:01.000Z"),
      ),
    );

    assert.throws(
      () =>
        secureGradeScoreOperation(
          store,
          requestBody("grade-op-other-teacher", 12),
          teacherActor(OTHER_TEACHER_ID),
          new Date("2026-08-15T03:05:01.000Z"),
        ),
      (error) =>
        error instanceof RelayGradeWriteError &&
        error.status === 403 &&
        error.code === "grade_assignment_not_allowed",
    );
  } finally {
    db.close();
  }
});

test("LOT3B: bornes, publication, verrou et clôture empêchent les écritures locales", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  try {
    seed(db);
    assert.throws(
      () =>
        secureGradeScoreOperation(
          store,
          requestBody("grade-op-too-high", 20.01),
          teacherActor(),
          new Date("2026-08-15T03:05:01.000Z"),
        ),
      (error) =>
        error instanceof RelayGradeWriteError &&
        error.code === "grade_score_out_of_range",
    );

    db.prepare(`
      UPDATE grade_evaluations
      SET publication_status = 'submitted'
      WHERE id = ?
    `).run(EVALUATION_ID);
    assert.throws(
      () =>
        secureGradeScoreOperation(
          store,
          requestBody("grade-op-submitted", 10),
          teacherActor(),
          new Date("2026-08-15T03:05:01.000Z"),
        ),
      (error) =>
        error instanceof RelayGradeWriteError &&
        error.code === "grade_evaluation_submitted",
    );

    db.prepare(`
      UPDATE grade_evaluations
      SET publication_status = 'draft'
      WHERE id = ?
    `).run(EVALUATION_ID);
    db.prepare(`
      INSERT INTO grade_evaluation_locks(
        id, institution_id, evaluation_id, class_id, subject_id,
        teacher_id, is_locked, server_version, updated_at
      ) VALUES (
        'lock-grade-write', ?, ?, ?, ?, ?, 1, 0, '2026-08-15T03:00:00.000Z'
      )
    `).run(
      INSTITUTION_ID,
      EVALUATION_ID,
      CLASS_ID,
      SUBJECT_ID,
      TEACHER_ID,
    );
    assert.throws(
      () =>
        secureGradeScoreOperation(
          store,
          requestBody("grade-op-locked", 10),
          teacherActor(),
          new Date("2026-08-15T03:05:01.000Z"),
        ),
      (error) =>
        error instanceof RelayGradeWriteError &&
        error.code === "grade_evaluation_locked",
    );

    db.prepare("DELETE FROM grade_evaluation_locks").run();
    db.prepare(`
      UPDATE grade_periods SET end_date = '2026-08-14'
      WHERE id = ?
    `).run(PERIOD_ID);
    assert.throws(
      () =>
        secureGradeScoreOperation(
          store,
          requestBody("grade-op-period-closed", 10),
          teacherActor(),
          new Date("2026-08-15T03:05:01.000Z"),
        ),
      (error) =>
        error instanceof RelayGradeWriteError &&
        error.code === "grading_period_closed",
    );
  } finally {
    db.close();
  }
});

test("LOT3B: score null supprime localement la note et journalise la suppression", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  try {
    seed(db);
    const result = secureGradeScoreOperation(
      store,
      requestBody("grade-op-delete", null),
      classActor(),
      new Date("2026-08-15T03:05:01.000Z"),
    );
    assert.equal(result.action, "delete");
    const active = db.prepare(`
      SELECT COUNT(*) AS n
      FROM student_grades
      WHERE institution_id = ?
        AND id = 'grade-existing'
        AND deleted_at IS NULL
    `).get(INSTITUTION_ID) as any;
    assert.equal(active.n, 0);
    const outbox = db.prepare(`
      SELECT action, entity_type
      FROM sync_outbox
      WHERE operation_id = 'grade-op-delete'
    `).get() as any;
    assert.equal(outbox.action, "delete");
    assert.equal(outbox.entity_type, "student_grade");
  } finally {
    db.close();
  }
});

test("LOT3B: l'API LAN sécurise une note du téléphone de classe", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  seed(db);
  const now = new Date("2026-08-15T03:05:01.000Z");
  const server = createRelayServer({
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: null,
    institutionCode: "NOTE-WRITE",
    institutionCodes: ["NOTE-WRITE"],
  }, store, { now: () => now });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/grades/score-operations`,
      {
        method: "POST",
        headers: {
          Origin: "https://mon-cahier.com",
          "Content-Type": "application/json",
          Authorization: `Bearer ${classDeviceToken(now)}`,
        },
        body: JSON.stringify(requestBody("grade-op-http", 19)),
      },
    );
    assert.equal(response.status, 202);
    const body = await response.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.action, "upsert");
    assert.equal(
      (db.prepare(`
        SELECT score
        FROM student_grades
        WHERE institution_id = ?
          AND evaluation_id = ?
          AND student_id = ?
          AND deleted_at IS NULL
      `).get(INSTITUTION_ID, EVALUATION_ID, STUDENT_ID) as any).score,
      19,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
    db.close();
  }
});

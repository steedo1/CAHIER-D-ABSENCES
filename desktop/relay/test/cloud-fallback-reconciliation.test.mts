import assert from "node:assert/strict";
import { test } from "node:test";
import { openRelayDatabase } from "../src/db.mjs";
import { materializeEntity } from "../src/entity-materializer.mjs";

function setup() {
  const db = openRelayDatabase(":memory:");
  db.prepare(`
    INSERT INTO institutions(id, code, name, timezone, updated_at)
    VALUES ('inst-1', 'SCH-1', 'Ecole', 'Africa/Abidjan', '2026-08-01T07:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO academic_years(id, institution_id, code, label, is_current, updated_at)
    VALUES ('year-1', 'inst-1', '2026', '2026-2027', 1, '2026-08-01T07:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO profiles(id, institution_id, display_name, updated_at)
    VALUES ('teacher-1', 'inst-1', 'Professeur', '2026-08-01T07:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO classes(id, institution_id, academic_year, label, updated_at)
    VALUES ('class-1', 'inst-1', 'year-1', '1ere D1', '2026-08-01T07:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO subjects(id, institution_id, name, updated_at)
    VALUES ('subject-1', 'inst-1', 'Francais', '2026-08-01T07:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO institution_periods(id, institution_id, weekday, label, start_time, end_time, updated_at)
    VALUES ('period-1', 'inst-1', 6, 'Cours 1', '08:00', '09:00', '2026-08-01T07:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO teacher_timetables(
      id, institution_id, class_id, subject_id, teacher_id, period_id, weekday, updated_at
    ) VALUES (
      'timetable-1', 'inst-1', 'class-1', 'subject-1', 'teacher-1', 'period-1', 6,
      '2026-08-01T07:00:00.000Z'
    )
  `).run();
  return db;
}

test("une séance Cloud sans period_id est enrichie sans perdre son cycle de vie", () => {
  const db = setup();
  materializeEntity(db, {
    institutionId: "inst-1",
    entityType: "teacher_session",
    entityId: "cloud-session-1",
    action: "upsert",
    serverVersion: 4,
    occurredAt: "2026-08-01T08:05:00.000Z",
    payload: {
      institution_id: "inst-1",
      client_session_id: "cloud-session-1",
      class_id: "class-1",
      subject_id: "subject-1",
      teacher_id: "teacher-1",
      period_id: null,
      started_at: "2026-08-01T08:00:00.000Z",
      actual_call_at: "2026-08-01T08:03:00.000Z",
      ended_at: null,
      origin: "class_device",
    },
  });
  const row = db.prepare(`
    SELECT period_id, session_date, scheduled_end_at, session_state
    FROM teacher_sessions WHERE institution_id = 'inst-1' AND id = 'cloud-session-1'
  `).get() as {
    period_id: string;
    session_date: string;
    scheduled_end_at: string;
    session_state: string;
  };
  assert.equal(row.period_id, "period-1");
  assert.equal(row.session_date, "2026-08-01");
  assert.equal(row.scheduled_end_at, "2026-08-01T09:00:00.000Z");
  assert.equal(row.session_state, "open");
  db.close();
});

test("une marque Cloud est matérialisée sur la bonne séance et la bonne école", () => {
  const db = setup();
  db.prepare(`
    INSERT INTO students(id, institution_id, display_name, updated_at)
    VALUES ('student-1', 'inst-1', 'Eleve', '2026-08-01T07:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO teacher_sessions(
      id, institution_id, class_id, subject_id, teacher_id, period_id, started_at,
      origin, updated_at
    ) VALUES (
      'cloud-session-1', 'inst-1', 'class-1', 'subject-1', 'teacher-1', 'period-1',
      '2026-08-01T08:00:00.000Z', 'class_device', '2026-08-01T08:00:00.000Z'
    )
  `).run();
  materializeEntity(db, {
    institutionId: "inst-1",
    entityType: "attendance_mark",
    entityId: "cloud-mark-1",
    action: "upsert",
    serverVersion: 5,
    occurredAt: "2026-08-01T08:10:00.000Z",
    payload: {
      institution_id: "inst-1",
      session_id: "cloud-session-1",
      student_id: "student-1",
      status: "late",
      late_minutes: 7,
      comment: "Transport",
    },
  });
  const mark = db.prepare(`
    SELECT institution_id, session_id, student_id, status, late_minutes, comment
    FROM attendance_marks WHERE id = 'cloud-mark-1'
  `).get() as {
    institution_id: string;
    session_id: string;
    student_id: string;
    status: string;
    late_minutes: number;
    comment: string | null;
  };
  assert.deepEqual(mark, {
    institution_id: "inst-1",
    session_id: "cloud-session-1",
    student_id: "student-1",
    status: "late",
    late_minutes: 7,
    comment: "Transport",
  });
  db.close();
});

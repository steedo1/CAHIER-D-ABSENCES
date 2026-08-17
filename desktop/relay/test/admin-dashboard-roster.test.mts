import assert from "node:assert/strict";
import test from "node:test";
import { adminDashboard } from "../src/admin-dashboard.mjs";
import { openRelayDatabase } from "../src/db.mjs";

test("le dashboard relais expose le roster, les annees et les periodes synchronisees", () => {
  const db = openRelayDatabase(":memory:");
  try {
    const now = "2026-08-17T00:00:00.000Z";
    db.prepare(`
      INSERT INTO institutions(
        id, name, code, timezone, settings_json, server_version, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL)
    `).run(
      "inst-1",
      "College Test",
      "TEST",
      "Africa/Abidjan",
      JSON.stringify({ institution_name: "College Test" }),
      now,
    );

    const insertYear = db.prepare(`
      INSERT INTO academic_years(
        id, institution_id, code, label, start_date, end_date, is_current,
        server_version, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL)
    `);
    insertYear.run(
      "year-current",
      "inst-1",
      "2026-2027",
      "2026-2027",
      "2026-09-01",
      "2027-07-31",
      1,
      now,
    );
    insertYear.run(
      "year-old",
      "inst-1",
      "2025-2026",
      "2025-2026",
      "2025-09-01",
      "2026-07-31",
      0,
      now,
    );

    db.prepare(`
      INSERT INTO grade_periods(
        id, institution_id, academic_year, label, start_date, end_date,
        is_locked, server_version, updated_at, deleted_at, code, short_label,
        order_index, is_active, kind, coeff
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      "period-t1",
      "inst-1",
      "2026-2027",
      "1er trimestre",
      "2026-09-01",
      "2026-12-20",
      now,
      "T1",
      "T1",
      1,
      1,
      "trimester",
      1,
    );

    const insertClass = db.prepare(`
      INSERT INTO classes(
        id, institution_id, academic_year, label, level, server_version,
        updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL)
    `);
    insertClass.run("class-current", "inst-1", "2026-2027", "6e A", "6e", now);
    insertClass.run("class-old", "inst-1", "2025-2026", "5e A", "5e", now);

    const insertStudent = db.prepare(`
      INSERT INTO students(
        id, institution_id, registration_number, first_name, last_name,
        display_name, gender, is_active, server_version, updated_at, deleted_at,
        birthdate, birth_place, nationality, regime, is_repeater, is_boarder,
        is_affecte, lv2, lifecycle_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStudent.run(
      "student-active",
      "inst-1",
      "M001",
      "Aya",
      "KOFFI",
      "KOFFI Aya",
      "F",
      1,
      now,
      "2014-02-03",
      "Aboisso",
      "Ivoirienne",
      "Externe",
      0,
      0,
      1,
      null,
      "active",
    );
    insertStudent.run(
      "student-ended",
      "inst-1",
      "M002",
      "Jean",
      "YAO",
      "YAO Jean",
      "M",
      1,
      now,
      null,
      null,
      null,
      null,
      0,
      0,
      0,
      null,
      "active",
    );
    insertStudent.run(
      "student-old-year",
      "inst-1",
      "M003",
      "Paul",
      "KOUAME",
      "KOUAME Paul",
      "M",
      1,
      now,
      null,
      null,
      null,
      null,
      0,
      0,
      0,
      null,
      "active",
    );

    const insertEnrollment = db.prepare(`
      INSERT INTO class_enrollments(
        id, institution_id, class_id, student_id, start_date, end_date,
        server_version, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL)
    `);
    insertEnrollment.run(
      "enrollment-active",
      "inst-1",
      "class-current",
      "student-active",
      "2026-09-01",
      null,
      now,
    );
    insertEnrollment.run(
      "enrollment-ended",
      "inst-1",
      "class-current",
      "student-ended",
      "2026-09-01",
      "2026-10-01",
      now,
    );
    insertEnrollment.run(
      "enrollment-old",
      "inst-1",
      "class-old",
      "student-old-year",
      "2025-09-01",
      null,
      now,
    );

    const result = adminDashboard(db, {
      institutionId: "inst-1",
      date: "2026-08-17",
      now: new Date("2026-08-17T08:00:00.000Z"),
    }) as any;

    assert.equal(result.roster.academic_year, "2026-2027");
    assert.deepEqual(
      result.roster.academic_years.map((row: any) => row.code),
      ["2026-2027", "2025-2026"],
    );
    assert.equal(result.roster.academic_years[0].is_current, true);
    assert.deepEqual(
      result.roster.grading_periods.map((row: any) => row.code),
      ["T1"],
    );
    assert.equal(result.roster.grading_periods[0].is_active, true);
    assert.deepEqual(
      result.roster.classes.map((row: any) => row.id),
      ["class-current"],
    );
    assert.deepEqual(
      result.roster.students.map((row: any) => row.id),
      ["student-active"],
    );
    assert.equal(result.roster.students[0].full_name, "KOFFI Aya");
    assert.equal(result.roster.students[0].matricule, "M001");
    assert.equal(result.roster.students[0].class_label, "6e A");
    assert.equal(result.roster.students[0].birth_place, "Aboisso");
    assert.equal(result.roster.students[0].is_affecte, true);
    assert.equal(result.roster.institution_settings.institution_name, "College Test");
    assert.equal(result.roster.institution_settings.institution_code, "TEST");
  } finally {
    db.close();
  }
});

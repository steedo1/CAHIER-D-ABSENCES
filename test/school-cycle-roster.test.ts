import assert from "node:assert/strict";
import test from "node:test";
import { aggregateSchoolCycleRoster } from "../src/lib/school-cycle-roster";

test("school totals deduplicate a learner attending French and Arabic classes", () => {
  const summary = aggregateSchoolCycleRoster(
    [
      { id: "cp1-fr", cycle: "primary" },
      { id: "cp1-ar", cycle: "primary" },
      { id: "6e", cycle: "secondary" },
    ],
    [
      { class_id: "cp1-fr", student_id: "student-1", end_date: null },
      { class_id: "cp1-ar", student_id: "student-1", end_date: null },
      { class_id: "6e", student_id: "student-1", end_date: null },
      { class_id: "cp1-fr", student_id: "student-2", end_date: null },
      { class_id: "6e", student_id: "inactive", end_date: "2026-09-01" },
      { class_id: "another-school", student_id: "unauthorized", end_date: null },
    ],
    [
      { class_id: "cp1-fr", teacher_id: "prof-a", end_date: null },
      { class_id: "cp1-ar", teacher_id: "prof-a", end_date: null },
      { class_id: "cp1-ar", teacher_id: "prof-b", end_date: null },
      { class_id: "6e", teacher_id: "prof-b", end_date: null },
      { class_id: "another-school", teacher_id: "unauthorized", end_date: null },
    ],
  );
  assert.equal(summary.uniqueStudents, 2);
  assert.equal(summary.byCycle.primary.students, 2);
  assert.equal(summary.byCycle.secondary.students, 1);
  assert.equal(summary.uniqueTeachers, 2);
  assert.equal(summary.byCycle.primary.teachers, 2);
  assert.equal(summary.byCycle.secondary.teachers, 1);
  assert.equal(summary.byCycle.preschool.students, 0);
});

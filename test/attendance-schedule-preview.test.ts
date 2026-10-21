import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { schedulePreviewRows, weekdayCodeForDate } from "../src/lib/attendance-schedule-preview";

const period = { id: "period-wed", weekday: 3, start_time: "10:15:00", end_time: "11:10:00", label: "Séance 4" };
const classRow = { id: "classe-3e2", label: "3e2", level: "3e", education_type: "general_secondary" };
const teacher = { id: "enseignant-1", display_name: "Professeur du CSCA", phone: null };
const subject = { id: "mat-1", custom_name: "Français", subjects: { id: "base-1", name: "Français" } };

test("Wednesday 21 October 2026 resolves to day 3 for a school with only weekdays 1..5", () => {
  assert.equal(weekdayCodeForDate("2026-10-21", [1, 2, 3, 4, 5].map(weekday => ({ weekday }))), 3);
  assert.equal(weekdayCodeForDate("2026-10-21", [{ weekday: 7 }]), 3);
  assert.equal(weekdayCodeForDate("2026-10-21", [{ weekday: 0 }, { weekday: 4 }]), 2);
});

test("a planned course is visible even without any started attendance session", () => {
  const rows = schedulePreviewRows({
    date: "2026-10-21",
    periods: [period],
    timetables: [{ id: "tt1", class_id: classRow.id, period_id: period.id, subject_id: subject.id, teacher_id: teacher.id }],
    classes: [classRow],
    teachers: [teacher],
    subjects: [subject],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "unconfirmed");
  assert.equal(rows[0].planned_start, "10:15");
  assert.equal(rows[0].planned_end, "11:10");
  assert.equal(rows[0].class_label, "3e2");
  assert.equal(rows[0].teacher_name, "Professeur du CSCA");
  assert.equal(rows[0].subject_name, "Français");
  assert.equal("actual_call_at" in rows[0], false);
  assert.equal("session_id" in rows[0], false);
});

test("a class not in the permitted and current-year scope does not leak into preview", () => {
  const rows = schedulePreviewRows({
    date: "2026-10-21",
    periods: [period],
    timetables: [{ class_id: "not-in-institution-or-scope", period_id: period.id, subject_id: subject.id, teacher_id: teacher.id }],
    classes: [classRow],
    teachers: [teacher],
    subjects: [subject],
  });
  assert.deepEqual(rows, []);
});

test("attendance grid distinguishes verified statuses and schedule-only unknown states", () => {
  const grid = readFileSync(new URL("../src/app/admin/absences/appels-matrice/page.tsx", import.meta.url), "utf8");
  assert.match(grid, /schedule-preview/);
  assert.match(grid, /setMonitorUnverified\(true\)/);
  assert.match(grid, /status: "unconfirmed"/);
  assert.match(grid, /"À VÉRIFIER"/);
  assert.match(grid, /showCounter\(totalMissing\)/);
  assert.match(grid, /Aucun appel ni aucune absence ne sont déduits/);
  assert.doesNotMatch(grid, /Aucun créneau horaire n&amp;apos;a été trouvé pour aujourd/);
  const route = readFileSync(new URL("../src/app/api/admin/attendance/schedule-preview/route.ts", import.meta.url), "utf8");
  assert.match(route, /role === "admin" \|\| r\.role === "super_admin"/);
  assert.match(route, /eq\("institution_id", institutionId\)/);
  assert.match(route, /monitor_verified: false/);
  assert.doesNotMatch(route, /from\("teacher_sessions"\)/);
});

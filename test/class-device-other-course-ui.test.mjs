import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/app/class/page.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/app/api/class/subjects/route.ts", import.meta.url), "utf8");

test("Autre cours is selectable even without a configured slot", () => {
  assert.match(page, /manualSubjectMode\s*\?\s*!!classId && manualDurationValid/);
  assert.match(page, /if \(!activeConfiguredSlot\) \{/);
  assert.match(page, /manual_course:\s*manualSubjectMode/);
  assert.match(page, /const persistedPeriodId = manualSubjectMode\s*\? activeConfiguredSlot\?\.id \|\| null/);
  assert.match(page, /stageTeacherAttendanceSessionOpen\(/);
});

test("exceptional discipline requires explicit selection and no automatic fallback", () => {
  assert.match(page, /if \(manualSubjectMode\) return "";/);
  assert.match(page, /manualSubjectMode \|\| subjects\.length > 1/);
  assert.match(page, /chooseCourseMode\(true\)/);
  assert.match(page, /chooseCourseMode\(false\)/);
  assert.match(page, /manual_course=1/);
});

test("exceptional duration is independent and does not follow scheduled period", () => {
  assert.match(page, /const \[manualDuration, setManualDuration\]/);
  assert.match(page, /let effectiveDuration = manualSubjectMode\s*\? manualDuration/);
  assert.match(page, /min=\{1\}/);
  assert.match(page, /max=\{240\}/);
  assert.match(page, /manualSubjectMode && !manualDurationValid/);
  assert.match(page, /actualCallAtISO = observedAt\.toISOString\(\)/);
});

test("exceptional subject endpoint filters current teacher assignments without scanning marks", () => {
  const branchStart = api.indexOf("if (manualCourse) {", api.indexOf("// Voie exceptionnelle explicite"));
  const branchEnd = api.indexOf("// 2) Sans créneau demandé", branchStart);
  assert.ok(branchStart > 0 && branchEnd > branchStart);
  const manual = api.slice(branchStart, branchEnd);
  assert.match(manual, /\.from\("class_teachers"\)/);
  assert.match(manual, /\.eq\("institution_id", institutionId\)/);
  assert.match(manual, /\.eq\("class_id", class_id\)/);
  assert.match(manual, /teachers\.size === 1/);
  assert.match(manual, /return scheduleJson/);
  assert.doesNotMatch(manual, /grade_flat_marks/);
  assert.doesNotMatch(manual, /teacher_timetables/);
});

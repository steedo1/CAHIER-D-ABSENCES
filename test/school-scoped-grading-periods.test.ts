import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizedSchoolPeriodCode,
  schoolPeriodFormationCode,
  schoolPeriodStoredCode,
  schoolPeriodProgramForClass,
} from "../src/lib/school-grading-periods";

const classId = "11111111-1111-4111-8111-111111111111";
const school = {
  school_cycles_v1: {
    version: 1, enabled: true, enabledCycles: ["preschool", "primary", "secondary"],
    classCycleById: { [classId]: "primary" },
    teachingTracksByCycle: {
      preschool: ["french", "arabic"], primary: ["french", "arabic"],
      secondary: ["french", "arabic"],
    },
    subjectTracksByCycle: {},
  },
  school_student_programs_v1: {
    version: 1, years: {
      "2026-2027": { classes: {
        [classId]: { tracks: ["arabic"], students: {} },
      } },
    },
  },
};

test("a single taught program receives its own actual periods", () => {
  assert.deepEqual(schoolPeriodProgramForClass(school, "2026-2027",
    { id: classId, level: "CP1" }), { cycle: "primary", track: "arabic" });
  assert.equal(schoolPeriodProgramForClass(school, "2025-2026",
    { id: classId, level: "CP1" }), null);
  assert.equal(schoolPeriodProgramForClass({}, "2026-2027",
    { id: classId, level: "CP1" }), null);
});

test("ambiguous dual teaching classes are never given an arbitrary period", () => {
  const dual = structuredClone(school);
  dual.school_student_programs_v1.years["2026-2027"].classes[classId].tracks =
    ["french", "arabic"];
  assert.equal(schoolPeriodProgramForClass(dual, "2026-2027",
    { id: classId, level: "CP1" }), null);
});

test("database scope and period codes are disjoint across cycle and teaching", () => {
  const pairs = [
    schoolPeriodFormationCode("primary", "arabic"),
    schoolPeriodFormationCode("primary", "french"),
    schoolPeriodFormationCode("secondary", "arabic"),
    schoolPeriodFormationCode("preschool", "arabic"),
  ];
  assert.equal(new Set(pairs).size, pairs.length);
  assert.equal(new Set(pairs.map((_, i) =>
    schoolPeriodStoredCode(["primary", "primary", "secondary", "preschool"][i] as any,
      ["arabic", "french", "arabic", "arabic"][i] as any, "T1"))).size, 4);
  assert.equal(normalizedSchoolPeriodCode(" t1 "), "T1");
  assert.equal(normalizedSchoolPeriodCode("T 1"), null);
  assert.equal(normalizedSchoolPeriodCode(""), null);
});

test("school periods reuse actual grade_periods and teacher evaluation APIs", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const route = read("src/app/api/admin/school-grading-periods/route.ts");
  const helper = read("src/lib/education-grading-periods.ts");
  const evaluation = read("src/app/api/teacher/grades/evaluations/route.ts");
  const page = read("src/app/admin/parametres/page.tsx");
  const editor = read("src/components/admin/SchoolGradingPeriodsEditor.tsx");
  assert.match(route, /from\("grade_periods"\)/);
  assert.match(route, /from\("grade_evaluations"\)/);
  assert.match(route, /period_used_by_evaluations/);
  assert.match(route, /requireInstitutionRole\(browser, service, \["admin"\]\)/);
  assert.match(helper, /schoolPeriodProgramForClass/);
  assert.match(helper, /listSchoolProgramPeriods/);
  assert.match(evaluation, /autoDetectApplicableGradePeriod/);
  assert.match(evaluation, /getApplicableGradePeriodById/);
  assert.match(page, /<SchoolGradingPeriodsEditor academicYear=\{selectedAcademicYear\}/);
  assert.match(editor, /api\/admin\/school-grading-periods/);
  assert.match(read("src/app/api/parent/grading-periods/route.ts"),
    /schoolPeriodProgramForClass/);
});

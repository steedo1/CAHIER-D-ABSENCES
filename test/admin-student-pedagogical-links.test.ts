import assert from "node:assert/strict";
import test from "node:test";
import { adminStudentPedagogicalLinks } from "../src/lib/admin-student-pedagogical-links.ts";

const classFrench = "11111111-1111-4111-8111-111111111111";
const classArabic = "22222222-2222-4222-8222-222222222222";
const otherArabic = "33333333-3333-4333-8333-333333333333";
const studentA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const studentB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherStudent = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const classes = [
  { id: classFrench, academic_year: "2026-2027", level: "CP1" },
  { id: classArabic, academic_year: "2026-2027", level: "CP1" },
  { id: otherArabic, academic_year: "2026-2027", level: "CM1" },
];
const enrollments = [
  { student_id: studentA, class_id: classFrench },
  { student_id: studentB, class_id: classFrench },
  { student_id: otherStudent, class_id: otherArabic },
];
const settings = {
  school_cycles_v1: {
    version: 1, enabled: true, enabledCycles: ["primary"],
    classCycleById: {},
    teachingTracksByCycle: { primary: ["french", "arabic"] },
  },
  school_student_programs_v1: {
    version: 1, years: { "2026-2027": { classes: {
      [classFrench]: { tracks: ["french"], students: {} },
      [classArabic]: { tracks: ["arabic"], students: {}, linkedStudentIds: [studentA, studentB, otherStudent] },
    } } },
  },
};

test("linked French pupils appear in Arabic class without changing their real enrollment", () => {
  const result = adminStudentPedagogicalLinks(settings, classes, enrollments);
  assert.deepEqual(result.byStudent[studentA], [classArabic]);
  assert.deepEqual(result.byStudent[studentB], [classArabic]);
  // CM1 pupil must not appear in CP1 even if a stale link was saved.
  assert.equal(result.byStudent[otherStudent], undefined);
  assert.ok(result.pedagogicalClassIds.includes(classArabic));
  assert.equal(enrollments.filter(row => row.class_id === classArabic).length, 0);
  assert.equal(enrollments.length, 3);
});
test("legacy schools do not gain virtual enrollments", () => {
  const result = adminStudentPedagogicalLinks({}, classes, enrollments);
  assert.deepEqual(result.byStudent, {});
  assert.deepEqual(result.pedagogicalClassIds, []);
});
test("only real policy links can create pedagogical class membership", () => {
  const altered = structuredClone(settings);
  altered.school_student_programs_v1.years["2026-2027"].classes[classArabic].tracks = ["french"];
  const result = adminStudentPedagogicalLinks(altered, classes, enrollments);
  assert.deepEqual(result.byStudent, {});
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  SCHOOL_STUDENT_PROGRAMS_KEY,
  aggregateStudentProgramRoster,
  isBilingualSchool,
  normalizedProgramTracks,
  programsForStudent,
  readStudentProgramSettings,
} from "../src/lib/school-student-programs";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";
import { mergeGeneralSchoolSettings } from "../src/lib/school-settings-write";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const S1 = "44444444-4444-4444-8444-444444444444";
const S2 = "55555555-5555-4555-8555-555555555555";
const S3 = "66666666-6666-4666-8666-666666666666";
const school = parseSchoolCyclesSettings({
  school_cycles_v1: {
    version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
    teachingTracksByCycle: {
      primary: ["french", "arabic"], secondary: ["french", "arabic"],
    },
  },
});
const stored = {
  [SCHOOL_STUDENT_PROGRAMS_KEY]: {
    version: 1,
    years: {
      "2026-2027": {
        classes: {
          [A]: { tracks: ["french", "arabic"], students: { [S2]: ["arabic"] } },
          [B]: { tracks: ["french"], students: {} },
        },
      },
    },
  },
};

test("ordinary establishments never receive bilingual program settings", () => {
  assert.equal(isBilingualSchool(parseSchoolCyclesSettings({})), false);
  assert.equal(isBilingualSchool(school), true);
  assert.equal(mergeGeneralSchoolSettings({}, stored), null);
  assert.equal(mergeGeneralSchoolSettings(stored, { [SCHOOL_STUDENT_PROGRAMS_KEY]: null }), null);
});

test("students can follow both tracks without creating duplicate identities", () => {
  const memberships = readStudentProgramSettings(stored);
  const policy = memberships.years["2026-2027"].classes[A];
  assert.deepEqual(programsForStudent(policy, S1, ["french", "arabic"]), ["french", "arabic"]);
  assert.deepEqual(programsForStudent(policy, S2, ["french", "arabic"]), ["arabic"]);
  assert.deepEqual(programsForStudent(undefined, S3, ["french", "arabic"]), []);
  assert.deepEqual(programsForStudent(policy, S2, ["french"]), []);
});

test("dedupe pupils by id per cycle, per teaching, without summing program counts", () => {
  const roster = aggregateStudentProgramRoster(
    school, readStudentProgramSettings(stored).years["2026-2027"],
    [{ id: A, cycle: "primary" }, { id: B, cycle: "primary" }, { id: C, cycle: "secondary" }],
    [
      { class_id: A, student_id: S1 },
      { class_id: A, student_id: S2 },
      { class_id: B, student_id: S1 }, // second class, same human identity
      { class_id: C, student_id: S3 },
      { class_id: C, student_id: S1, end_date: "2026-06-30" },
      { class_id: "not-school-class", student_id: S3 },
    ],
  );
  assert.equal(roster.primary.french.students, 1);
  assert.equal(roster.primary.arabic.students, 2);
  assert.equal(roster.primary.french.classes, 2);
  assert.equal(roster.primary.arabic.classes, 1);
  assert.equal(roster.primary.french.complete, true);
  assert.equal(roster.secondary.french.unclassifiedStudents, 1);
  assert.equal(roster.secondary.arabic.complete, false);
});

test("an unresolved enrollment forces cautious incomplete status even if another class has a mapping", () => {
  const roster = aggregateStudentProgramRoster(school,
    readStudentProgramSettings(stored).years["2026-2027"],
    [{ id: A, cycle: "primary" }, { id: C, cycle: "primary" }],
    [{ class_id: A, student_id: S1 }, { class_id: C, student_id: S1 }]);
  assert.equal(roster.primary.french.students, 1);
  assert.equal(roster.primary.french.complete, false);
  assert.equal(roster.primary.arabic.unclassifiedStudents, 1);
});

test("invalid tracks or identifiers cannot silently be accepted", () => {
  assert.deepEqual(normalizedProgramTracks(["french", "arabic"]), ["french", "arabic"]);
  assert.equal(normalizedProgramTracks(["francais"]), null);
  assert.equal(normalizedProgramTracks(["arabic", "arabic", "french"]), null);
  const bad = readStudentProgramSettings({ [SCHOOL_STUDENT_PROGRAMS_KEY]: {
    version: 1, years: { "2026-2027": {
      classes: {
        malicious: { tracks: ["arabic"], students: {} },
        [A]: { tracks: ["arabic"], students: {
          stranger: ["arabic"], [S1]: ["invalid"], [S2]: ["arabic"],
        } },
      },
    } },
  } });
  assert.deepEqual(Object.keys(bad.years["2026-2027"].classes), [A]);
  assert.deepEqual(Object.keys(bad.years["2026-2027"].classes[A].students), [S2]);
});

test("new academic years cannot inherit old student-class allocations", () => {
  const membership = readStudentProgramSettings(stored);
  assert.equal(membership.years["2025-2026"], undefined);
  assert.equal(membership.years["2027-2028"], undefined);
});

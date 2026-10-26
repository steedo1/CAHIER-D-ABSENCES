import assert from "node:assert/strict";
import test from "node:test";
import { classSubjectIds, readClassSubjects } from "../src/lib/school-class-subjects";
import { resolveProgramCoefficients } from "../src/lib/pedagogical-engine";

const classA = "11111111-1111-4111-8111-111111111111";
const math = "22222222-2222-4222-8222-222222222222";
const quran = "33333333-3333-4333-8333-333333333333";
const policy = { school_class_subjects_v1: { version: 1,
  years: { "2026-2027": { classes: { [classA]: [quran] } } } } };
const settings = {
  ...policy,
  school_cycles_v1: { version: 1, enabled: true, enabledCycles: ["primary"],
    classCycleById: { [classA]: "primary" }, teachingTracksByCycle: { primary: ["french", "arabic"] },
    subjectTracksByCycle: { primary: { [math]: ["french"], [quran]: ["arabic"] } } },
  franco_arabic_reports_v1: { version: 1, enabled: true, engine: "specialized",
    format: "separate", coefficientSource: "institution",
    scales: [{ cycle: "primary", level: "CP1", track: "arabic", maxScore: 20 }], coefficients: [] },
};
test("old schools have no class-subject feature and no implicit subjects", () => {
  assert.equal(classSubjectIds({}, "2026-2027", classA), null);
  assert.deepEqual(classSubjectIds(policy, "2026-2027", classA), [quran]);
  assert.equal(classSubjectIds(policy, "2027-2028", classA), null);
  assert.equal(classSubjectIds(policy, "2026-2027", "44444444-4444-4444-8444-444444444444"), null);
  assert.equal(readClassSubjects({ school_class_subjects_v1: { version: 2 } })?.version, 1);
});
test("class-specific curriculum rejects malformed ids and duplicates", () => {
  const malformed = { school_class_subjects_v1: {
    version: 1, years: { "2026-2027": {
      classes: { malicious: [quran], [classA]: [quran, quran, "wrong"] },
    } },
  } };
  assert.deepEqual(readClassSubjects(malformed)?.years["2026-2027"].classes, {});
});
test("a CM2 Arabic subject is never injected in CP1 Arabic by the cycle catalog", () => {
  const result = resolveProgramCoefficients({
    cycle: "primary", level: "CP1", track: "arabic", settingsJson: settings,
    activeSubjectIds: [quran, math], levelSubjectIds: [math, quran],
    classSubjectIds: classSubjectIds(policy, "2026-2027", classA),
    institutionCoefficients: [
      { level: "CP1", subject_id: quran, coeff: 3, include_in_average: true },
      { level: "CP1", subject_id: math, coeff: 7, include_in_average: true },
    ],
  });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.policies.map(item => item.subjectId), [quran]);
});
test("class with empty curriculum cannot produce an apparently completed report", () => {
  const result = resolveProgramCoefficients({
    cycle: "primary", level: "CP1", track: "arabic", settingsJson: settings,
    activeSubjectIds: [quran], levelSubjectIds: [quran],
    classSubjectIds: [], institutionCoefficients: [
      { level: "CP1", subject_id: quran, coeff: 4, include_in_average: true },
    ],
  });
  assert.deepEqual(result.policies, []);
  assert.ok(result.problems.includes("class_curriculum_not_configured"));
});
test("primary class curriculum requires no subject coefficients, only explicit barèmes", () => {
  const result = resolveProgramCoefficients({
    cycle: "primary", level: "CP1", track: "arabic", settingsJson: settings,
    activeSubjectIds: [quran], levelSubjectIds: [quran],
    classSubjectIds: [quran], institutionCoefficients: [],
  });
  assert.deepEqual(result.problems, []);
  assert.equal(result.source, "barèmes");
  assert.equal(result.policies.length, 1);
  assert.equal(result.policies[0].coefficient, 1);
});

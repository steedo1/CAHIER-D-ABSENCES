import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProgramBulletinDraft,
  combineProgramBulletins,
  type OfficialEvaluationScore,
} from "../src/lib/franco-arabic-bulletin-calculation";
import {
  parseSchoolCyclesSettings,
  SCHOOL_CYCLES_SETTINGS_KEY,
} from "../src/lib/school-cycles";
import {
  parseFrancoArabicReportsSettings,
  FRANCO_ARABIC_REPORTS_SETTINGS_KEY,
} from "../src/lib/franco-arabic-reporting";

const math = "11111111-1111-4111-8111-111111111111";
const quran = "22222222-2222-4222-8222-222222222222";
const french = "33333333-3333-4333-8333-333333333333";

const school = parseSchoolCyclesSettings({
  [SCHOOL_CYCLES_SETTINGS_KEY]: {
    version: 1, enabled: true, enabledCycles: ["primary"],
    teachingTracksByCycle: { primary: ["french", "arabic"] },
    subjectTracksByCycle: {
      primary: { [math]: ["french"], [quran]: ["arabic"], [french]: ["french"] },
    },
  },
});
const reports = parseFrancoArabicReportsSettings({
  [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: {
    version: 1, enabled: true, format: "both",
    scales: [
      { cycle: "primary", level: "CP1", track: "french", maxScore: 10 },
      { cycle: "primary", level: "CP1", track: "arabic", maxScore: 20 },
    ],
    coefficients: [
      { cycle: "primary", level: "CP1", track: "french", subjectId: math, coefficient: 2, includeInAverage: true },
      { cycle: "primary", level: "CP1", track: "french", subjectId: french, coefficient: 3, includeInAverage: true },
      { cycle: "primary", level: "CP1", track: "arabic", subjectId: quran, coefficient: 1, includeInAverage: true },
    ],
  },
});
const scores: OfficialEvaluationScore[] = [
  { studentId: "A", subjectId: math, evaluationId: "e-m1", score: 8, scale: 10, evaluationCoefficient: 1, isCurrentPublished: true },
  { studentId: "A", subjectId: math, evaluationId: "e-m2", score: 12, scale: 20, evaluationCoefficient: 3, isCurrentPublished: true },
  { studentId: "A", subjectId: french, evaluationId: "e-f1", score: 16, scale: 20, evaluationCoefficient: 1, isCurrentPublished: true },
  { studentId: "A", subjectId: quran, evaluationId: "e-q1", score: 15, scale: 20, evaluationCoefficient: 1, isCurrentPublished: true },
  // NOT from the requested student; must never count.
  { studentId: "B", subjectId: math, evaluationId: "e-foreign", score: 10, scale: 10, evaluationCoefficient: 1, isCurrentPublished: true },
  // Unpublished; must never count.
  { studentId: "A", subjectId: math, evaluationId: "e-draft", score: 0, scale: 10, evaluationCoefficient: 1, isCurrentPublished: false },
];

const calc = (track: "french" | "arabic", input = scores, config = reports) =>
  buildProgramBulletinDraft({
    studentId: "A", cycle: "primary", level: "CP1",
    track, school, reports: config, officialScores: input,
  });

test("two programs use the same student identity but entirely different subjects", () => {
  const fr = calc("french");
  const ar = calc("arabic");
  assert.equal(fr.status, "ready");
  assert.equal(ar.status, "ready");
  assert.equal(fr.maximumScore, 10);
  assert.equal(ar.maximumScore, 20);
  assert.deepEqual(fr.subjects.map((x) => x.subjectId), [math, french].sort());
  assert.deepEqual(ar.subjects.map((x) => x.subjectId), [quran]);
  assert.equal(fr.subjects.find((x) => x.subjectId === math)?.average, 6.5);
  assert.equal(fr.subjects.find((x) => x.subjectId === french)?.average, 8);
  assert.equal(fr.generalAverage, 7.4);
  assert.equal(ar.generalAverage, 15);
  const combined = combineProgramBulletins(fr, ar);
  assert.ok(combined?.ready);
  assert.equal(combined?.studentId, "A");
  assert.equal(combined?.combinedAverage, null);
});

test("missing coefficients cannot be guessed and produce no mean", () => {
  const ar = calc("arabic", scores, {
    ...reports, coefficients: reports.coefficients.filter((p) => p.subjectId !== quran),
  });
  assert.equal(ar.status, "incomplete");
  assert.equal(ar.generalAverage, null);
  assert.ok(ar.problems.includes("subject_policy_missing_or_invalid"));
});

test("no implicit mean from a partially marked student", () => {
  const fr = calc("french", scores.filter((x) => x.subjectId !== french));
  assert.equal(fr.status, "incomplete");
  assert.equal(fr.generalAverage, null);
  assert.ok(fr.problems.includes("included_subject_without_score"));
});

test("duplicate publication versions do not inflate or leak scores", () => {
  const fr = calc("french", [
    ...scores,
    { studentId: "A", subjectId: math, evaluationId: "e-m1", score: 3, scale: 10,
      evaluationCoefficient: 1, isCurrentPublished: true },
  ]);
  assert.equal(fr.status, "incomplete");
  assert.equal(fr.generalAverage, null);
  assert.ok(fr.problems.includes("duplicate_published_evaluation"));
});

test("invalid bounds and nonpositive evaluation coefficients fail closed", () => {
  const fr = calc("french", scores.map((x) =>
    x.evaluationId === "e-m2" ? { ...x, score: 50 } : x));
  assert.equal(fr.status, "incomplete");
  assert.equal(fr.generalAverage, null);
  assert.ok(fr.problems.includes("invalid_published_score"));
});

test("legacy institution cannot accidentally generate a bilingual report", () => {
  const result = buildProgramBulletinDraft({
    studentId: "A", cycle: "primary", level: "CP1", track: "french",
    school: parseSchoolCyclesSettings({}),
    reports, officialScores: scores,
  });
  assert.equal(result.status, "not_configured");
  assert.equal(result.generalAverage, null);
  assert.equal(combineProgramBulletins(calc("arabic"), calc("french")), null);
});

test("shared French/Arabic discipline cannot leak the same evaluation into both reports", () => {
  const shared = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1, enabled: true, enabledCycles: ["primary"],
      teachingTracksByCycle: { primary: ["french", "arabic"] },
      subjectTracksByCycle: {
        primary: {
          [math]: ["french", "arabic"],
          [quran]: ["arabic"],
          [french]: ["french"],
        },
      },
    },
  });
  const report = buildProgramBulletinDraft({
    studentId: "A", cycle: "primary", level: "CP1", track: "french",
    school: shared, reports, officialScores: scores,
  });
  assert.equal(report.status, "incomplete");
  assert.equal(report.generalAverage, null);
  assert.ok(report.problems.includes("shared_subject_requires_program_specific_evaluations"));
});

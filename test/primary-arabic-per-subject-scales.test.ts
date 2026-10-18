import assert from "node:assert/strict";
import test from "node:test";
import {
  validateFrancoArabicReportsInput, getConfiguredPrimarySubjectScale,
} from "../src/lib/franco-arabic-reporting";
import { buildProgramBulletinDraft } from "../src/lib/franco-arabic-bulletin-calculation";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";

const quran = "11111111-1111-4111-8111-111111111111";
const hadith = "22222222-2222-4222-8222-222222222222";
const french = "33333333-3333-4333-8333-333333333333";
const school = parseSchoolCyclesSettings({ school_cycles_v1: {
  version: 1, enabled: true, enabledCycles: ["primary"],
  teachingTracksByCycle: { primary: ["arabic", "french"] },
  subjectTracksByCycle: { primary: { [quran]: ["arabic"], [hadith]: ["arabic"], [french]: ["french"] } },
} });
function config() {
  const c = validateFrancoArabicReportsInput({
    enabled: true, format: "separate",
    scales: [
      { cycle: "primary", level: "CP1", track: "arabic", maxScore: 10 },
      { cycle: "primary", level: "CM1", track: "arabic", maxScore: 10 },
      { cycle: "primary", level: "CP1", track: "french", maxScore: 10 },
    ],
    coefficients: [],
    primarySubjectScales: [
      { cycle: "primary", level: "CP1", track: "arabic", subjectId: quran, maxScore: 20 },
      { cycle: "primary", level: "CP1", track: "arabic", subjectId: hadith, maxScore: 10 },
      { cycle: "primary", level: "CM1", track: "arabic", subjectId: quran, maxScore: 50 },
    ],
  });
  assert.ok(c);
  return c;
}
const rules = [
  { subjectId: quran, coefficient: 1, includeInAverage: true },
  { subjectId: hadith, coefficient: 1, includeInAverage: true },
];
test("un barème arabe est propre à sa matière, au niveau et à l'enseignement", () => {
  const reports = config();
  assert.equal(getConfiguredPrimarySubjectScale(reports, " CP1 ", quran), 20);
  assert.equal(getConfiguredPrimarySubjectScale(reports, "CP1", hadith), 10);
  assert.equal(getConfiguredPrimarySubjectScale(reports, "CM1", quran), 50);
  assert.equal(getConfiguredPrimarySubjectScale(reports, "CP2", quran), null);
  assert.equal(getConfiguredPrimarySubjectScale(reports, "CP1", french), null);
});
test("notes arabes sur /20 et /10 : matières conservées, moyenne bulletin /10", () => {
  const reports = config(), original = structuredClone(reports);
  const result = buildProgramBulletinDraft({
    studentId: "el1", cycle: "primary", level: "CP1", track: "arabic", school, reports,
    resolvedPolicies: rules,
    officialScores: [
      { studentId: "el1", subjectId: quran, evaluationId: "ev-q", score: 15, scale: 20, evaluationCoefficient: 1, isCurrentPublished: true, teachingTrack: "arabic" },
      { studentId: "el1", subjectId: hadith, evaluationId: "ev-h", score: 5, scale: 10, evaluationCoefficient: 1, isCurrentPublished: true, teachingTrack: "arabic" },
    ],
  });
  assert.equal(result.status, "ready");
  assert.equal(result.maximumScore, 10);
  assert.equal(result.generalAverage, 6.67);
  assert.equal(result.subjects.find(row => row.subjectId === quran)?.average, 15);
  assert.equal(result.subjects.find(row => row.subjectId === quran)?.denominator, 20);
  assert.equal(result.subjects.find(row => row.subjectId === hadith)?.average, 5);
  assert.equal(result.subjects.find(row => row.subjectId === hadith)?.denominator, 10);
  assert.deepEqual(reports, original, "calcul en lecture seule");
});
test("barème manquant interdit un bulletin prétendument complet", () => {
  const reports = { ...config(), primarySubjectScales: config().primarySubjectScales?.filter(row => row.subjectId !== hadith) };
  const result = buildProgramBulletinDraft({
    studentId: "el1", cycle: "primary", level: "CP1", track: "arabic", school, reports,
    resolvedPolicies: rules, officialScores: [
      { studentId: "el1", subjectId: quran, evaluationId: "ev-q", score: 15, scale: 20, evaluationCoefficient: 1, isCurrentPublished: true, teachingTrack: "arabic" },
    ],
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.generalAverage, null);
  assert.ok(result.problems.includes("primary_arabic_subject_scale_not_configured"));
});
test("configuration refuse doublons, barème hors bornes et matière sur le mauvais enseignement", () => {
  const good = config(), subject = good.primarySubjectScales![0];
  assert.equal(validateFrancoArabicReportsInput({ ...good, primarySubjectScales: [...good.primarySubjectScales!, subject] }), null);
  assert.equal(validateFrancoArabicReportsInput({ ...good, primarySubjectScales: [{ ...subject, maxScore: 0 }] }), null);
  assert.equal(validateFrancoArabicReportsInput({ ...good, primarySubjectScales: [{ ...subject, track: "french" }] }), null);
  assert.equal(validateFrancoArabicReportsInput({ ...good, primarySubjectScales: [{ ...subject, subjectId: "invalid" }] }), null);
});

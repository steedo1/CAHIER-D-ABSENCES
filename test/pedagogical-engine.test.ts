import assert from "node:assert/strict";
import test from "node:test";
import { resolvePedagogicalEngine, resolveProgramCoefficients, resolveEvaluationTeachingTrack } from "../src/lib/pedagogical-engine";
import { buildProgramBulletinDraft, combineProgramBulletins } from "../src/lib/franco-arabic-bulletin-calculation";

const frenchId = "11111111-1111-4111-8111-111111111111";
const arabicId = "22222222-2222-4222-8222-222222222222";
function settings() {
  return {
    school_cycles_v1: { version: 1, enabled: true, enabledCycles: ["primary"], teachingTracksByCycle: { primary: ["french", "arabic"] },
      classCycleById: {}, subjectTracksByCycle: { primary: { [frenchId]: ["french"], [arabicId]: ["arabic"] } } },
    franco_arabic_reports_v1: { version: 1, enabled: true, engine: "specialized", coefficientSource: "institution", format: "both",
      scales: [{ cycle: "primary", level: "CP1", track: "french", maxScore: 10 }, { cycle: "primary", level: "CP1", track: "arabic", maxScore: 20 }],
      coefficients: [{ cycle: "primary", level: "CP1", track: "french", subjectId: frenchId, coefficient: 99, includeInAverage: true }],
    },
  };
}
test("historical CSCA/Dieudonné/Notre Dame configurations keep the historical engine", () => {
  for (const name of ["CSCA", "Dieudonné", "Notre Dame"]) {
    const stored = { name, coefficients: { preserved: true }, bulletin_policy: "legacy" };
    const before = structuredClone(stored);
    assert.deepEqual(resolvePedagogicalEngine(stored, { id: "class", level: "6e" }), { engine: "legacy" });
    assert.deepEqual(stored, before);
  }
});
test("navigation and pre-existing templates cannot opt a school into the specialized engine", () => {
  const stored = settings();
  delete (stored.franco_arabic_reports_v1 as Partial<typeof stored.franco_arabic_reports_v1>).engine;
  assert.equal(resolvePedagogicalEngine(stored, { id: "class", level: "CP1" }).engine, "legacy");
  stored.franco_arabic_reports_v1.engine = "specialized";
  assert.equal(resolvePedagogicalEngine(stored, { id: "class", level: "CP1" }).engine, "specialized");
  assert.equal(resolvePedagogicalEngine(stored, { id: "class", level: "6e" }).engine, "legacy");
});
test("institution authority uses real level coefficients and ignores stale template weights", () => {
  const result = resolveProgramCoefficients({ cycle: "primary", level: "CP1", track: "french", settingsJson: settings(),
    activeSubjectIds: [frenchId], levelSubjectIds: [frenchId], institutionCoefficients: [
      { level: "CP1", subject_id: frenchId, coeff: 3, include_in_average: true },
      { level: "CM2", subject_id: frenchId, coeff: 7, include_in_average: true },
    ] });
  assert.deepEqual(result.problems, []);
  assert.equal(result.source, "institution");
  assert.equal(result.policies[0].coefficient, 3);
});
test("missing/ambiguous level coefficients do not silently become 1 or another level's weights", () => {
  for (const rows of [[], [{ level: "CM2", subject_id: frenchId, coeff: 8, include_in_average: true }],
    [{ level: "CP1", subject_id: frenchId, coeff: 2, include_in_average: true }, { level: "cp1", subject_id: frenchId, coeff: 4, include_in_average: true }]]) {
    const result = resolveProgramCoefficients({ cycle: "primary", level: "CP1", track: "french", settingsJson: settings(),
      activeSubjectIds: [frenchId], levelSubjectIds: [frenchId], institutionCoefficients: rows });
    assert.ok(result.problems.length);
    assert.equal(result.policies.length, 0);
  }
});
test("explicit program authority is the sole authority for its complete context", () => {
  const stored = settings(); stored.franco_arabic_reports_v1.coefficientSource = "program";
  const result = resolveProgramCoefficients({ cycle: "primary", level: "CP1", track: "french", settingsJson: stored,
    activeSubjectIds: [frenchId], levelSubjectIds: [], institutionCoefficients: [{ level: "CP1", subject_id: frenchId, coeff: 3, include_in_average: true }] });
  assert.equal(result.policies[0].coefficient, 99);
  assert.equal(result.source, "program");
  assert.deepEqual(result.problems, []);
});
test("secondary contexts preserve official series and canonical coefficient precedence", () => {
  const stored = settings();
  stored.school_cycles_v1.enabledCycles = ["secondary"];
  Object.assign(stored.school_cycles_v1.teachingTracksByCycle, { secondary: ["french"] });
  Object.assign(stored.school_cycles_v1.subjectTracksByCycle, { secondary: { [frenchId]: ["french"] } });
  stored.franco_arabic_reports_v1.scales = [{ cycle: "secondary", level: "1D", track: "french", maxScore: 20 }];
  stored.franco_arabic_reports_v1.coefficients = [];
  const result = resolveProgramCoefficients({ cycle: "secondary", level: "1D", track: "french", settingsJson: stored,
    activeSubjectIds: [frenchId], levelSubjectIds: [frenchId], institutionCoefficients: [
      { level: "1D", subject_id: frenchId, coeff: 2, include_in_average: true },
      { level: "1ereD", subject_id: frenchId, coeff: 4, include_in_average: true },
    ] });
  assert.deepEqual(result.problems, []); assert.equal(result.policies[0].coefficient, 4);
});

test("a configured catalog for another level cannot fall back to general or unrelated coefficients", () => {
  const result = resolveProgramCoefficients({ cycle: "primary", level: "CP1", track: "french", settingsJson: settings(),
    activeSubjectIds: [frenchId], levelSubjectIds: [], hasLevelCurriculumCatalog: true,
    institutionCoefficients: [{ level: "CP1", subject_id: frenchId, coeff: 3, include_in_average: true },
      { level: null, subject_id: frenchId, coeff: 4, include_in_average: true }] });
  assert.deepEqual(result.policies, []);
  assert.ok(result.problems.includes("level_curriculum_not_configured"));
});
test("an explicit zero coefficient excluded from the mean is preserved", () => {
  const result = resolveProgramCoefficients({ cycle: "primary", level: "CP1", track: "french", settingsJson: settings(),
    activeSubjectIds: [frenchId], levelSubjectIds: [], institutionCoefficients: [{ level: "CP1", subject_id: frenchId, coeff: 0, include_in_average: false }] });
  assert.deepEqual(result.problems, []);
  assert.equal(result.policies[0].coefficient, 0); assert.equal(result.policies[0].includeInAverage, false);
});
test("one student receives independent French and Arabic results and no combined average", () => {
  const stored = settings();
  const selected = resolvePedagogicalEngine(stored, { id: "class", level: "CP1" });
  assert.equal(selected.engine, "specialized");
  if (selected.engine !== "specialized") return;
  const drafts = (["french", "arabic"] as const).map(track => {
    const resolved = resolveProgramCoefficients({ cycle: "primary", level: "CP1", track, settingsJson: stored,
      activeSubjectIds: [frenchId, arabicId], levelSubjectIds: [frenchId, arabicId], institutionCoefficients: [
        { level: "CP1", subject_id: frenchId, coeff: 2, include_in_average: true },
        { level: "CP1", subject_id: arabicId, coeff: 4, include_in_average: true },
      ] });
    return buildProgramBulletinDraft({ studentId: "student", cycle: "primary", level: "CP1", track,
      school: selected.school, reports: selected.reports, resolvedPolicies: resolved.policies, configurationProblems: resolved.problems,
      officialScores: [{ studentId: "student", evaluationId: "fr", subjectId: frenchId, score: 8, scale: 10, evaluationCoefficient: 1, isCurrentPublished: true, teachingTrack: "french" },
        { studentId: "student", evaluationId: "ar", subjectId: arabicId, score: 12, scale: 20, evaluationCoefficient: 1, isCurrentPublished: true, teachingTrack: "arabic" }],
    });
  });
  assert.equal(drafts[0].generalAverage, 8); assert.equal(drafts[1].generalAverage, 12);
  assert.equal(combineProgramBulletins(drafts[0], drafts[1])?.combinedAverage, null);
});
test("shared or unclassified evaluations have no inferred program identity", () => {
  const stored = settings();
  assert.equal(resolveEvaluationTeachingTrack(stored, "primary", frenchId), "french");
  stored.school_cycles_v1.subjectTracksByCycle.primary[frenchId] = ["french", "arabic"];
  assert.equal(resolveEvaluationTeachingTrack(stored, "primary", frenchId), null);
  assert.equal(resolveEvaluationTeachingTrack(stored, "primary", "foreign"), null);
});

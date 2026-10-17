import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSchoolLevel, sameSchoolLevel } from "../src/lib/school-levels";
import { getConfiguredScoringScale, getConfiguredSubjectCoefficients, validateFrancoArabicReportsInput } from "../src/lib/franco-arabic-reporting";
import { buildPedagogicalRanks } from "../src/lib/pedagogical-ranking";
import { resolveSchoolNavigation } from "../src/lib/school-navigation";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";

test("secondary spelling variants share one level without merging significant series", () => {
  for (const [canonical, variants] of Object.entries({
    "6eme": ["6e", "6ème", "6eme", "6EME", " Sixième "], "5eme": ["5e", "5ème", "cinquième"],
    "4eme": ["4e", "4ème", "quatrième"], "3eme": ["3e", "3ème", "troisième"],
    "2ndeA": ["2A", "2de A", "Seconde A"], "2ndeC": ["2C", "2nde C"],
    "1ereD": ["1D", "1ère D", "Première D"], "1ereA1": ["1A1", "1ère A1"],
    "1ereA2": ["1A2", "Première A2"], "tleD": ["TD", "Tle D", "Terminale D"],
    "tleA1": ["TA1", "Terminale A1"], "tleA2": ["TA2", "Terminale A2"],
  })) for (const value of variants) assert.equal(normalizeSchoolLevel(value, "secondary"), canonical, value);
  for (const [left, right] of [["1ereA", "1ereA1"], ["1ereA", "1ereA2"], ["1ereA1", "1ereA2"],
    ["2ndeA", "2ndeC"], ["tleC", "tleD"], ["6eA", "6eB"], ["1D1", "1D2"]]) {
    assert.equal(sameSchoolLevel(left, right, "secondary"), false, `${left}/${right}`);
  }
});

test("primary and preschool remain distinct and physical class labels remain intact", () => {
  const levels = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"];
  assert.equal(new Set(levels.map(value => normalizeSchoolLevel(value.toLowerCase(), "primary"))).size, 6);
  assert.equal(normalizeSchoolLevel("petite section", "preschool"), "PS");
  assert.equal(normalizeSchoolLevel("grande section", "preschool"), "GS");
  for (const label of ["6eA", "6eB", "1D1", "1D2", "CP1A"]) assert.equal(normalizeSchoolLevel(label), label);
});

const subjectId = "11111111-1111-4111-8111-111111111111";
const policy = { cycle: "secondary" as const, level: "6ème", track: "french" as const, subjectId, coefficient: 2, includeInAverage: true };
test("scales and program coefficients resolve aliases and reject contradictory alias duplicates", () => {
  const input = { enabled: true, format: "both", scales: [{ cycle: "secondary", level: "6e", track: "french", maxScore: 20 }], coefficients: [policy] };
  const before = structuredClone(input), validated = validateFrancoArabicReportsInput(input);
  assert.ok(validated);
  for (const alias of ["6e", "6ème", "6eme", "6EME"]) {
    assert.equal(getConfiguredScoringScale(validated, "secondary", alias, "french"), 20);
    assert.equal(getConfiguredSubjectCoefficients(validated, "secondary", alias, "french")[0].coefficient, 2);
  }
  assert.deepEqual(input, before);
  assert.equal(validateFrancoArabicReportsInput({ ...input, scales: [...input.scales, { ...input.scales[0], level: "6EME", maxScore: 10 }] }), null);
  assert.equal(validateFrancoArabicReportsInput({ ...input, coefficients: [policy, { ...policy, level: "6eme", coefficient: 9 }] }), null);
});

test("alias-aware navigation preserves distinct class identifiers", () => {
  const settings = parseSchoolCyclesSettings({ school_cycles_v1: { version: 1, enabled: true, enabledCycles: ["secondary"], teachingTracksByCycle: { secondary: ["french"] } } });
  const classes = [{ id: "class-a", label: "6eA", level: "6e", cycle: "secondary" as const },
    { id: "class-b", label: "6eB", level: "6EME", cycle: "secondary" as const }];
  for (const row of classes) {
    const result = resolveSchoolNavigation(settings, { cycle: "secondary", level: "6ème", classId: row.id }, classes);
    assert.equal(result.level, "6eme"); assert.equal(result.classId, row.id);
  }
});

test("competition ranks handle ties and zero while excluding incomplete or invalid means", () => {
  const rows = [{ studentId: "a", average: 18, complete: true }, { studentId: "b", average: 16, complete: true },
    { studentId: "c", average: 16, complete: true }, { studentId: "d", average: 12, complete: true },
    { studentId: "zero", average: 0, complete: true }, { studentId: "missing", average: null, complete: true },
    { studentId: "incomplete", average: 20, complete: false }, { studentId: "invalid", average: NaN, complete: true }];
  const before = structuredClone(rows);
  assert.deepEqual([...buildPedagogicalRanks(rows)], [["a", 1], ["b", 2], ["c", 2], ["d", 4], ["zero", 5]]);
  assert.deepEqual(rows, before);
  const large = Array.from({ length: 20000 }, (_, index) => ({ studentId: String(index), average: index % 20, complete: true }));
  assert.equal(buildPedagogicalRanks(large).get("0"), 19001);
});

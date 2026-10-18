import assert from "node:assert/strict";
import test from "node:test";
import {
  FRANCO_ARABIC_REPORTS_SETTINGS_KEY,
  validateFrancoArabicReportsInput,
  readFrancoArabicReportsForEditing,
  getConfiguredPrimarySubjectScale,
} from "../src/lib/franco-arabic-reporting";

const quran = "11111111-1111-4111-8111-111111111111";
const hadith = "22222222-2222-4222-8222-222222222222";
const french = "33333333-3333-4333-8333-333333333333";

function report() {
  const config = validateFrancoArabicReportsInput({
    version: 1, enabled: true, format: "separate",
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
  assert.ok(config);
  return config;
}

test("barèmes arabes : matière et niveau restent indépendants", () => {
  const settings = report();
  assert.equal(getConfiguredPrimarySubjectScale(settings, " CP1 ", quran), 20);
  assert.equal(getConfiguredPrimarySubjectScale(settings, "CP1", hadith), 10);
  assert.equal(getConfiguredPrimarySubjectScale(settings, "CM1", quran), 50);
  assert.equal(getConfiguredPrimarySubjectScale(settings, "CP2", quran), null);
  assert.equal(getConfiguredPrimarySubjectScale(settings, "CP1", french), null);
});

test("sauvegarde puis relecture : barèmes retrouvés après un aller-retour JSON", () => {
  const settings = report();
  const stored = JSON.parse(JSON.stringify({
    other_school_setting: { untouched: true },
    [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: settings,
  }));
  const reopened = readFrancoArabicReportsForEditing(stored);
  assert.equal(reopened.primarySubjectScales?.length, 3);
  assert.equal(getConfiguredPrimarySubjectScale(reopened, "CP1", quran), 20);
  assert.equal(getConfiguredPrimarySubjectScale(reopened, "CP1", hadith), 10);
  assert.equal(getConfiguredPrimarySubjectScale(reopened, "CM1", quran), 50);
  assert.deepEqual(stored.other_school_setting, { untouched: true });
});

test("modification d'un seul niveau : les autres restent inchangés", () => {
  const before = report();
  const updated = validateFrancoArabicReportsInput({
    ...before,
    primarySubjectScales: before.primarySubjectScales?.map(row =>
      row.level === "CP1" && row.subjectId === quran ? { ...row, maxScore: 30 } : row),
  });
  assert.ok(updated);
  assert.equal(getConfiguredPrimarySubjectScale(updated, "CP1", quran), 30);
  assert.equal(getConfiguredPrimarySubjectScale(updated, "CP1", hadith), 10);
  assert.equal(getConfiguredPrimarySubjectScale(updated, "CM1", quran), 50);
});

test("refuser les doublons, mauvaises matières et barèmes hors bornes", () => {
  const config = report();
  const first = config.primarySubjectScales![0];
  assert.equal(validateFrancoArabicReportsInput({
    ...config, primarySubjectScales: [...config.primarySubjectScales!, first],
  }), null);
  for (const maxScore of [0, -1, 101, 2.5]) {
    assert.equal(validateFrancoArabicReportsInput({
      ...config, primarySubjectScales: [{ ...first, maxScore }],
    }), null);
  }
  assert.equal(validateFrancoArabicReportsInput({
    ...config, primarySubjectScales: [{ ...first, track: "french" }],
  }), null);
  assert.equal(validateFrancoArabicReportsInput({
    ...config, primarySubjectScales: [{ ...first, subjectId: "invalid" }],
  }), null);
});

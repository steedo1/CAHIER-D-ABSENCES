import { primarySubjectScale } from "../src/lib/grades/primary-subject-scale";
import { EPC_PRIMARY_ARABIC_SUBJECT_COUNT, primaryArabicSubjectLabel } from "../src/lib/primary-arabic-bulletin-labels";
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
  // French primary school overrides are now supported, without affecting Arabic.
  const bilingual = validateFrancoArabicReportsInput({
    ...config, primarySubjectScales: [...config.primarySubjectScales!, { ...first, track: "french" }],
  });
  assert.ok(bilingual);
  assert.equal(getConfiguredPrimarySubjectScale(bilingual, "CP1", first.subjectId, "french"), first.maxScore);
  assert.equal(getConfiguredPrimarySubjectScale(bilingual, "CP1", first.subjectId, "arabic"), first.maxScore);
  assert.equal(validateFrancoArabicReportsInput({
    ...config, primarySubjectScales: [{ ...first, track: "spanish" }],
  }), null);
  assert.equal(validateFrancoArabicReportsInput({
    ...config, primarySubjectScales: [{ ...first, subjectId: "invalid" }],
  }), null);
});

test("une matière arabe sans exception conserve /10 au lieu de devenir indisponible", () => {
  const settings = { [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: { ...report(), primaryArabicDefaultScale: true } };
  const common = { year: "2026-2027", classId: "44444444-4444-4444-8444-444444444444",
    level: "CP1", track: "arabic" as const, subjectName: "Matière arabe" };
  assert.equal(primarySubjectScale(settings, { ...common, subjectId: quran }), 20);
  assert.equal(primarySubjectScale(settings, { ...common, subjectId: hadith }), 10);
  assert.equal(primarySubjectScale(settings, { ...common, subjectId: french }), 10);
  assert.equal(primarySubjectScale(settings, { ...common, level: "CM1", subjectId: french }), 10);
  assert.equal(primarySubjectScale(settings, { ...common, level: "CE1", subjectId: french }), null);
});

test("25 matières EPC ont un intitulé arabe sans modifier les noms enregistrés", () => {
  const names = [
    "Apprentissage des lettres", "Lecture", "Écriture et dictée", "Expression orale",
    "Grammaire arabe", "Conjugaison arabe", "Poème", "Coran (poème) et écriture",
    "Coran (règles de jurisprudence) et écriture",
    "Coran (révision des poèmes mémorisés) et écriture", "Coran", "Psalmodie du Coran",
    "Traduction du Coran", "Hadith (tradition prophétique)",
    "Jurisprudence et croyance (Al-Muslim As-Saghîr)", "Leçons élémentaires",
    "Biographie du Prophète (SAW)", "Jurisprudence islamique (Fiqh)",
    "Unicité divine (Tawhîd)", "Mathématiques", "Chant", "Dessin", "Écriture", "Chants et dessin", "Dessin et chants",
  ];
  assert.equal(EPC_PRIMARY_ARABIC_SUBJECT_COUNT, 25);
  for (const name of names) {
    assert.ok(primaryArabicSubjectLabel(name), name);
    assert.equal(name, name.normalize("NFKC"));
  }
  assert.equal(primaryArabicSubjectLabel("Matière inconnue"), null);
});

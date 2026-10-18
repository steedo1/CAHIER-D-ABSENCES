import assert from "node:assert/strict";
import test from "node:test";
import {
  CI_PRIMARY_FRENCH_REFERENCE, ciPrimaryFrenchBulletinRows, ciPrimaryFrenchDenominator,
  ciPrimaryFrenchEntryForName, planCiPrimaryFrenchReference,
} from "../src/lib/primary-french-reference-ci";
import { hasCiPrimaryFrenchReference, readClassSubjects } from "../src/lib/school-class-subjects";
import { buildProgramBulletinDraft } from "../src/lib/franco-arabic-bulletin-calculation";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";
import { parseFrancoArabicReportsSettings } from "../src/lib/franco-arabic-reporting";

const sid = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
const subject = (i: number, name: string) => ({ id: sid(i), name });
const classId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("the CP1 bulletin reference contains exactly the eleven user-provided subjects", () => {
  assert.deepEqual(CI_PRIMARY_FRENCH_REFERENCE.map(row => row.label), [
    "Lecture", "Écriture / Copie", "Orthographe / Dictée", "Expression écrite",
    "Exploitation de texte", "Éveil au milieu", "Mathématiques",
    "Chant / Poème", "Dessin", "EDHC", "EPS",
  ]);
  assert.equal(ciPrimaryFrenchEntryForName("Écriture")?.code, "ecriture_copie");
  assert.equal(ciPrimaryFrenchEntryForName("maths")?.code, "mathematiques");
  assert.equal(ciPrimaryFrenchEntryForName("Mathématiques avancées"), null);
});

test("preview reuses existing active subjects and keeps institution extras and old selections", () => {
  const catalog = [
    subject(1, "Lecture"), subject(2, "Ecriture"), subject(3, "Dictée"),
    subject(4, "Mathématiques"), subject(5, "EPS"), subject(6, "Informatique"),
  ];
  const plan = planCiPrimaryFrenchReference("CP1", catalog, [sid(6), sid(1)]);
  assert.equal(plan.matches.length, 5);
  assert.equal(plan.missing.length, 6);
  assert.deepEqual(plan.existingExtras, [sid(6)]);
  assert.deepEqual(plan.proposedSubjectIds, [sid(6), sid(1), sid(2), sid(3), sid(4), sid(5)]);
  assert.deepEqual(plan.newlyAssociated, [sid(2), sid(3), sid(4), sid(5)]);
  assert.deepEqual(catalog, [
    subject(1, "Lecture"), subject(2, "Ecriture"), subject(3, "Dictée"),
    subject(4, "Mathématiques"), subject(5, "EPS"), subject(6, "Informatique"),
  ], "preview must not mutate the school catalogue");
});

test("ambiguous aliases fail closed rather than silently choosing the wrong subject", () => {
  const plan = planCiPrimaryFrenchReference("CE2",
    [subject(1, "Orthographe"), subject(2, "Dictée")], [sid(1)]);
  assert.ok(plan.ambiguous.some(row => row.label === "Orthographe / Dictée"));
  assert.ok(!plan.proposedSubjectIds.includes(sid(2)));
  assert.throws(() => planCiPrimaryFrenchReference("Sixième", [], []), /ci_primary_invalid_level/);
});

test("CI elementary denominators are per subject, never coefficients", () => {
  for (const level of ["CP1", "CP2", "CE1", "CE2"]) {
    for (const row of CI_PRIMARY_FRENCH_REFERENCE) {
      assert.equal(ciPrimaryFrenchDenominator(level, row.code), 10);
    }
  }
  for (const level of ["CM1", "CM2"]) {
    assert.equal(ciPrimaryFrenchDenominator(level, "orthographe_dictee"), 20);
    for (const code of ["exploitation_texte", "eveil_milieu", "mathematiques"] as const)
      assert.equal(ciPrimaryFrenchDenominator(level, code), 50);
    assert.equal(ciPrimaryFrenchDenominator(level, "lecture"), 10);
    assert.equal(ciPrimaryFrenchDenominator(level, "eps"), 10);
  }
});

test("only school classes explicitly marked in the existing curriculum use CI", () => {
  const data = { school_class_subjects_v1: { version: 1, years: {
    "2026-2027": { classes: { [classId]: [sid(1)] }, ciPrimaryFrenchClasses: [classId] },
  } } };
  assert.equal(hasCiPrimaryFrenchReference(data, "2026-2027", classId), true);
  assert.equal(hasCiPrimaryFrenchReference(data, "2027-2028", classId), false);
  assert.equal(hasCiPrimaryFrenchReference(data, "2026-2027", sid(2)), false);
  assert.equal(hasCiPrimaryFrenchReference({}, "2026-2027", classId), false);
  assert.deepEqual(readClassSubjects(data)?.years["2026-2027"].classes[classId], [sid(1)]);
});

test("CI bulletin shows all 11 lines in order, without inventing scores, plus other real school subjects", () => {
  const rows = ciPrimaryFrenchBulletinRows("CP1", [
    { id: sid(1), name: "Lecture", average: 8, coefficient: null },
    { id: sid(2), name: "Maths", average: 7, coefficient: null },
    { id: sid(3), name: "Informatique", average: 6, coefficient: null },
  ]);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.slice(0, 11).map(row => row.name), CI_PRIMARY_FRENCH_REFERENCE.map(row => row.label));
  assert.equal(rows[1].average, null);
  assert.equal(rows[11].name, "Informatique");
  assert.equal(rows[0].denominator, 10);
});

test("applied primary CI computes total points over actual barèmes and ignores blank subjects", () => {
  const math = sid(1), lecture = sid(2), eps = sid(3);
  const school = parseSchoolCyclesSettings({ school_cycles_v1: {
    version: 1, enabled: true, enabledCycles: ["primary"],
    teachingTracksByCycle: { primary: ["french"] },
    subjectTracksByCycle: { primary: { [math]: ["french"], [lecture]: ["french"], [eps]: ["french"] } },
  } });
  const reports = parseFrancoArabicReportsSettings({ franco_arabic_reports_v1: {
    version: 1, enabled: true, format: "separate", scales: [
      { cycle: "primary", track: "french", level: "CM1", maxScore: 10 },
    ], coefficients: [],
  } });
  const args = {
    studentId: "A", cycle: "primary" as const, level: "CM1", track: "french" as const,
    school, reports, resolvedPolicies: [
      { subjectId: math, coefficient: 1, includeInAverage: true },
      { subjectId: lecture, coefficient: 1, includeInAverage: true },
      { subjectId: eps, coefficient: 1, includeInAverage: true },
    ],
    officialScores: [
      { studentId: "A", subjectId: math, evaluationId: "math", score: 25,
        scale: 50, evaluationCoefficient: 1, isCurrentPublished: true },
      { studentId: "A", subjectId: lecture, evaluationId: "lecture", score: 10,
        scale: 10, evaluationCoefficient: 1, isCurrentPublished: true },
    ],
  };
  const ordinary = buildProgramBulletinDraft(args);
  assert.equal(ordinary.status, "incomplete", "legacy logic remains unchanged");
  const ci = buildProgramBulletinDraft({ ...args,
    primaryCiDenominators: { [math]: 50, [lecture]: 10, [eps]: 10 },
  });
  assert.equal(ci.status, "ready");
  assert.equal(ci.generalAverage, 5.83, "35 points / 60 possible * 10, not the average of 5/10 and 10/10");
  assert.equal(ci.subjects.find(x => x.subjectId === math)?.denominator, 50);
  assert.equal(ci.subjects.find(x => x.subjectId === math)?.average, 25);
  assert.equal(ci.subjects.find(x => x.subjectId === eps)?.average, null);
});

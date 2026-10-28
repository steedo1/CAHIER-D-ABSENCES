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
  for (const row of CI_PRIMARY_FRENCH_REFERENCE) {
    assert.equal(ciPrimaryFrenchDenominator("CP1", row.code), 10);
    assert.equal(ciPrimaryFrenchDenominator("CP2", row.code), row.code === "mathematiques" ? 20 : 10);
    for (const level of ["CE1", "CE2"]) {
      assert.equal(ciPrimaryFrenchDenominator(level, row.code),
        ["exploitation_texte", "eveil_milieu", "mathematiques"].includes(row.code) ? 30 : 10);
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

test("primary CI bulletin omits blank subjects but preserves graded ones in official order", () => {
  const rows = ciPrimaryFrenchBulletinRows("CP1", [
    { id: sid(1), name: "Lecture", average: 8, coefficient: null },
    { id: sid(2), name: "Maths", average: 7, coefficient: null },
    { id: sid(3), name: "Informatique", average: 6, coefficient: null },
    { id: sid(4), name: "Éveil au milieu", average: null, coefficient: null },
    { id: sid(5), name: "EPS", average: 0, coefficient: null },
  ]);
  assert.deepEqual(rows.map(row => row.name),
    ["Lecture", "Mathématiques", "EPS", "Informatique"]);
  assert.deepEqual(rows.map(row => row.average), [8, 7, 0, 6],
    "a real zero must remain a graded subject, while null is not a score");
  assert.deepEqual(rows.map(row => row.denominator), [10, 10, 10, undefined]);
  assert.deepEqual(ciPrimaryFrenchBulletinRows("CP1", [
    { id: sid(1), name: "Lecture", average: null, coefficient: null },
  ]), []);
});

test("CP bulletin with 7 actual marks prints 7/11 disciplines and preserves 56/70 = 8/10", () => {
  const catalog = CI_PRIMARY_FRENCH_REFERENCE.map((entry, index) => ({
    ...subject(index + 1, entry.label), code: entry.code,
  }));
  const marks: Record<string, number> = {
    lecture: 8, ecriture_copie: 10, orthographe_dictee: 10,
    expression_ecrite: 10, mathematiques: 8,
    chant_poeme: 5, dessin: 5,
  };
  const school = parseSchoolCyclesSettings({ school_cycles_v1: {
    version: 1, enabled: true, enabledCycles: ["primary"],
    teachingTracksByCycle: { primary: ["french"] },
    subjectTracksByCycle: { primary: Object.fromEntries(catalog.map(row => [row.id, ["french"]])) },
  } });
  const reports = parseFrancoArabicReportsSettings({ franco_arabic_reports_v1: {
    version: 1, enabled: true, format: "separate",
    scales: [{ cycle: "primary", track: "french", level: "CP1", maxScore: 10 }],
    coefficients: [],
  } });
  const draft = buildProgramBulletinDraft({
    studentId: "A", cycle: "primary", level: "CP1", track: "french",
    school, reports,
    resolvedPolicies: catalog.map(row => ({
      subjectId: row.id, coefficient: 1, includeInAverage: true,
    })),
    officialScores: catalog.filter(row => Object.hasOwn(marks, row.code)).map(row => ({
      studentId: "A", subjectId: row.id, evaluationId: row.code,
      score: marks[row.code], scale: 10, evaluationCoefficient: 1,
      isCurrentPublished: true,
    })),
    primaryCiDenominators: Object.fromEntries(catalog.map(row => [row.id, 10])),
  });
  const rows = ciPrimaryFrenchBulletinRows("CP1", draft.subjects.map(row => ({
    id: row.subjectId, name: catalog.find(item => item.id === row.subjectId)!.name,
    average: row.average, coefficient: row.coefficient,
  })));
  assert.equal(rows.length, 7);
  assert.equal(rows.reduce((sum, row) => sum + row.average!, 0), 56);
  assert.equal(rows.reduce((sum, row) => sum + row.denominator!, 0), 70);
  assert.equal(draft.generalAverage, 8);
  assert.equal(draft.status, "ready");
  assert.equal(draft.subjects.length, 11, "all configured subjects remain in calculations and teacher's catalogue");
  assert.equal(draft.subjects.filter(row => row.average === null).length, 4);
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


test("CE1/CE2: manual /30 replaces default and contributes its actual points to the /10 bulletin", () => {
  const math = sid(1), lecture = sid(2);
  const school = parseSchoolCyclesSettings({ school_cycles_v1: {
    version: 1, enabled: true, enabledCycles: ["primary"],
    teachingTracksByCycle: { primary: ["french"] },
    subjectTracksByCycle: { primary: { [math]: ["french"], [lecture]: ["french"] } },
  } });
  const reports = parseFrancoArabicReportsSettings({ franco_arabic_reports_v1: {
    version: 1, enabled: true, format: "separate",
    scales: [{ cycle: "primary", track: "french", level: "CE2", maxScore: 10 }],
    coefficients: [],
  } });
  const result = buildProgramBulletinDraft({
    studentId: "A", cycle: "primary", level: "CE2", track: "french",
    school, reports,
    resolvedPolicies: [{ subjectId: math, coefficient: 1, includeInAverage: true },
      { subjectId: lecture, coefficient: 1, includeInAverage: true }],
    officialScores: [
      { studentId: "A", subjectId: math, evaluationId: "math", score: 24,
        scale: 30, evaluationCoefficient: 1, isCurrentPublished: true },
      { studentId: "A", subjectId: lecture, evaluationId: "lecture", score: 8,
        scale: 10, evaluationCoefficient: 1, isCurrentPublished: true },
    ],
    primaryCiDenominators: { [math]: 20, [lecture]: 10 },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.generalAverage, 8);
  assert.equal(result.subjects.find(s => s.subjectId === math)?.denominator, 30);
  assert.equal(result.subjects.find(s => s.subjectId === math)?.average, 24);
});

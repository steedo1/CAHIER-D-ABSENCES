import test from "node:test";
import assert from "node:assert/strict";
import { frenchComponentContribution, frenchComponentPoints } from "../src/lib/grades/french-component-points";
import { computeSubjectAppreciation } from "../src/lib/grades/subject-appreciation";
import { calculateBulletinVisibleTotals } from "../src/lib/grades/bulletin-visible-totals";

const comps = [
  { id: "composition", subject_id: "fr", coeff_in_subject: 1 },
  { id: "oral", subject_id: "fr", coeff_in_subject: 1 },
  { id: "orthographe", subject_id: "fr", coeff_in_subject: 1 },
];
const filled = [
  { subject_id: "fr", component_id: "composition", avg20: 14 },
  { subject_id: "fr", component_id: "oral", avg20: 7 },
  { subject_id: "fr", component_id: "orthographe", avg20: 7 },
];
type Grades = { subject_id: string; component_id: string; avg20: number | null }[];
const input = (grades: Grades = filled, other: Record<string, unknown> = {}) => ({
  subjectName: "Français", subjectId: "fr", officialCoeff: 3,
  components: comps, grades, ...other,
});

test("5e1: 14+7+7 => 28 points et coefficient 3, sans double compter le parent", () => {
  assert.deepEqual(frenchComponentContribution(input()), {
    coefficient: 3, points: 28, rawAverage: 28 / 3, average: 28 / 3,
  });
  assert.equal(frenchComponentPoints(input()), 28);
  assert.equal((150 + 28 + 15) / 16, 12.0625);
});

test("Une sous-matière NC : on compte 14+7=21 avec coefficient 2, pas 3", () => {
  const grades = filled.map((grade, index) => index === 2 ? { ...grade, avg20: null } : grade);
  const result = frenchComponentContribution(input(grades));
  assert.equal(result?.points, 21);
  assert.equal(result?.coefficient, 2);
  assert.equal(result?.average, 10.5);
  assert.equal(frenchComponentPoints(input(grades)), 21);
  assert.equal((150 + 21 + 15) / 15, 12.4);
  // Une ligne tout simplement absente de l'API est aussi NC.
  assert.equal(frenchComponentContribution(input(filled.slice(0, 2)))?.coefficient, 2);
});

test("Toutes les sous-matières NC => français NC, coefficient 0, pas de repli sur le parent", () => {
  const grades = filled.map(grade => ({ ...grade, avg20: null }));
  assert.deepEqual(frenchComponentContribution(input(grades)), {
    coefficient: 0, points: 0, rawAverage: null, average: null,
  });
  assert.equal(frenchComponentPoints(input(grades)), null);
});

test("0/20 est une vraie note et garde son coefficient", () => {
  const grades = filled.map((grade, index) => index === 2 ? { ...grade, avg20: 0 } : grade);
  const result = frenchComponentContribution(input(grades));
  assert.equal(result?.coefficient, 3);
  assert.equal(result?.points, 21);
});

test("Chaque sous-matière est autonome même si les coefficients sont différents", () => {
  const weighted = comps.map((comp, index) => ({ ...comp, coeff_in_subject: index === 0 ? 2 : 1 }));
  const result = frenchComponentContribution(input(filled, { components: weighted }));
  assert.equal(result?.points, 42);
  assert.equal(result?.coefficient, 4);
  assert.equal(result?.average, 10.5);
  const partial = frenchComponentContribution(input(filled.slice(1), { components: weighted }));
  assert.equal(partial?.points, 14);
  assert.equal(partial?.coefficient, 2);
});

test("Les autres matières et le français non détaillé gardent leur calcul actuel", () => {
  assert.equal(frenchComponentContribution(input(filled, { subjectName: "Mathématiques" })), null);
  assert.equal(frenchComponentContribution(input(filled, { components: [] })), null);
});

test("Le bonus matière n'est pas doublé sur les saisies directes", () => {
  assert.equal(frenchComponentContribution(input(filled, { averageSource: "direct", bonus: 2 }))?.points, 28);
  assert.equal(frenchComponentContribution(input(filled, { averageSource: null, bonus: 2 }))?.points, 34);
});

test("Chaque sous-matière a la même appréciation officielle qu'une matière", () => {
  assert.equal(computeSubjectAppreciation(14), "Bien");
  assert.equal(computeSubjectAppreciation(7), "Faible");
  assert.equal(computeSubjectAppreciation(0), "Blâme");
  assert.equal(computeSubjectAppreciation(null), ""); // NC => affichage « Non classé » dans le bulletin
});

test("Bulletin 5e1 : 193 points et coefficient 16 malgré EPS NC", () => {
  const rows = [
    { subjectId: "anglais", average: 13, coefficient: 2, points: 26, includeInAverage: true },
    { subjectId: "francais", average: 28 / 3, coefficient: 3, points: 28, includeInAverage: true },
    { subjectId: "histoire", average: 12, coefficient: 2, points: 24, includeInAverage: true },
    { subjectId: "maths", average: 12, coefficient: 3, points: 36, includeInAverage: true },
    { subjectId: "physique", average: 12, coefficient: 2, points: 24, includeInAverage: true },
    { subjectId: "svt", average: 12, coefficient: 2, points: 24, includeInAverage: true },
    { subjectId: "edhc", average: 16, coefficient: 1, points: 16, includeInAverage: true },
    { subjectId: "eps", average: null, coefficient: 1, points: null, includeInAverage: true },
    { subjectId: "conduite", average: 15, coefficient: 1, points: 15, includeInAverage: true },
    { subjectId: "conduite", average: 15, coefficient: 1, points: 15, includeInAverage: true },
  ];
  assert.deepEqual(calculateBulletinVisibleTotals(rows), { coefficient: 16, points: 193 });
});

test("Les sous-matières NC et les vraies notes de zéro sont distinguées", () => {
  const rows = [
    { subjectId: "francais", average: 10.5, coefficient: 2, points: 21, includeInAverage: true },
    { subjectId: "eps", average: null, coefficient: 1, points: null, includeInAverage: true },
    { subjectId: "test-zero", average: 0, coefficient: 1, points: 0, includeInAverage: true },
    { subjectId: "matiere-exclue", average: 18, coefficient: 2, points: 36, includeInAverage: false },
  ];
  assert.deepEqual(calculateBulletinVisibleTotals(rows), { coefficient: 3, points: 21 });
  assert.deepEqual(calculateBulletinVisibleTotals(rows.map(r => ({ ...r, average: null }))), { coefficient: 0, points: null });
});

test("Appréciations automatiques : les moyennes numériques et JSON restent visibles", () => {
  assert.equal(computeSubjectAppreciation(14), "Bien");
  assert.equal(computeSubjectAppreciation("14.00"), "Bien");
  assert.equal(computeSubjectAppreciation("7.00"), "Faible");
  assert.equal(computeSubjectAppreciation("0.00"), "Blâme");
  assert.equal(computeSubjectAppreciation(null), "");
  assert.equal(computeSubjectAppreciation("NC"), "");
});

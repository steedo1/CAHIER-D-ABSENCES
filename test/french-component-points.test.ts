import test from "node:test";
import assert from "node:assert/strict";
import { frenchComponentPoints } from "../src/lib/grades/french-component-points";

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
const run = (grades = filled, other: Record<string, unknown> = {}) =>
  frenchComponentPoints({
    subjectName: "Français",
    subjectId: "fr",
    officialCoeff: 3,
    components: comps,
    grades,
    ...other,
  });

test("5e1: 14+7+7 contribue 28 points, pas 27,99 ni 55,99", () => {
  assert.equal(run(), 28);
  assert.equal((150 + run()! + 15) / 16, 12.0625);
});
test("NC: aucune sous-matière absente ne devient zéro", () => {
  assert.equal(run(filled.slice(0, 2)), null);
  assert.equal(run(filled.map((x, i) => i === 2 ? { ...x, avg20: null } : x)), null);
});
test("Une vraie note de 0/20 reste valide", () => {
  assert.equal(run(filled.map(x => ({ ...x, avg20: 0 }))), 0);
});
test("Ne pas modifier les autres matières", () => {
  assert.equal(run(filled, { subjectName: "Mathématiques" }), null);
});
test("Pondération interne et coefficient officiel de français restent séparés", () => {
  const weighted = comps.map((x, i) => ({ ...x, coeff_in_subject: i === 0 ? 2 : 1 }));
  assert.equal(run(filled, { components: weighted, officialCoeff: 3 }), 31.5);
});
test("Le bonus pédagogique n'est pas appliqué deux fois aux notes directes", () => {
  assert.equal(run(filled, { averageSource: "direct", bonus: 2 }), 28);
  assert.equal(run(filled, { averageSource: null, bonus: 2 }), 34);
});

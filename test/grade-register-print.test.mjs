import test from "node:test";
import assert from "node:assert/strict";
import { buildGradeRegisterPrintHtml } from "../src/lib/grades/grade-register-print.ts";

const example = {
  institutionName: "École EPC & Fils",
  academicYear: "2026-2027",
  className: "CP2 arabe",
  subjectName: "العربية",
  teachingName: "Enseignement arabe",
  students: [
    { id: "b", full_name: "Zara Test", matricule: "EPC260002" },
    { id: "a", full_name: "Aïcha Test", matricule: "EPC260001" },
  ],
  evaluations: [
    { id: "ev1", label: "Devoir 1", scale: 10, eval_date: "2026-11-03", coeff: null },
    { id: "ev2", label: "Composition", scale: 20, eval_date: "2026-11-04", coeff: null },
  ],
  grades: {
    ev1: { a: 0, b: 7.5 },
    ev2: { a: 18 },
  },
};

test("export sur A4 paysage avec établissement, matière et colonnes notées", () => {
  const html = buildGradeRegisterPrintHtml(example);
  assert.match(html, /@page\{size:A4 landscape/);
  assert.match(html, /École EPC &amp; Fils/);
  assert.match(html, /CP2 arabe/);
  assert.match(html, /العربية/);
  assert.match(html, /Devoir 1/);
  assert.match(html, /\/10/);
  assert.match(html, /\/20/);
  assert.match(html, /03\/11\/2026/);
  assert.ok(html.indexOf("Aïcha Test") < html.indexOf("Zara Test"), "ordre alphabétique");
  assert.match(html, /<td class="score">0<\/td>/, "zéro reste une note");
  assert.match(html, /<td class="score">7,5<\/td>/);
  assert.match(html, /<td class="score">—<\/td>/, "note absente ≠ zéro");
});

test("plus de quatre évaluations : plusieurs tableaux avec noms répétés", () => {
  const html = buildGradeRegisterPrintHtml({
    ...example,
    evaluations: Array.from({ length: 9 }, (_, i) => ({
      id: "ev" + (i + 1),
      label: "Devoir " + (i + 1),
      scale: 10,
    })),
  });
  assert.equal((html.match(/<section class="sheet">/g) || []).length, 3);
  assert.equal((html.match(/Aïcha Test/g) || []).length, 3);
  assert.equal((html.match(/Nom et prénoms/g) || []).length, 3);
  assert.match(html, /Évaluations 9 à 9 sur 9/);
});

test("ne jamais interpréter les noms et titres comme du HTML", () => {
  const html = buildGradeRegisterPrintHtml({
    ...example,
    institutionName: '<script>alert("x")</script>',
    students: [{ id: "a", full_name: "<img src=x>", matricule: "TEST" }],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test("un registre sans matricules ne crée pas de colonne matricule inutile", () => {
  const html = buildGradeRegisterPrintHtml({
    ...example,
    students: [{ id: "a", full_name: "Élève", matricule: null }],
  });
  assert.doesNotMatch(html, /<th>Matricule<\/th>/);
});

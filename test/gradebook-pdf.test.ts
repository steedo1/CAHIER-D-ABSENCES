import assert from "node:assert/strict";
import test from "node:test";
import { buildGradebookPdfHtml, type GradebookPdfData } from "../src/lib/grades/gradebook-pdf";

const input: GradebookPdfData = {
  institution: "EPC Dimbokro",
  academicYear: "2026–2027",
  classLabel: "CP2 Arabe",
  subjectLabel: "العربية",
  teachingLabel: "Enseignement arabe",
  periodLabel: null,
  students: [
    { id: "b", full_name: "Zara Traoré", matricule: "EPC260002" },
    { id: "a", full_name: "Awa Koné", matricule: "EPC260001" },
  ],
  evaluations: [
    { id: "e1", label: "COMPOSITION 1", eval_date: "2026-12-10", scale: 10, component_label: "القراءة" },
    { id: "e2", label: "DEVOIR 1", eval_date: "2026-11-06", scale: 20 },
  ],
  grades: {
    e1: { a: 0, b: 8.5 },
    e2: { b: 17 },
  },
};

test("tableau alphabétique, barèmes, notes zéro et notes absentes", () => {
  const html = buildGradebookPdfHtml(input);
  assert.ok(html.indexOf("Awa Koné") < html.indexOf("Zara Traoré"));
  assert.match(html, /COMPOSITION 1/);
  assert.match(html, /10\/12\/2026/);
  assert.match(html, /<td class="grade">0<\/td>/);
  assert.match(html, /<td class="grade">8,5<\/td>/);
  assert.match(html, /<td class="grade">—<\/td>/);
  assert.match(html, /Enseignement arabe/);
  assert.match(html, /dir="auto">القراءة/);
  assert.match(html, /@page \{ size: A4 landscape/);
  assert.match(html, /thead \{ display: table-header-group/);
});

test("répartit quatre colonnes de notes au maximum par série imprimée", () => {
  const many: GradebookPdfData = {
    ...input,
    evaluations: Array.from({ length: 9 }, (_, i) => ({
      id: "ev" + i,
      label: "DEVOIR " + (i + 1),
      eval_date: "2026-11-03",
      scale: 20,
    })),
    grades: {},
  };
  const html = buildGradebookPdfHtml(many);
  assert.equal((html.match(/<section class="sheet">/g) || []).length, 3);
  assert.match(html, /Évaluations 1 à 4 sur 9/);
  assert.match(html, /Évaluations 5 à 8 sur 9/);
  assert.match(html, /Évaluations 9 à 9 sur 9/);
  assert.equal((html.match(/<th class="grade-head">/g) || []).length, 9);
});

test("échappe les noms, matières et établissements pour prévenir l'injection HTML", () => {
  const html = buildGradebookPdfHtml({
    ...input,
    institution: '<script>alert("x")</script>',
    students: [{ id: "test", full_name: "Élève <img src=x>", matricule: "N&1" }],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /N&amp;1/);
});

test("rend une liste lisible même sans évaluation", () => {
  const html = buildGradebookPdfHtml({ ...input, evaluations: [], grades: {} });
  assert.match(html, /Aucune évaluation enregistrée/);
  assert.match(html, /Awa Koné/);
});

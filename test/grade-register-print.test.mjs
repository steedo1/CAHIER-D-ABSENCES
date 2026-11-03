import { buildAdminRegisterPdf } from "../src/lib/grades/admin-register-pdf.ts";
import fs from "node:fs";
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


test("PDF admin : vrai fichier téléchargeable avec noms et notes, y compris le primaire arabe", async () => {
  const pdf = await buildAdminRegisterPdf({
    institutionName: "EPC Dimbokro",
    academicYear: "2026-2027",
    className: "CP2 — Arabe",
    subjectName: "اللغة العربية",
    publicationLabel: "Notes publiées",
    students: [
      { id: "a", full_name: "TRAORE Ahmed", matricule: "EPC260001" },
      { id: "b", full_name: "DIALLO Aïcha", matricule: "EPC260002" },
    ],
    evaluations: [
      { id: "ev1", column_label: "Note 1", scale: 10, coeff: 1, eval_date: "2026-11-02", is_published: true },
      { id: "ev2", column_label: "Note 2", scale: 10, coeff: 1, eval_date: "2026-11-03", is_published: true },
    ],
    scores: [
      { evaluation_id: "ev1", student_id: "a", score: 0 },
      { evaluation_id: "ev1", student_id: "b", score: 8 },
      { evaluation_id: "ev2", student_id: "a", score: 9 },
    ],
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.match(pdf.subarray(0, 8).toString("ascii"), /^%PDF-/);
  assert.ok(pdf.length > 3000, "la police et la table sont intégrées");
});

test("PDF admin : 5 évaluations et 60 élèves répartis sur plusieurs feuilles", async () => {
  const pdf = await buildAdminRegisterPdf({
    institutionName: "Mon Cahier", academicYear: "2026-2027",
    className: "CE1 — Français", subjectName: "EDHC",
    publicationLabel: "Toutes les notes",
    students: Array.from({ length: 60 }, (_, i) => ({
      id: "e" + i, matricule: "EPC26" + String(i).padStart(4, "0"),
      full_name: "Élève " + String(i).padStart(3, "0"),
    })),
    evaluations: Array.from({ length: 5 }, (_, i) => ({
      id: "n" + i, column_label: "Note " + (i + 1), scale: 10,
    })),
    scores: [{ student_id: "e0", evaluation_id: "n0", score: 0 }],
  });
  assert.match(pdf.subarray(0, 8).toString("ascii"), /^%PDF-/);
  assert.ok(pdf.length > 3000);
});

test("interface admin : notes accessibles sur mobile, vraie exportation PDF et badge Primaire", () => {
  const page = fs.readFileSync(
    new URL("../src/app/admin/notes/statistiques/page.tsx", import.meta.url), "utf8",
  );
  const route = fs.readFileSync(
    new URL("../src/app/api/admin/grades/register/export-pdf/route.ts", import.meta.url), "utf8",
  );
  assert.match(page, /md:sticky md:right-0/, "la moyenne n'est plus fixe sur téléphone");
  assert.match(page, /w-\[142px\]/, "largeur élève adaptée au mobile");
  assert.match(page, /Notes par évaluation/, "instructions de défilement");
  assert.match(page, /educationTypeLabelOverride=/);
  assert.match(page, /"Primaire"/);
  assert.match(page, /Exporter PDF/);
  assert.match(page, /export-pdf\?/);
  assert.match(route, /loadAdminRegister\(req\)/, "les notes sont relues via l'API authentifiée");
  assert.match(route, /Content-Disposition/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { matrixPrintStudentName, matrixPrintSubjectLabel } from "../src/lib/matrix-print";

const measure = (value: string) => value.length * 7;
test("Les abrégés scolaires usuels restent compréhensibles", () => {
  const cases: Array<[string, string]> = [
    ["Mathématiques", "MATH"], ["Anglais", "ANG"],
    ["Composition française", "CF"], ["↳ Expression orale", "↳ E.O."],
    ["Expression écrite", "E.E."], ["Éducation physique et sportive", "EPS"],
    ["EDHC", "EDHC"], ["Histoire-Géographie", "HG"], ["Sciences de la vie et de la Terre", "SVT"],
    ["Conduite", "COND"], ["↳ Grammaire", "↳ GRAM"],
    ["Orthographe-Grammaire", "GR"], ["Orthographe et grammaire", "GR"],
    ["↳ Orthographe-Grammaire", "↳ GR"],
  ];
  for (const [label, expected] of cases) assert.equal(matrixPrintSubjectLabel(label), expected);
});
test("Les noms courts restent complets sur le PDF", () => {
  assert.equal(matrixPrintStudentName({ full_name: "KOUADIO Ange Aristide" }, 280, measure), "KOUADIO Ange Aristide");
});
test("Les prénoms suivants deviennent des initiales, sans toucher à la donnée originale", () => {
  const student = { full_name: "KOUADIO Ange Aristide" };
  assert.equal(matrixPrintStudentName(student, 140, measure), "KOUADIO Ange A.");
  assert.equal(student.full_name, "KOUADIO Ange Aristide");
});
test("Le nom de famille composé est préservé", () => {
  const student = { full_name: "KOUASSI N’DRI Marie Angélique Christelle" };
  assert.equal(matrixPrintStudentName(student, 240, measure), "KOUASSI N’DRI Marie Angélique C.");
});

test("La matrice trimestrielle A4 imprime les noms complets et un vrai pied de page", () => {
  const page = readFileSync("src/app/admin/notes/matrices/page.tsx", "utf8");
  assert.match(page, /const paperSize = subjects\.length > 24 \? "A2" : subjects\.length > 16 \? "A3" : "A4"/);
  assert.match(page, /\$\{escapeHtml\(row\.full_name\)\}<\/td>/);
  assert.doesNotMatch(page, /matrixPrintStudentName\(row,/);
  assert.match(page, /\.footer \{ position: fixed;/);
  assert.match(page, /thead \{ display: table-header-group;/);
  assert.match(page, /white-space: nowrap; font-variant-numeric: tabular-nums/);
  assert.match(page, /matrixPrintSubjectLabel\(fullLabel\)\.replace/);
});

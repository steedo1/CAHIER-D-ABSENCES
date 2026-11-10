import assert from "node:assert/strict";
import test from "node:test";
import { buildSchoolReportHtml } from "../src/lib/school-results-print";
import type { SchoolReportClass } from "../src/lib/school-results-reports";

test("Le modèle nominatif comprend les trois parties et le PDF A4 paysage", () => {
  const sample: SchoolReportClass[] = [{
    id: "6e1", label: "SIXIÈME 1", level: "6ème",
    institutionName: "Etablissement", regionalDirection: "",
    headTeacher: "Professeur A", educator: "Educateur B",
    students: [
      {
        id: "f", matricule: "014A", name: "ADOU Mariam",
        gender: "F", birthdate: "2014-09-01", nationality: "IVOIRIENNE",
        repeater: true, isAffected: true, average: 14.5, denominator: 20,
        rank: 1, observation: "Bien", decisionNumber: "124",
      },
      {
        id: "g", matricule: "014B", name: "KOUADIO Aristide",
        gender: "G", birthdate: "2013-08-15", nationality: "IVOIRIENNE",
        repeater: false, isAffected: false, average: 12, denominator: 20,
        rank: 2, observation: "", decisionNumber: "",
      },
    ],
  }];
  const html = buildSchoolReportHtml({
    classes: sample, kind: "nominal", filter: "all",
    academicYear: "2026-2027", periodLabel: "1er trimestre", track: "french",
  });
  assert.match(html, /@page\{size:A4 landscape/);
  assert.match(html, /1- &nbsp; Liste nominative des élèves/);
  assert.match(html, /Liste des élèves affectés par classe au 1er trimestre/);
  assert.match(html, /Liste des élèves non affectés par classe au 1er trimestre/);
  assert.match(html, /EFFECTIF AVEC L’APPROCHE PAR NIVEAU ET PAR GENRE/);
  assert.match(html, /TOTAL 1er CYCLE/);
  assert.match(html, /TOTAL ETABLISSEMENT/);
  assert.match(html, /N-RED/);
  assert.match(html, /MOY T1/);
  assert.match(html, /Professeur Principal/);
  assert.match(html, /Educateur/);
  assert.match(html, /2014/);
  assert.doesNotMatch(html, /RAPPORT 2 \(PAR TRIMESTRE\)/);
  assert.doesNotMatch(html, /Document édité avec <strong>Mon Cahier/);
});

test("La synthèse statistique conserve son format papier initial", () => {
  const html = buildSchoolReportHtml({
    classes: [], kind: "statistics", filter: "all",
    academicYear: "2026-2027", periodLabel: "1er trimestre", track: "french",
  });
  assert.match(html, /@page\{size:A4 portrait/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(
  new URL("../src/app/admin/notes/statistiques/page.tsx", import.meta.url),
  "utf8",
);

const route = fs.readFileSync(
  new URL("../src/app/api/admin/grades/register/route.ts", import.meta.url),
  "utf8",
);

const sidebar = fs.readFileSync(
  new URL("../src/app/admin/ui/sidebar-nav.tsx", import.meta.url),
  "utf8",
);

test("le registre propose les filtres métier dans l'ordre attendu", () => {
  const labels = [
    "Année scolaire",
    "Trimestre / période",
    "Niveau",
    "Classe",
    "Discipline",
    "Professeur",
  ];

  let cursor = -1;
  for (const label of labels) {
    const next = page.indexOf(label);
    assert.ok(next > cursor, `${label} doit apparaître après le filtre précédent`);
    cursor = next;
  }
});

test("le registre affiche un vrai cahier de notes et permet la saisie admin", () => {
  assert.match(page, /Registre des notes/);
  assert.match(page, /Ajouter une note/);
  assert.match(page, /Moyenne \/20/);
  assert.match(page, /Note \$\{index \+ 1\}/);
  assert.match(page, /action: "create_evaluation"/);
  assert.match(page, /action: "save_scores"/);
});

test("l'API admin attribue la nouvelle évaluation au professeur choisi", () => {
  assert.match(route, /action === "create_evaluation"/);
  assert.match(route, /teacher_id: teacherId/);
  assert.match(route, /action === "save_scores"/);
  assert.match(route, /ADMIN_REQUIRED/);
  assert.match(route, /EVALUATION_READ_ONLY/);
  assert.match(route, /EVALUATION_LOCKED/);
});

test("le registre lit brouillons et publications depuis leurs sources de référence", () => {
  assert.match(route, /workingEvaluationIds/);
  assert.match(route, /\.from\("student_grades"\)/);
  assert.match(route, /publishedEvaluationIds/);
  assert.match(route, /\.from\("v_grade_scores_official_for_reports"\)/);
  assert.match(route, /status === "published"/);
});

test("le registre ne perd pas les anciennes évaluations de matière ou de période", () => {
  assert.match(route, /ids: Array\.from\(ids\)/);
  assert.match(route, /\.in\("subject_id", subject\.ids\)/);
  assert.match(route, /grading_period_id\.eq\.\$\{periodId\}/);
  assert.match(route, /grading_period_id\.is\.null/);
  assert.match(route, /eval_date\.gte\.\$\{period\.start_date\}/);
  assert.match(route, /eval_date\.lte\.\$\{period\.end_date\}/);
});

test("le registre construit le roster sur la période et récupère les élèves porteurs de notes", () => {
  assert.match(route, /start_date\.lte\.\$\{period\.end_date\}/);
  assert.match(route, /end_date\.gte\.\$\{period\.start_date\}/);
  assert.match(route, /includeStudentsReferencedByScores/);
  assert.match(route, /recovered_students_from_scores/);
});

test("le registre expose des métadonnées de contrôle d'exhaustivité", () => {
  assert.match(route, /subject_ids_used/);
  assert.match(route, /published_evaluations_count/);
  assert.match(route, /working_evaluations_count/);
  assert.match(route, /legacy_period_evaluations_count/);
});

test("le registre est rangé dans le groupe Cahier de notes", () => {
  const notesStart = sidebar.indexOf("const NOTES_ITEMS");
  const registerLink = sidebar.indexOf('label: "Registre des notes"');
  const correspondenceStart = sidebar.indexOf("const FILE_CORRESPONDENCE_ITEMS");
  const conductStart = sidebar.indexOf("const CONDUCT_MANAGEMENT_ITEMS");

  assert.ok(registerLink > notesStart, "le registre doit être déclaré dans NOTES_ITEMS");
  assert.equal(
    sidebar.slice(correspondenceStart, conductStart).includes('/admin/notes/statistiques'),
    false,
    "le registre ne doit plus être rangé dans Correspondant fichier",
  );
});

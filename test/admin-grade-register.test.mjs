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

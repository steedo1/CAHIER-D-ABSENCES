import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const read = (path) => readFileSync(path, "utf8");

test("école franco-arabe : même onglet coefficients qu'une école classique, sans deuxième écran d'activation", () => {
  const page = read("src/app/admin/parametres/page.tsx");
  const tab = page.slice(page.indexOf('activeTab === "coefficients"'), page.indexOf('activeTab === "bulletin-models"'));
  assert.match(tab, /hasBilingualPrograms\s*\?\s*\(\s*<SchoolCoefficientsClassicWorkflow/);
  assert.match(tab, /hasSpecializedSettings\s*\?\s*\(\s*<SchoolBulletinSettings mode="coefficients"/);
  assert.match(tab, /\)\s*:\s*\(\s*<>\s*<EducationScopeSwitcher/);
  assert.match(tab, /<SchoolSubjectProgramsEditor/);
  assert.match(tab, /<SchoolClassSubjectsEditor/);
  assert.match(tab, /<SchoolStudentProgramsEditor/);
});

test("éditeur franco-arabe : filtres cycle, enseignement et classe puis tableau classique des disciplines", () => {
  const view = read("src/components/admin/SchoolCoefficientsClassicWorkflow.tsx");
  for (const label of [/aria-label="Cycle"/, /aria-label="Enseignement"/,
    /aria-label="Niveau et classe"/, /Coefficient bulletin/, /Sous-matières \(optionnel\)/,
    /Enregistrer les coefficients/, /Rafraîchir/]) assert.match(view, label);
  assert.doesNotMatch(view, /Préparer des bulletins propres à cet établissement/);
  assert.doesNotMatch(view, /Utiliser ces règles pour les bulletins des cycles configurés/);
  assert.doesNotMatch(view, /<SchoolBulletinSettings/);
  assert.match(view, /engine: "specialized"/);
  assert.match(view, /revision: settings\.revision/);
});

test("français secondaire : moteur historique et sous-matières existantes, sans enregistrement massif", () => {
  const view = read("src/components/admin/SchoolCoefficientsClassicWorkflow.tsx");
  assert.match(view, /frenchSecondary = cycle === "secondary" && track === "french"/);
  assert.match(view, /fetch\(historicalEndpoint/);
  assert.match(view, /body: JSON\.stringify\(\{ items: numbers\.map/);
  assert.match(view, /fetch\(componentsEndpoint/);
  assert.match(view, /La somme des sous-matières doit être égale au coefficient/);
  assert.doesNotMatch(view, /items: historical\.map/);
});

test("arabe secondaire : sauvegarde par cycle/niveau/enseignement/matière, jamais dans la table française", () => {
  const view = read("src/components/admin/SchoolCoefficientsClassicWorkflow.tsx");
  assert.match(view, /coefficientSource: "program"/);
  assert.match(view, /coefficients: \[\.\.\.untouched/);
  assert.match(view, /cycle, track, level, subjectId: subject\.id/);
  assert.match(view, /if \(frenchSecondary\) \{/);
  assert.match(view, /if \(!frenchSecondary \|\| !level\)/);
  assert.match(view, /reporting\.coefficients\.find\(row => row\.cycle === cycle && row\.track === track/);
  assert.match(read("src/lib/franco-arabic-reporting.ts"), /policy\.cycle === cycle && policy\.track === track/);
  assert.match(read("src/app/api/admin/bulletin-templates/route.ts"), /subject_not_configured_for_program/);
});

test("primaire et préscolaire : pas de coefficients par matière", () => {
  const view = read("src/components/admin/SchoolCoefficientsClassicWorkflow.tsx");
  assert.match(view, /showCoefficients = cycle === "secondary"/);
  assert.match(view, /cycle === "preschool"/);
  assert.match(view, /Barème des notes/);
});

test("la vue ordinaire reste inchangée et les APIs sont toujours isolées par établissement", () => {
  const page = read("src/app/admin/parametres/page.tsx");
  assert.match(page, /<EducationScopeSwitcher/);
  assert.match(page, /<SchoolBulletinSettings mode="coefficients"/);
  const api = read("src/app/api/admin/institution/subject-coeffs/route.ts");
  assert.match(api, /institution_id/);
});

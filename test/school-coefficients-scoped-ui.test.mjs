import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("the historical coefficient editor is inaccessible in multicycle schools", () => {
  const page = read("src/app/admin/parametres/page.tsx");
  const tab = page.slice(page.indexOf('activeTab === "coefficients"'), page.indexOf('activeTab === "bulletin-models"'));
  assert.match(tab, /hasSpecializedSettings\s*\?\s*\(\s*<SchoolBulletinSettings mode="coefficients"/);
  assert.match(tab, /\)\s*:\s*\(\s*<>\s*<EducationScopeSwitcher/);
  assert.match(tab, /<SchoolSubjectProgramsEditor/);
  assert.match(tab, /<SchoolClassSubjectsEditor/);
});

test("the specialized editor shows only classified and selected class subjects", () => {
  const editor = read("src/components/admin/SchoolBulletinSettings.tsx");
  assert.match(editor, /const scopedPrograms = mode === "coefficients"/);
  assert.match(editor, /row\.cycle === activeProgram\?\.cycle && row\.track === activeProgram\?\.track/);
  assert.match(editor, /subjectTracksByCycle\[cycle\]\?\.\[subject\.id\]\?\.includes\(track\)/);
  assert.match(editor, /classSubjectIds\.includes\(subject\.id\)/);
  assert.match(editor, /belongsToSelectedLevel/);
  assert.match(editor, /sameSchoolLevel\(level, activeTeachingClass\.level, cycle\)/);
  assert.match(editor, /const possibleSubjects = mode === "coefficients"/);
  assert.match(editor, /api\/admin\/school-class-subjects\?class_id=/);
  assert.match(editor, /mode === "coefficients"/);
});

test("existing scoped report coefficients are still keyed by cycle level track subject", () => {
  const rules = read("src/lib/franco-arabic-reporting.ts");
  const api = read("src/app/api/admin/bulletin-templates/route.ts");
  const old = read("src/app/api/admin/institution/subject-coeffs/route.ts");
  assert.match(rules, /policy\.cycle === cycle && policy\.track === track/);
  assert.match(api, /subject_not_configured_for_program/);
  assert.match(old, /institution_subject_coeffs/);
});

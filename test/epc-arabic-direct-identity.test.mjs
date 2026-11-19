import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const page = read("src/app/admin/classes/liste/[id]/page.tsx");
const roster = read("src/app/api/admin/classes/[id]/roster/route.ts");
const api = read("src/app/api/admin/students/[id]/route.ts");

test("Arabic class can edit direct-only identity without unlocking linked French rosters", () => {
  assert.match(roster, /can_edit_direct_student_identity: canEditStudentIdentity && isArabicClass/);
  assert.match(roster, /can_edit: canWrite && \(!isArabicClass \|\| !linkedEnrollments\.length\)/);
  assert.match(page, /student\.pedagogical_link === false/);
  assert.match(page, /student\.pedagogical_link !== false/);
  assert.match(page, /data\?\.can_edit_direct_student_identity/);
});
test("Arabic-only civil status editor updates the tenant-scoped student endpoint", () => {
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /\/api\/admin\/students\/\$\{encodeURIComponent\(student\.id\)\}/);
  for (const key of ["birthdate", "birth_place", "gender", "nationality", "parent_names", "parent_contact", "matricule"]) {
    assert.ok(page.includes('"' + key + '"'), "editor missing " + key);
    assert.ok(api.includes(key), "API missing " + key);
  }
  assert.match(api, /\.eq\("institution_id", inst\)/);
});

test("Corriger les champs opens the Arabic-only editor in mixed Arabic/French classes", () => {
  assert.match(page, /const canCorrectArabicOnlyPupils = arabicList &&/);
  assert.match(page, /data\?\.can_edit_direct_student_identity === true/);
  assert.match(page, /students\.some\(\(student\) => student\.pedagogical_link === false\)/);

  const button = page.match(/\{\(canEdit \|\| canCorrectArabicOnlyPupils\) \? \([\s\S]*?Corriger les champs[\s\S]*?<\/button>/)?.[0];
  assert.ok(button, "expected visible Corriger les champs for a mixed Arabic roster");
  assert.match(button, /if \(canCorrectArabicOnlyPupils\)/);
  assert.match(button, /setShowCorrections\(false\)/);
  assert.match(button, /setShowDirectArabicIdentities\(\(value\) => !value\)/);
  assert.match(button, /aria-controls=\{canCorrectArabicOnlyPupils \? "arabic-direct-student-identities"/);
  assert.match(page, /ref=\{directArabicPanel\}/);
  assert.match(page, /directArabicPanel\.current\?\.scrollIntoView/);
  assert.doesNotMatch(page, />\s*Renseigner les fiches des élèves uniquement arabes\s*</);
});

test("Saving Arabic-only fields stays individual and never updates linked French pupils", () => {
  const save = page.split("async function saveDirectArabicStudent(student: StudentRow)")[1].split("async function saveArabicNames()")[0];
  assert.match(save, /student\.pedagogical_link !== false/);
  assert.match(save, /\/api\/admin\/students\/\$\{encodeURIComponent\(student\.id\)\}/);
  assert.doesNotMatch(save, /force_finance_sync|class_enrollments/);
  assert.match(page, /students\.filter\(\(student\) => student\.pedagogical_link === false\)/);
});

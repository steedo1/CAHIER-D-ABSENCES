import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

const withdrawal = source("src/app/api/admin/enrollments/remove/route.ts");
const studentPatch = source("src/app/api/admin/students/[id]/route.ts");
const studentList = source("src/app/api/admin/students/route.ts");
const listUi = source("src/app/admin/parents/ParentsClient.tsx");
const arabicRoster = source("src/app/api/admin/classes/[id]/roster/route.ts");
const arabicPrint = source("src/app/admin/classes/liste/[id]/page.tsx");

test("student withdrawal closes enrollment and does not delete student or finance", () => {
  assert.doesNotMatch(withdrawal, /delete_student_completely_v1|from\("students"\)\s*\.delete/);
  assert.match(withdrawal, /\.update\(\{\s*end_date:\s*today\s*\}\)/);
  assert.match(withdrawal, /deleted:\s*false/);
  assert.match(withdrawal, /closed:\s*1/);
  assert.match(listUi, /Retirer de la classe/);
});

test("admin edit saves Arab names and birth / parent details", () => {
  for (const field of ["full_name_ar", "birthdate", "birth_place", "nationality", "parent_names", "parent_contact"]) {
    assert.ok(studentPatch.includes(field), field + " not handled by PATCH");
    assert.ok(listUi.includes("editing." + field), field + " not editable in UI");
  }
  assert.match(studentPatch, /student_update_not_applied/);
  assert.match(studentList, /full_name_ar/);
});

test("Render Arabic sorting remains in both roster and printable list", () => {
  assert.match(arabicRoster, /compareArabicClassListStudents\(a,\s*b\)/);
  assert.match(arabicPrint, /compareArabicClassListStudents\(a,\s*b\)/);
});

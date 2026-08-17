import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "src/app/api/admin/dashboard/metrics/route.ts",
  "utf8",
);

test("dashboard counts the active teacher pool independently of the academic year", () => {
  const start = source.indexOf("// Vivier enseignant actif");
  const end = source.indexOf("// Parents de l'année courante", start);
  assert.ok(start >= 0 && end > start, "le bloc vivier enseignant doit exister");

  const teacherBlock = source.slice(start, end);
  assert.match(teacherBlock, /\.from\("user_roles"\)/);
  assert.match(teacherBlock, /\.eq\("institution_id", institution_id\)/);
  assert.match(teacherBlock, /\.eq\("role", "teacher"\)/);
  assert.match(teacherBlock, /row\.profile_id/);
  assert.doesNotMatch(teacherBlock, /class_teachers/);
  assert.doesNotMatch(teacherBlock, /\.in\("class_id"/);
  assert.match(source, /teachers: teacherIds\.size/);
});

test("current-year class assignments remain separate from the teacher pool", () => {
  const associations = readFileSync(
    "src/app/api/admin/associations/route.ts",
    "utf8",
  );
  assert.match(associations, /getClassIdsForAcademicYear/);
  assert.match(associations, /\.eq\("academic_year", year\)/);
});

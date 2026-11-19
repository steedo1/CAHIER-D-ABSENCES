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

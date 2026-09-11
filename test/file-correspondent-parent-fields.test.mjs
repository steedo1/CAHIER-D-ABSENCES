import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("la résolution du rôle vérifie la session puis lit les rôles côté service", () => {
  const layout = read("src/app/admin/layout.tsx");
  const roleApi = read("src/app/api/auth/role/route.ts");

  for (const source of [layout, roleApi]) {
    assert.match(source, /auth\.getUser\(\)/);
    assert.match(source, /getSupabaseServiceClient\(\)/);
    assert.match(source, /\.from\("user_roles"\)/);
  }
});

test("les opérations du périmètre fichier acceptent le correspondant", () => {
  assert.match(
    read("src/app/api/admin/students/import/route.ts"),
    /"file_correspondent"/,
  );
  assert.match(
    read("src/app/api/admin/teachers/by-subject/route.ts"),
    /"file_correspondent"/,
  );
});

test("la migration ajoute des champs parents facultatifs et des droits cloisonnés", () => {
  const migration = read(
    "supabase/migrations/20260911122829_add_student_parent_identity_fields.sql",
  );

  assert.match(migration, /add column if not exists parent_names text/);
  assert.match(migration, /add column if not exists parent_contact text/);
  assert.doesNotMatch(migration, /parent_(?:names|contact) text not null/);
  assert.match(migration, /students_write_file_correspondent/);
  assert.match(migration, /guardians_write_file_correspondent/);
  assert.match(migration, /ur\.institution_id = students\.institution_id/);
  assert.doesNotMatch(migration, /create or replace function public\.is_staff_of_inst/);
});

test("la correction de liste charge et enregistre les deux champs parents", () => {
  const page = read("src/app/admin/classes/liste/[id]/page.tsx");
  const roster = read("src/app/api/admin/classes/[id]/roster/route.ts");

  for (const field of ["parent_names", "parent_contact"]) {
    assert.ok(page.includes(field), field);
    assert.ok(roster.includes(field), field);
  }
  assert.match(page, /Nom\(s\) des parents ou tuteurs \(facultatif\)/);
  assert.match(page, /Contact du parent ou tuteur \(facultatif\)/);
  assert.match(roster, /parent_names: normalizeNullableText/);
  assert.match(roster, /parent_contact: normalizeNullableText/);
});

test("l'attestation affiche le nom des parents uniquement lorsqu'il est renseigné", () => {
  const studentsApi = read("src/app/api/admin/students/route.ts");
  const attestations = read("src/app/admin/parents/page.tsx");

  assert.match(studentsApi, /parent_names: \(s\.parent_names \?\? null\)/);
  assert.match(attestations, /const parentNames = \(student\.parent_names \|\| ""\)\.trim\(\)/);
  assert.match(attestations, /Parent\(s\) \/ tuteur\(s\)/);
  assert.match(attestations, /parentNames\s*\?/);
});

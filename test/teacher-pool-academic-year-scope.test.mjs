import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(relativePath) {
  return await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("le vivier enseignant est indépendant de l'année scolaire et le groupe reste opt-in", async () => {
  const route = await read("src/app/api/admin/teachers/by-subject/route.ts");
  const helper = await read("src/lib/teacher-pool-scope.ts");

  assert.match(route, /const groupPoolRequested = url\.searchParams\.get\("pool"\) === "group"/);
  assert.match(route, /let poolInstitutionIds = \[institutionId\]/);
  assert.match(route, /if \(groupPoolRequested\)/);
  assert.match(route, /resolveTeacherPoolInstitutionIds/);
  assert.match(route, /\.in\("institution_id", poolInstitutionIds\)/);
  assert.match(route, /\.from\("profiles"\)[\s\S]*\.in\("id", Array\.from\(teacherIds\)\)/);
  assert.doesNotMatch(
    route,
    /\.from\("profiles"\)[\s\S]{0,180}\.eq\("institution_id", institutionId\)[\s\S]{0,180}\.in\("id", Array\.from\(teacherIds\)\)/,
  );

  assert.match(helper, /school_group_institutions/);
  assert.match(helper, /return \[currentId\]/);
});

test("le filtre discipline fusionne le référentiel enseignant et les affectations historiques", async () => {
  const route = await read("src/app/api/admin/teachers/by-subject/route.ts");

  assert.match(route, /Promise\.all\(/);
  assert.match(route, /\.from\("teacher_subjects"\)/);
  assert.match(route, /\.from\("class_teachers"\)/);
  assert.match(route, /row\.profile_id/);
  assert.match(route, /row\.teacher_id/);
});

test("les affectations restent rattachées aux classes de l'année choisie", async () => {
  const route = await read("src/app/api/admin/associations/route.ts");
  const page = await read("src/app/admin/affectations/page.tsx");

  assert.match(route, /getClassIdsForAcademicYear/);
  assert.match(route, /\.eq\("academic_year", year\)/);
  assert.match(route, /classes_not_in_selected_academic_year/);
  assert.match(page, /academic_year: selectedAcademicYear \|\| null/);
  assert.match(page, /\/api\/admin\/classes/);
  assert.match(page, /academic_year/);
});

test("retirer un enseignant conserve son historique et un autre établissement actif", async () => {
  const route = await read("src/app/api/admin/teachers/remove/route.ts");

  assert.match(route, /history_preserved: true/);
  assert.match(route, /\.from\("user_roles"\)[\s\S]*\.eq\("role", "teacher"\)/);
  assert.match(route, /reassigned_profile_institution/);
  assert.doesNotMatch(route, /\.from\("class_teachers"\)\.delete/);
});

test("la migration sécurise le groupe scolaire et la réactivation d'un enseignant", async () => {
  const migration = await read(
    "supabase/migrations/20260816233000_school_group_teacher_pool.sql",
  );

  assert.match(migration, /create table if not exists public\.school_groups/);
  assert.match(migration, /create table if not exists public\.school_group_institutions/);
  assert.match(migration, /unique \(institution_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.school_groups from anon, authenticated/);
  assert.match(migration, /ensure_teacher_profile_institution/);
  assert.match(migration, /institution_id is null/);
  assert.match(migration, /after insert or update of role, institution_id/);
});

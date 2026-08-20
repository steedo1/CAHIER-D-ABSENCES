import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("l'inscription unitaire réutilise le moteur d'affectation et les statuts financiers sont facultatifs", async () => {
  const page = await source("src/app/admin/classes/liste/[id]/page.tsx");
  assert.match(page, /fetch\("\/api\/admin\/enrollments\/assign"/);
  assert.match(page, /action:\s*"create_and_assign"/);
  assert.match(page, /affectationValue === "" \? null/);
  assert.match(page, /boardingValue === "" \? null/);
  assert.doesNotMatch(page, /Choisis aussi Affecté\/Non affecté et Interne\/Externe avant d’inscrire/);
});

test("le moteur assign clôture les anciennes inscriptions de toute année et mémorise le profil annuel", async () => {
  const code = await source("src/app/api/admin/enrollments/assign/route.ts");
  assert.doesNotMatch(code, /Affecte\/Non affecte et Interne\/Externe sont obligatoires avant l'inscription/);
  assert.match(code, /academicYearEndByCode/);
  assert.match(code, /sourceAcademicYear !== targetAcademicYear/);
  assert.match(code, /targetAcademicYearStartDate \|\| today/);
  assert.match(code, /\.from\("student_year_profiles"\)/);
  assert.match(code, /onConflict:\s*"institution_id,academic_year_id,student_id"/);
});

test("l'import reconnaît DEC, Aff/NAff et les marqueurs d'internat sans bloquer l'inscription", async () => {
  const code = await source("src/app/api/admin/students/import/route.ts");
  assert.match(code, /parseAffectationCell/);
  assert.match(code, /\|dec\|decision/);
  assert.match(code, /parseBoardingCell/);
  assert.match(code, /numeroCandidates/);
  assert.doesNotMatch(code, /Import annulé : Affecté\/Non affecté et Interne\/Externe sont obligatoires/);
  assert.match(code, /finance_profile_incomplete_rows/);
});

test("l'import clôture aussi l'inscription d'une année précédente sans transférer sa finance", async () => {
  const code = await source("src/app/api/admin/students/import/route.ts");
  assert.match(code, /row\.academic_year === targetAcademicYear/);
  assert.match(code, /row\.academic_year && row\.academic_year !== targetAcademicYear/);
  assert.match(code, /academicYearEndByCode\.get\(row\.academic_year\)/);
  assert.match(code, /start_date: targetAcademicYearStartDate \|\| today/);
  assert.match(code, /\.from\("student_year_profiles"\)/);
});

test("la finance ne bloque plus toute inscription si un seul statut est inconnu", async () => {
  const code = await source("src/lib/finance/student-finance-sync.ts");
  assert.doesNotMatch(code, /Profil financier incomplet[\s\S]*Aucune dette n'a été modifiée/);
  assert.match(code, /requiresAffectation/);
  assert.match(code, /requiresBoarding/);
  assert.match(code, /seuls les frais indépendants de ce statut peuvent être générés/);
  assert.match(code, /les frais d'internat sont ignorés/);
});

test("la réconciliation garde la fiche courante et ne déplace pas la finance", async () => {
  const sql = await source("src/db/20260820_student_duplicate_merge_rpc.sql");
  const route = await source("src/app/api/admin/enrollments/assign/route.ts");
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /promote_current_student_over_historical/i);
  assert.doesNotMatch(sql, /student_person_collision/i);
  assert.match(sql, /v_person_id := coalesce\(v_current\.student_person_id, v_historical\.student_person_id\)/i);
  assert.match(sql, /finance_moved', false/i);
  assert.doesNotMatch(sql, /update finance\.student_charges/i);
  assert.doesNotMatch(sql, /update finance\.receipts/i);
  assert.match(route, /promote_current_student_over_historical/);
  assert.match(route, /p_current_student_id:\s*currentStudentId/);
  assert.doesNotMatch(route, /merge_student_duplicate_into_canonical/);
  assert.match(sql, /grant execute[\s\S]*to service_role/i);
});

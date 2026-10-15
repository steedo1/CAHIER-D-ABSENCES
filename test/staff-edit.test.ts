import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditStaffAccount,
  editableEducatorClassDiff,
  normalizeStaffPhone,
  normalizedStaffEmail,
  normalizedStaffName,
  samePhone,
} from "../src/lib/staff-edit";

const SCHOOL = "e7c6fc38-e93d-4f19-aa7c-26e1337de320";
const OTHER = "8c6872b0-61a5-4932-bd84-f2850976b063";

test("Côte d'Ivoire: preserving initial zero gives 10 national digits", () => {
  assert.equal(normalizeStaffPhone("07 01 02 03 04"), "+2250701020304");
  assert.equal(normalizeStaffPhone("+225 07 01 02 03 04"), "+2250701020304");
  assert.equal(normalizeStaffPhone("2250701020304"), "+2250701020304");
  assert.equal(normalizeStaffPhone("+225701020304"), null);
  assert.equal(normalizeStaffPhone("07010203"), null);
  assert.equal(normalizeStaffPhone(""), null);
  assert.equal(normalizeStaffPhone("+33612345678"), "+33612345678");
  assert.equal(samePhone("+2250701020304", "2250701020304"), true);
});

test("Validation conservatrice du nom et de l'e-mail", () => {
  assert.equal(normalizedStaffName("  SANOGO    IBRAHIM "), "SANOGO IBRAHIM");
  assert.equal(normalizedStaffName(" "), null);
  assert.equal(normalizedStaffEmail(" TEST@EXAMPLE.ORG "), "test@example.org");
  assert.equal(normalizedStaffEmail("adresse incorrecte"), null);
});

test("Admin local: enseignant, éducateur, infirmerie autorisés pour son école", () => {
  for (const role of ["teacher", "educator", "infirmier", "file_correspondent"]) {
    assert.equal(canEditStaffAccount([{ role, institution_id: SCHOOL }], SCHOOL, SCHOOL, false), true);
  }
});

test("Admin local ne peut pas modifier les comptes élevés", () => {
  for (const role of ["admin", "finance_manager"]) {
    assert.equal(canEditStaffAccount([{ role, institution_id: SCHOOL }], SCHOOL, SCHOOL, false), false);
    assert.equal(canEditStaffAccount([{ role, institution_id: SCHOOL }], SCHOOL, SCHOOL, true), true);
  }
});

test("Aucun acteur ne modifie un compte partagé, hors école ou global", () => {
  const shared = [
    { role: "teacher", institution_id: SCHOOL },
    { role: "parent", institution_id: OTHER },
  ];
  assert.equal(canEditStaffAccount(shared, SCHOOL, SCHOOL, false), false);
  assert.equal(canEditStaffAccount(shared, SCHOOL, SCHOOL, true), false);
  assert.equal(canEditStaffAccount([{ role: "teacher", institution_id: SCHOOL }], SCHOOL, OTHER, true), false);
  assert.equal(canEditStaffAccount([
    { role: "educator", institution_id: SCHOOL },
    { role: "super_admin", institution_id: null },
  ], SCHOOL, SCHOOL, true), false);
});

test("Les diffs d'affectations préservent les classes inchangées", () => {
  const oldIds = ["6e1", "6e2", "5e1"];
  const nextIds = ["6e1", "6e3"];
  assert.deepEqual(editableEducatorClassDiff(oldIds, nextIds), {
    added: ["6e3"],
    removed: ["6e2", "5e1"],
  });
});

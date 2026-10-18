import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SCHOOL_TEACHING_SIGNATORIES_KEY, readSchoolTeachingSignatories,
  setSchoolTeachingSignatory, validSignatoryName } from "../src/lib/school-teaching-signatories";

test("les écoles sans nomination ne reçoivent aucune signature inventée", () => {
  assert.deepEqual(readSchoolTeachingSignatories(undefined), {});
  assert.deepEqual(readSchoolTeachingSignatories({}), {});
  assert.deepEqual(readSchoolTeachingSignatories({ [SCHOOL_TEACHING_SIGNATORIES_KEY]: { version: 99, french: { name: "X" } } }), {});
});

test("les deux directions sont des noms, jamais des rôles ni des comptes", () => {
  const original = { school_cycles_v1: { enabled: true }, other_option: "preserved" };
  const french = setSchoolTeachingSignatory(original, "french", "Nimaga Adam Ousmane");
  const both = setSchoolTeachingSignatory(french, "arabic", "Traoré Daouda");
  assert.equal(readSchoolTeachingSignatories(both).french?.name, "Nimaga Adam Ousmane");
  assert.equal(readSchoolTeachingSignatories(both).arabic?.name, "Traoré Daouda");
  assert.deepEqual(both.school_cycles_v1, original.school_cycles_v1);
  assert.equal(both.other_option, "preserved");
  assert.ok(!JSON.stringify(both).includes("teaching_director"));
  assert.ok(!JSON.stringify(both).includes("password"));
  const removed = setSchoolTeachingSignatory(both, "arabic", "");
  assert.equal(readSchoolTeachingSignatories(removed).arabic, undefined);
  assert.equal(readSchoolTeachingSignatories(removed).french?.name, "Nimaga Adam Ousmane");
});

test("noms affichables sans retours à la ligne ni données invalides", () => {
  assert.ok(validSignatoryName("Traoré Daouda"));
  assert.ok(!validSignatoryName("a"));
  assert.ok(!validSignatoryName("X\nY"));
  assert.deepEqual(readSchoolTeachingSignatories({
    [SCHOOL_TEACHING_SIGNATORIES_KEY]: { version: 1, arabic: { name: "A\nB" } },
  }), {});
});

import assert from "node:assert/strict";
import test from "node:test";
import { canonicalEducatorLevel } from "../src/lib/educator-level";

test("mêmes niveaux de collège sous leurs codes historique et officiel", () => {
  for (const digit of ["3", "4", "5", "6"]) {
    assert.equal(canonicalEducatorLevel(`${digit}e`, "general_secondary"), `${digit}e`);
    assert.equal(canonicalEducatorLevel(`${digit}eme`, "general_secondary"), `${digit}e`);
    assert.equal(canonicalEducatorLevel(`${digit}ème`, "general_secondary"), `${digit}e`);
  }
});

test("les formations non générales et autres niveaux restent inchangés", () => {
  assert.equal(canonicalEducatorLevel("5eme", "technical_secondary"), "5eme");
  assert.equal(canonicalEducatorLevel("1ereD", "general_secondary"), "1ereD");
  assert.equal(canonicalEducatorLevel("2ndeA", "general_secondary"), "2ndeA");
  assert.equal(canonicalEducatorLevel("CAP2", "vocational_secondary"), "CAP2");
});

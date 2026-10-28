import assert from "node:assert/strict";
import test from "node:test";
import { arabicClassListLevel, arabicClassListSubject, isValidWrittenArabicName }
  from "../src/lib/class-list-arabic";

test("Arabic list labels preserve the actual French grade", () => {
  assert.match(arabicClassListLevel("CP1", "CP1 — Arabe"), /السنة الأولى الابتدائية \(CP1\)/);
  assert.match(arabicClassListLevel("6ème", "6ème — Arabe"), /الصف السادس \(6ème\)/);
  assert.equal(arabicClassListLevel("unknown", "Custom AR"), "Custom AR");
});

test("existing Arabic subject dictionary is reused without changing grade scales", () => {
  assert.deepEqual(arabicClassListSubject("Lecture", "Lect."),
    {header:"القراءة", legend:"القراءة (Lecture)"});
  assert.deepEqual(arabicClassListSubject("Unmapped subject", "Unm."),
    {header:"Unm.", legend:"Unmapped subject"});
});

test("Arabic spelling is optional, bounded and must be Arabic when provided", () => {
  assert.equal(isValidWrittenArabicName("محمد تراوري"), true);
  assert.equal(isValidWrittenArabicName(""), true);
  assert.equal(isValidWrittenArabicName("TRaore OsMane"), false);
  assert.equal(isValidWrittenArabicName("م".repeat(150)), false);
  assert.equal(isValidWrittenArabicName("محمد\nTRAORE"), false);
});

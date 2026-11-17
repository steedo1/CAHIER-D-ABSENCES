import assert from "node:assert/strict";
import test from "node:test";
import { arabicClassListLevel, arabicClassListSubject, compareArabicClassListStudents, isValidWrittenArabicName }
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

test("Arabic class lists use Arabic alphabet, not French identity order", () => {
  const pupils = [
    { id: "m", full_name: "A. French", full_name_ar: "محمد تراوري" },
    { id: "missing", full_name: "B. French", full_name_ar: null },
    { id: "f", full_name: "C. French", full_name_ar: "فاطمة كوني" },
    { id: "a", full_name: "Z. French", full_name_ar: "أحمد كوني" },
    { id: "b", full_name: "D. French", full_name_ar: "بشير علي" },
  ];
  assert.deepEqual(
    pupils.sort(compareArabicClassListStudents).map(student => student.id),
    ["a", "b", "f", "m", "missing"],
  );
});

test("Arabic sorting ignores vowel marks and keeps French fallback deterministic", () => {
  const pupils = [
    { id: "b", full_name: "ZONGO", full_name_ar: "مُحَمَّد" },
    { id: "a", full_name: "ABDOU", full_name_ar: "محمد" },
    { id: "missingZ", full_name: "ZONGO", full_name_ar: null },
    { id: "missingA", full_name: "ABDOU", full_name_ar: "" },
  ];
  assert.deepEqual(
    pupils.sort(compareArabicClassListStudents).map(student => student.id),
    ["a", "b", "missingA", "missingZ"],
  );
});

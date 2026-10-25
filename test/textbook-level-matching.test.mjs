import assert from "node:assert/strict";
import test from "node:test";
import { matchesTextbookGeneralLevel } from "../src/lib/textbook/level-matching.ts";

const csca = [
  ["2A", "2A", "2ndeA", "2nde A-C"],
  ["2C1", "2C", "2ndeC", "2nde A-C"],
  ["2C2", "2C", "2ndeC", "2nde A-C"],
  ["1A", "1A", "1ereA2", "1ère A"],
  ["1D1", "1D", "1ereD", "1ère C-D"],
  ["1D2", "1D", "1ereD", "1ère C-D"],
  ["TA", "TA", "tleA2", "Tle A"],
  ["TD1", "T D", "tleD", "Tle C-D"],
  ["TD2", "T D", "tleD", "Tle C-D"],
];
for (const [label, level, official_track_code, progression] of csca) {
  test(`la progression ${progression} correspond à ${label}`, () => {
    assert.equal(matchesTextbookGeneralLevel({ level: progression }, { label, level, official_track_code }), true);
    assert.equal(matchesTextbookGeneralLevel({ level: progression }, { label, level }), true);
  });
}

test("les filières A et C/D et les niveaux restent séparés", () => {
  const expected = ["2nde A-C", "1ère A", "1ère C-D", "Tle A", "Tle C-D"];
  for (const [label, level, official_track_code, progression] of csca) {
    for (const candidate of expected) {
      assert.equal(matchesTextbookGeneralLevel({ level: candidate }, { label, level, official_track_code }), candidate === progression, `${candidate} / ${label}`);
    }
  }
});

test("les séries A1 et A2 sont distinguées même si le libellé contient une division", () => {
  const row = { level: "1A", label: "1A1", official_track_code: "1ereA2" };
  assert.equal(matchesTextbookGeneralLevel({ level: "1re A1" }, row), false);
  assert.equal(matchesTextbookGeneralLevel({ level: "1re A2" }, row), true);
  assert.equal(matchesTextbookGeneralLevel({ level: "Première A" }, row), true);
  assert.equal(matchesTextbookGeneralLevel({ level: "1re A1" }, { level: "1A", label: "1A1" }), false);
});

test("les variantes nationales par série correspondent aux niveaux courts", () => {
  for (const [expected, level] of [["2nde A", "2A"], ["2nde C", "2C"], ["1ère C", "1C"], ["1ère D", "1D"], ["Tle C", "TC"], ["Tle D", "T D"]]) {
    assert.equal(matchesTextbookGeneralLevel({ level: expected }, { level, label: `${level}1` }), true);
  }
  assert.equal(matchesTextbookGeneralLevel({ level: "2nde A" }, { level: "2C", label: "2C1" }), false);
});

test("la progression maths 1D de Notre-Dame et les niveaux génériques restent reconnus", () => {
  assert.equal(matchesTextbookGeneralLevel({ level: "1ère D" }, { level: "1ere", label: "1ère D1" }), true);
  assert.equal(matchesTextbookGeneralLevel({ level: "Première" }, { level: "1D", label: "1D2" }), true);
  assert.equal(matchesTextbookGeneralLevel({ level: "Première", series: "C/D" }, { level: "1D", label: "1D2" }), true);
  assert.equal(matchesTextbookGeneralLevel({ level: "Première", series: "C/D" }, { level: "1A", label: "1A" }), false);
});

test("les divisions du premier cycle ne changent pas le niveau", () => {
  for (const [expected, level, label] of [["Sixième", "6e", "6e1"], ["5ème", "5e", "5e2"], ["Quatrième", "4e", "4e11"], ["3e", "3e", "3e3"]]) {
    assert.equal(matchesTextbookGeneralLevel({ level: expected }, { level, label }), true);
  }
  assert.equal(matchesTextbookGeneralLevel({ level: "4e" }, { level: "3e", label: "3e4" }), false);
  assert.equal(matchesTextbookGeneralLevel({ level: "4e" }, { label: "14e" }), false);
});

test("les séparateurs et les libellés complets des groupes sont reconnus", () => {
  for (const expected of ["Premières C et D", "1ère C/D", "1ere C-D", "1CD"]) {
    assert.equal(matchesTextbookGeneralLevel({ level: expected }, { level: "1D", label: "1D1" }), true);
  }
  assert.equal(matchesTextbookGeneralLevel({ level: "Terminales C et D" }, { level: "TC", label: "TC1" }), true);
});

test("une valeur inconnue ne correspond pas par simple sous-chaîne", () => {
  assert.equal(matchesTextbookGeneralLevel({ level: "CAP2" }, { level: "CAP2" }), true);
  assert.equal(matchesTextbookGeneralLevel({ level: "CAP2" }, { level: "CAP3", label: "CAP20" }), false);
  assert.equal(matchesTextbookGeneralLevel({ level: "" }, { level: "1D" }), false);
});

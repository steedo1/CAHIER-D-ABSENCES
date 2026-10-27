import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeSubjectAppreciation } from "../src/lib/grades/subject-appreciation";

test("sub-subjects and regular subjects use the same official appreciation bands", () => {
  for (const [average, expected] of [
    [0, "Blâme"], [5.99, "Blâme"], [6, "Faible"],
    [8, "Insuffisant"], [10, "Passable"], [12, "Assez bien"],
    [14, "Bien"], [16, "TRÈS bien"], [18, "Excellent"], [20, "Excellent"],
  ] as const) {
    assert.equal(computeSubjectAppreciation(average), expected, String(average));
  }
});

test("no average is not converted to a failing appreciation", () => {
  assert.equal(computeSubjectAppreciation(null), "");
  assert.equal(computeSubjectAppreciation(undefined), "");
  assert.equal(computeSubjectAppreciation(Number.NaN), "");
});

test("bulletin uses the same appreciation helper for disciplines and sub-subjects", () => {
  const source = readFileSync("src/app/admin/notes/bulletins/page.tsx", "utf8");
  assert.match(source, /hasAvg \? computeSubjectAppreciation\(avg\) : "Non classé"/);
  assert.match(source, /cHasAvg \? computeSubjectAppreciation\(cAvg\) : "Non classé"/);
  assert.match(source, /\{cHasAvg \? formatNumber\(cAvg\) : "NC"\}/);
  assert.match(source, /\{cHasAvg && cRank != null \? \x60\$\{cRank\}e\x60 : "NC"\}/);
});

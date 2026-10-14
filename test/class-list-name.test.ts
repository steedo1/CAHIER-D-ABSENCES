import assert from "node:assert/strict";
import { test } from "node:test";
import { fitClassListName } from "../src/lib/class-list-name";
const measure = (text: string) => text.length * 7;
test("Short full names are preserved", () => {
  assert.equal(fitClassListName({ fullName: "KOFFI Marie" }, 200, measure).text, "KOFFI Marie");
});
test("Compound family names remain intact; the last given names become initials first", () => {
  const result = fitClassListName({ fullName: "KOUASSI N’DRI Marie Angélique Christelle", lastName: "KOUASSI N’DRI", firstName: "Marie Angélique Christelle" }, 240, measure);
  assert.equal(result.text, "KOUASSI N’DRI Marie Angélique C.");
  assert.equal(result.scale, 1);
});
test("Hyphenated given names have readable initials", () => {
  const result = fitClassListName({ fullName: "KOFFI Jean-Michel" }, 90, measure);
  assert.equal(result.text, "KOFFI J.-M.");
});
test("An exceptionally long family name stays intact and fits on one line", () => {
  const result = fitClassListName({ fullName: "UNNOMDEFAMILLEEXCEPTIONNELLEMENTLONG Marie Angélique Christelle", lastName: "UNNOMDEFAMILLEEXCEPTIONNELLEMENTLONG", firstName: "Marie Angélique Christelle" }, 140, measure);
  assert.ok(result.text.startsWith("UNNOMDEFAMILLEEXCEPTIONNELLEMENTLONG"));
  assert.ok(measure(result.text) * result.scale <= 140);
});

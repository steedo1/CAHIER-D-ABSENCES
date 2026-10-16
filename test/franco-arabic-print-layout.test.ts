import assert from "node:assert/strict";
import test from "node:test";
import {
  printableAverageFields,
  selectPrintablePrograms,
} from "../src/lib/franco-arabic-print-layout";

const french = { track: "french" as const, generalAverage: 14.55, label: "Français" };
const arabic = { track: "arabic" as const, generalAverage: 15.75, label: "Arabe" };

test("combined A4 bulletin keeps TWO program averages without calculating a third", () => {
  const sections = selectPrintablePrograms({ french, arabic }, "combined");
  assert.ok(sections);
  assert.equal(sections.length, 2);
  assert.deepEqual(printableAverageFields(sections), { french: 14.55, arabic: 15.75 });
  assert.equal("combinedAverage" in printableAverageFields(sections), false);
  assert.notEqual(sections[0].generalAverage, sections[1].generalAverage);
});

test("single-program A4 views display only the requested teaching results", () => {
  assert.deepEqual(selectPrintablePrograms({ french, arabic }, "french"), [french]);
  assert.deepEqual(selectPrintablePrograms({ french, arabic }, "arabic"), [arabic]);
});

test("missing or mistyped teaching programs fail closed for printing", () => {
  assert.equal(selectPrintablePrograms({ french }, "combined"), null);
  assert.equal(selectPrintablePrograms({ arabic }, "french"), null);
  assert.equal(selectPrintablePrograms({ french: arabic, arabic: french }, "combined"), null);
});

test("an unavailable average is not silently converted to zero", () => {
  const ungraded = { ...arabic, generalAverage: null };
  const view = selectPrintablePrograms({ french, arabic: ungraded }, "combined");
  assert.ok(view);
  assert.equal(printableAverageFields(view).arabic, null);
});

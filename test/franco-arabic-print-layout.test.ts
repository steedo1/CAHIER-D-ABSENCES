import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import {
  printableAverageFields,
  selectPrintablePrograms,
  isSpecializedBulletinPrintable,
} from "../src/lib/franco-arabic-print-layout";

const french = { track: "french" as const, generalAverage: 14.55, label: "Français" };
const arabic = { track: "arabic" as const, generalAverage: 15.75, label: "Arabe" };

test("official print eligibility is independent per program and requires explicit server validation", () => {
  const model = { french: { ...french, denominator: 20 }, arabic: { ...arabic, denominator: 20 } };
  const readiness = { french: true, arabic: false };
  assert.equal(isSpecializedBulletinPrintable(model, readiness, "french"), true);
  assert.equal(isSpecializedBulletinPrintable(model, readiness, "ordinary"), true);
  assert.equal(isSpecializedBulletinPrintable(model, readiness, "arabic"), false);
  assert.equal(isSpecializedBulletinPrintable(model, readiness, "combined"), false);
  assert.equal(isSpecializedBulletinPrintable(model, {}, "french"), false);
  assert.equal(isSpecializedBulletinPrintable({ ...model, sample: true }, readiness, "french"), false);
  assert.equal(isSpecializedBulletinPrintable({ ...model, draft: true }, readiness, "french"), false);
  for (const value of [null, NaN, Infinity, -1, 21]) assert.equal(isSpecializedBulletinPrintable({ french: { ...model.french, generalAverage: value } }, readiness, "french"), false);
  assert.equal(isSpecializedBulletinPrintable({ french: { ...model.french, generalAverage: 0 } }, readiness, "french"), true);
});

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

test("approved print templates contain no red mixed-average warning banner", () => {
  const code = readFileSync(
    new URL("../src/components/bulletins/FrancoArabicBulletin.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(code, /Aucune moyenne franco-arabe globale/i);
  assert.doesNotMatch(code, /bandeau rouge/i);
});

test("an ordinary primary school uses only its normal teaching results", () => {
  const ordinary = selectPrintablePrograms({ french, arabic }, "ordinary");
  assert.ok(ordinary);
  assert.deepEqual(ordinary, [french]);
  assert.deepEqual(printableAverageFields(ordinary), { french: 14.55 });
  const source = readFileSync(
    new URL("../src/components/bulletins/FrancoArabicBulletin.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /variant === "ordinary" \? "Bulletin de notes"/);
  assert.match(source, /ordinary \? "Résultats scolaires"/);
  assert.match(source, /ordinary \? "Moyenne générale"/);
  assert.match(source, /ordinary \? "Direction de l’établissement"/);
});

test("Super Admin has no bulletin editor or preview route", () => {
  const path = (relative: string) => new URL(relative, import.meta.url);
  assert.equal(existsSync(path("../src/app/super/cycles/bulletins-preview/page.tsx")), false);
  assert.equal(existsSync(path("../src/app/api/super/institutions/[id]/franco-arabic-reports/route.ts")), false);
  const superPage = readFileSync(path("../src/app/super/cycles/page.tsx"), "utf8");
  assert.doesNotMatch(superPage, /bulletins-preview|maquettes professionnelles de bulletins/i);
});

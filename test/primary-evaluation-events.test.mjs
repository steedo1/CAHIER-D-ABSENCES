import test from "node:test";
import {
  getEvaluationSettingsScope,
  isVisibleGradingPeriodCycle,
} from "../src/lib/grades/evaluation-settings-scope.ts";
import assert from "node:assert/strict";
import {
  readPrimaryEventsCatalog, validatePrimaryEvents, primaryEventsForClass,
  primaryPassageAverage, primaryEventTitle, parsePrimaryEventTitle,
  PRIMARY_EVENTS_SETTINGS_KEY,
} from "../src/lib/grades/primary-evaluation-events.ts";

const official = {
  code: "DEC", label: "Composition de décembre", kind: "official",
  date: "2026-12-10", tracks: ["french", "arabic"],
  levels: ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"], printBulletin: true,
};
const passage = {
  code: "PASS", label: "Composition de passage", kind: "passage",
  date: "2027-06-03", tracks: ["french"],
  levels: ["CP1", "CP2", "CE1", "CE2", "CM1"], printBulletin: true,
};
const internal = {
  code: "NIV1", label: "Évaluation de niveau", kind: "internal",
  date: "2026-12-03", tracks: ["french", "arabic"],
  levels: ["CP1", "CM2"], printBulletin: true,
};

test("no schema migration: catalog is validated, per-year and school-scoped", () => {
  const validated = validatePrimaryEvents([official, passage, internal], "2026-2027");
  assert.equal(validated.ok, true);
  const settings = { [PRIMARY_EVENTS_SETTINGS_KEY]: {
    version: 1, years: { "2026-2027": { events: [official, passage, internal] } },
  } };
  assert.equal(readPrimaryEventsCatalog(settings).years["2026-2027"].events.length, 3);
  assert.equal(primaryEventsForClass(settings, "2026-2027", "CP1", "french").length, 3);
  assert.equal(primaryEventsForClass(settings, "2026-2027", "CM2", "french").length, 2);
  assert.equal(primaryEventsForClass(settings, "2026-2027", "CP2", "arabic").length, 1);
  assert.equal(primaryEventsForClass(settings, "2025-2026", "CP1", "french").length, 0);
});
test("separate internal from official evaluation marker", () => {
  assert.deepEqual(parsePrimaryEventTitle(primaryEventTitle(official)),
    { kind: "official", code: "DEC" });
  assert.deepEqual(parsePrimaryEventTitle(primaryEventTitle(internal)),
    { kind: "internal", code: "NIV1" });
  assert.equal(parsePrimaryEventTitle("Composition"), null);
  assert.equal(parsePrimaryEventTitle("MCPE:O:../../BAD"), null);
});
test("reject invalid scope, duplicates and CM2 passage", () => {
  assert.equal(validatePrimaryEvents([official, official], "2026-2027").ok, false);
  assert.equal(validatePrimaryEvents([{ ...passage, levels: ["CM2"] }], "2026-2027").ok, false);
  assert.equal(validatePrimaryEvents([{ ...official, date: "2026-02-30" }], "2026-2027").ok, false);
  assert.equal(validatePrimaryEvents([official], "2026-2028").ok, false);
});
test("passage formula ordinary plus twice final divided by three", () => {
  assert.equal(primaryPassageAverage([6, 7, 8], 9), 8.33);
  assert.equal(primaryPassageAverage([], 9), null);
  assert.equal(primaryPassageAverage([7, Number.NaN], 9), null);
  assert.equal(primaryPassageAverage([6, 7], null), null);
});

test("teacher-compatible primary markers do not turn internal events into compositions", async () => {
  const { isPrimaryComposition } = await import("../src/lib/grades/primary-evaluation-kind.ts");
  assert.equal(isPrimaryComposition({ eval_kind: "interro_ecrite", title: primaryEventTitle(official) }), true);
  assert.equal(isPrimaryComposition({ eval_kind: "interro_ecrite", title: primaryEventTitle(passage) }), true);
  assert.equal(isPrimaryComposition({ eval_kind: "devoir", title: primaryEventTitle(internal) }), false);
  assert.equal(isPrimaryComposition({ eval_kind: "interro_ecrite", title: "Interrogation écrite" }), false);
});

test("the existing cycle selector isolates primary events from other period editors", () => {
  const enabled = ["preschool", "primary", "secondary"];
  assert.deepEqual(getEvaluationSettingsScope("primary", enabled), {
    showPrimaryEvents: true, showGradingPeriods: false,
  });
  assert.deepEqual(getEvaluationSettingsScope("secondary", enabled), {
    showPrimaryEvents: false, showGradingPeriods: true,
  });
  assert.deepEqual(getEvaluationSettingsScope("preschool", enabled), {
    showPrimaryEvents: false, showGradingPeriods: true,
  });
  assert.deepEqual(getEvaluationSettingsScope("all", enabled), {
    showPrimaryEvents: true, showGradingPeriods: true,
  });
  assert.deepEqual(getEvaluationSettingsScope("all", ["primary"]), {
    showPrimaryEvents: true, showGradingPeriods: false,
  });
  assert.deepEqual(getEvaluationSettingsScope("all", ["secondary"]), {
    showPrimaryEvents: false, showGradingPeriods: true,
  });
  for (const cycle of enabled) {
    assert.equal(isVisibleGradingPeriodCycle(cycle, "primary", true), false);
    assert.equal(isVisibleGradingPeriodCycle(cycle, "secondary", true), cycle === "secondary");
    assert.equal(isVisibleGradingPeriodCycle(cycle, "preschool", true), cycle === "preschool");
    assert.equal(isVisibleGradingPeriodCycle(cycle, "all", true), cycle !== "primary");
  }
});

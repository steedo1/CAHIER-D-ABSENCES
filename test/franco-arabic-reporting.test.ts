import assert from "node:assert/strict";
import test from "node:test";
import {
  FRANCO_ARABIC_REPORTS_SETTINGS_KEY,
  convertScoreScale,
  defaultFrancoArabicReportsSettings,
  getConfiguredScoringScale,
  parseFrancoArabicReportsSettings,
  validateFrancoArabicReportsInput,
} from "../src/lib/franco-arabic-reporting";

test("existing schools never inherit reporting format or a 20-point barème", () => {
  const legacy = parseFrancoArabicReportsSettings({});
  assert.equal(legacy.enabled, false);
  assert.equal(getConfiguredScoringScale(legacy, "primary", "CM1", "french"), null);
  assert.equal(getConfiguredScoringScale(legacy, "primary", "CP1", "arabic"), null);
  assert.deepEqual(legacy.scales, []);
});

test("French and Arabic barèmes and report formats remain independent", () => {
  const stored = {
    [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: {
      version: 1,
      enabled: true,
      format: "both",
      scales: [
        { cycle: "primary", level: "CP1", track: "french", maxScore: 10 },
        { cycle: "primary", level: "CP1", track: "arabic", maxScore: 20 },
        { cycle: "primary", level: "CM1", track: "french", maxScore: 20 },
      ],
    },
  };
  const settings = parseFrancoArabicReportsSettings(stored);
  assert.equal(settings.enabled, true);
  assert.equal(settings.format, "both");
  assert.equal(getConfiguredScoringScale(settings, "primary", " CP1 ", "french"), 10);
  assert.equal(getConfiguredScoringScale(settings, "primary", "CP1", "arabic"), 20);
  assert.equal(getConfiguredScoringScale(settings, "primary", "CM1", "french"), 20);
  assert.equal(getConfiguredScoringScale(settings, "secondary", "CP1", "french"), null);
  assert.equal(getConfiguredScoringScale(settings, "primary", "CM1", "arabic"), null);
});

test("unknown or malformed configuration is rejected rather than partly activated", () => {
  const sample = {
    enabled: true, format: "combined",
    scales: [{ cycle: "primary", level: "CP1", track: "french", maxScore: 10 }],
  };
  assert.equal(validateFrancoArabicReportsInput({ ...sample, format: "surprise" }), null);
  assert.equal(validateFrancoArabicReportsInput({
    ...sample, scales: [{ cycle: "primary", level: "CP1", track: "french", maxScore: 0 }],
  }), null);
  assert.equal(validateFrancoArabicReportsInput({
    ...sample, scales: [sample.scales[0], { ...sample.scales[0], level: "cp1" }],
  }), null);
  assert.equal(validateFrancoArabicReportsInput({
    ...sample, scales: [{ cycle: "primary", level: "CP1", track: "other", maxScore: 20 }],
  }), null);
  const disabled = validateFrancoArabicReportsInput({
    enabled: false, format: "both", scales: [],
  });
  assert.deepEqual(disabled, defaultFrancoArabicReportsSettings());
});

test("score conversion works without mutating source values and validates bounds", () => {
  assert.equal(convertScoreScale(7.5, 10, 20), 15);
  assert.equal(convertScoreScale(15, 20, 10), 7.5);
  assert.equal(convertScoreScale(0, 10, 20), 0);
  assert.equal(convertScoreScale(11, 10, 20), null);
  assert.equal(convertScoreScale(-1, 10, 20), null);
  assert.equal(convertScoreScale(8, 0, 20), null);
  assert.equal(convertScoreScale(Number.NaN, 10, 20), null);
});

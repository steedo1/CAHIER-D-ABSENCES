import assert from "node:assert/strict";
import test from "node:test";
import {
  SCHOOL_CYCLES_SETTINGS_KEY,
  getDefaultSchoolCyclesSettings,
  groupScopedClassesByCycle,
  inferSchoolCycleFromLevel,
  parseSchoolCyclesSettings,
  resolveSchoolCycleForClass,
} from "../src/lib/school-cycles";

const classId = "11111111-1111-4111-8111-111111111111";

test("legacy schools stay secondary even for a CP1-looking class", () => {
  const settings = parseSchoolCyclesSettings(null);
  assert.equal(settings.enabled, false);
  assert.equal(resolveSchoolCycleForClass({ id: classId, level: "CP1" }, settings), "secondary");
});

test("pilot cycles require explicit institution-level opt-in", () => {
  const malformed = {
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1,
      enabled: true,
      enabledCycles: ["invalid-cycle"],
    },
  };
  assert.equal(parseSchoolCyclesSettings(malformed).enabled, false);

  const enabled = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1,
      enabled: true,
      enabledCycles: ["preschool", "primary", "secondary"],
      preferredLanguage: "ar",
      classCycleById: {},
    },
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.preferredLanguage, "ar");
  assert.equal(resolveSchoolCycleForClass({ id: classId, level: "CE2" }, enabled), "primary");
  assert.equal(resolveSchoolCycleForClass({ id: classId, level: "GS" }, enabled), "preschool");
  assert.equal(resolveSchoolCycleForClass({ id: classId, level: "3e" }, enabled), "secondary");
});

test("explicit class mapping supports custom franco-Arabic levels", () => {
  const settings = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1,
      enabled: true,
      enabledCycles: ["primary", "secondary"],
      classCycleById: { [classId]: "primary", "not-a-uuid": "preschool" },
      preferredLanguage: "fr",
    },
  });
  assert.equal(resolveSchoolCycleForClass({ id: classId, level: "Niveau arabe A" }, settings), "primary");
  assert.equal(settings.classCycleById["not-a-uuid"], undefined);
});

test("unambiguous preschool/primary codes are recognized", () => {
  assert.equal(inferSchoolCycleFromLevel("Petite section"), "preschool");
  assert.equal(inferSchoolCycleFromLevel("CM2"), "primary");
  assert.equal(inferSchoolCycleFromLevel("Maternelle"), "preschool");
  assert.equal(inferSchoolCycleFromLevel("6ème"), "secondary");
  assert.equal(inferSchoolCycleFromLevel("3ème"), "secondary");
  assert.equal(inferSchoolCycleFromLevel("1re D"), "secondary");
  assert.equal(inferSchoolCycleFromLevel(""), null);
});

test("aggregation never includes another institution or school year", () => {
  const settings = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1,
      enabled: true,
      enabledCycles: ["preschool", "primary", "secondary"],
      classCycleById: {},
    },
  });
  const rows = [
    { id: classId, institution_id: "school-a", academic_year: "2026-2027", level: "CP1" },
    { id: "22222222-2222-4222-8222-222222222222", institution_id: "school-b", academic_year: "2026-2027", level: "GS" },
    { id: "33333333-3333-4333-8333-333333333333", institution_id: "school-a", academic_year: "2025-2026", level: "6e" },
  ];
  const groups = groupScopedClassesByCycle(rows, "school-a", "2026-2027", settings);
  assert.equal(groups.primary.length, 1);
  assert.equal(groups.preschool.length, 0);
  assert.equal(groups.secondary.length, 0);
});

test("defaults are fresh objects, not mutable shared singletons", () => {
  const one = getDefaultSchoolCyclesSettings();
  one.enabledCycles.push("preschool");
  assert.deepEqual(getDefaultSchoolCyclesSettings().enabledCycles, ["secondary"]);
});

test("per-cycle teaching tracks are independent of interface language", () => {
  const settings = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1,
      enabled: true,
      enabledCycles: ["preschool", "primary", "secondary"],
      teachingTracksByCycle: {
        preschool: ["french", "arabic"],
        primary: ["french", "arabic"],
        secondary: ["arabic"],
      },
      defaultView: "primary",
      preferredLanguage: "fr",
    },
  });
  assert.deepEqual(settings.teachingTracksByCycle.primary, ["french", "arabic"]);
  assert.deepEqual(settings.teachingTracksByCycle.secondary, ["arabic"]);
  assert.equal(settings.defaultView, "primary");
  assert.equal(settings.preferredLanguage, "fr");
});

test("disabled or malformed options cannot activate school cycles", () => {
  const legacy = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1,
      enabled: false,
      enabledCycles: ["primary"],
      teachingTracksByCycle: { primary: ["arabic"] },
    },
  });
  assert.equal(legacy.enabled, false);
  assert.deepEqual(legacy.enabledCycles, ["secondary"]);
  const invalidView = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1,
      enabled: true,
      enabledCycles: ["primary"],
      defaultView: "preschool",
      teachingTracksByCycle: { primary: ["arabic", "invalid-track"] },
    },
  });
  assert.equal(invalidView.defaultView, "all");
  assert.deepEqual(invalidView.teachingTracksByCycle.primary, ["arabic"]);
});

test("subject teaching classifications are scoped by cycle and allowed programs", () => {
  const subject = "11111111-1111-4111-8111-111111111111";
  const settings = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1,
      enabled: true,
      enabledCycles: ["primary", "secondary"],
      teachingTracksByCycle: {
        primary: ["french", "arabic"],
        secondary: ["arabic"],
      },
      subjectTracksByCycle: {
        primary: { [subject]: ["french", "arabic", "untrusted"] },
        secondary: { [subject]: ["french", "arabic"], "not-a-uuid": ["arabic"] },
      },
      defaultView: "all",
    },
  });
  assert.deepEqual(settings.subjectTracksByCycle.primary?.[subject], ["french", "arabic"]);
  assert.deepEqual(settings.subjectTracksByCycle.secondary?.[subject], ["arabic"]);
  assert.equal(settings.subjectTracksByCycle.secondary?.["not-a-uuid"], undefined);
});

test("schools without subject mappings remain safely empty", () => {
  const settings = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      version: 1, enabled: true,
      enabledCycles: ["primary"],
      teachingTracksByCycle: { primary: ["french", "arabic"] },
    },
  });
  assert.deepEqual(settings.subjectTracksByCycle.primary, {});
  assert.equal(getDefaultSchoolCyclesSettings().subjectTracksByCycle.primary, undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessScopedTeachingResource,
  canAccessSchoolWideAdministration,
} from "../src/lib/school-director-scope";
import {
  parseSchoolCyclesSettings,
  SCHOOL_CYCLES_SETTINGS_KEY,
} from "../src/lib/school-cycles";

const arabicId = "11111111-1111-4111-8111-111111111111";
const bothId = "22222222-2222-4222-8222-222222222222";
const frenchId = "33333333-3333-4333-8333-333333333333";

const settings = parseSchoolCyclesSettings({
  [SCHOOL_CYCLES_SETTINGS_KEY]: {
    version: 1,
    enabled: true,
    enabledCycles: ["primary", "secondary"],
    teachingTracksByCycle: {
      primary: ["french", "arabic"],
      secondary: ["french", "arabic"],
    },
    subjectTracksByCycle: {
      primary: {
        [arabicId]: ["arabic"],
        [bothId]: ["arabic", "french"],
        [frenchId]: ["french"],
      },
    },
  },
});

test("Arabic director cannot read French-only or unknown subjects", () => {
  const ar = { kind: "teaching_track", track: "arabic" } as const;
  assert.equal(canAccessScopedTeachingResource(settings, ar, {
    cycle: "primary", subjectId: arabicId,
  }), true);
  assert.equal(canAccessScopedTeachingResource(settings, ar, {
    cycle: "primary", subjectId: frenchId,
  }), false);
  assert.equal(canAccessScopedTeachingResource(settings, ar, {
    cycle: "secondary", subjectId: arabicId,
  }), false);
  assert.equal(canAccessScopedTeachingResource(settings, ar, {
    cycle: "primary", subjectId: "unknown",
  }), false);
  assert.equal(canAccessSchoolWideAdministration(ar), false);
});

test("A dual-program subject is accessible by either teaching director", () => {
  for (const track of ["french", "arabic"] as const) {
    assert.equal(canAccessScopedTeachingResource(settings,
      { kind: "teaching_track", track },
      { cycle: "primary", subjectId: bothId }), true);
  }
});

test("School-wide access respects enabled cycles, legacy scoped access denied", () => {
  assert.equal(canAccessScopedTeachingResource(settings, { kind: "school_wide" }, {
    cycle: "preschool", subjectId: arabicId,
  }), false);
  assert.equal(canAccessSchoolWideAdministration({ kind: "school_wide" }), true);
  const legacy = parseSchoolCyclesSettings({});
  assert.equal(canAccessScopedTeachingResource(legacy, {
    kind: "teaching_track", track: "french",
  }, { cycle: "secondary", subjectId: frenchId }), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  SCHOOL_PROGRAM_PERIODS_KEY, readProgramPeriods,
  periodsForProgram, validateProgramPeriods,
} from "../src/lib/school-program-periods";
import { mergeGeneralSchoolSettings } from "../src/lib/school-settings-write";

const sample = {
  code: "T1", label: "1er trimestre", shortLabel: "Trim. 1",
  kind: "trimester", startDate: "2026-09-10", endDate: "2026-12-18", active: true,
} as const;

test("preschool and primary periods forbid coefficients or weights", () => {
  assert.deepEqual(validateProgramPeriods("primary", [sample]), [sample]);
  assert.equal(validateProgramPeriods("primary", [{ ...sample, weight: 2 }]), null);
  assert.equal(validateProgramPeriods("preschool", [{ ...sample, weight: 1 }]), null);
  assert.deepEqual(validateProgramPeriods("secondary", [{ ...sample, weight: 2 }]), [{ ...sample, weight: 2 }]);
});

test("French/Arabic periods are isolated within each cycle and academic year", () => {
  const settings = {
    [SCHOOL_PROGRAM_PERIODS_KEY]: {
      version: 1, years: {
        "2026-2027": {
          preschool: { french: [sample] },
          primary: {
            french: [sample],
            arabic: [{ ...sample, code: "S1", label: "1er semestre", shortLabel: "S1", kind: "semester" }],
          },
          secondary: { french: [{ ...sample, weight: 1.5 }] },
        },
      },
    },
  };
  assert.equal(periodsForProgram(settings, "2026-2027", "primary", "arabic")[0].code, "S1");
  assert.equal(periodsForProgram(settings, "2026-2027", "primary", "french")[0].code, "T1");
  assert.equal(periodsForProgram(settings, "2026-2027", "secondary", "french")[0].weight, 1.5);
  assert.equal(periodsForProgram(settings, "2026-2027", "secondary", "arabic").length, 0);
  assert.equal(periodsForProgram(settings, "2027-2028", "primary", "french").length, 0);
  assert.ok(readProgramPeriods(settings).years["2026-2027"]);
  assert.equal(mergeGeneralSchoolSettings({}, settings), null);
  assert.equal(mergeGeneralSchoolSettings(settings, { [SCHOOL_PROGRAM_PERIODS_KEY]: null }), null);
});

test("invalid periods and duplicate codes never survive validation", () => {
  assert.equal(validateProgramPeriods("primary", [sample, { ...sample, code: "t1" }]), null);
  assert.equal(validateProgramPeriods("primary", [{ ...sample, startDate: "2026-02-30" }]), null);
  assert.equal(validateProgramPeriods("primary", [{ ...sample, endDate: "2026-01-01" }]), null);
  assert.equal(validateProgramPeriods("secondary", [{ ...sample, weight: -1 }]), null);
  assert.equal(validateProgramPeriods("primary", [{ ...sample, kind: "unknown" }]), null);
  assert.equal(validateProgramPeriods("primary", [{ ...sample, code: " " }]), null);
});

test("unconfigured schools and years never receive invented periods", () => {
  assert.deepEqual(readProgramPeriods({}), { version: 1, years: {} });
  assert.deepEqual(periodsForProgram(null, "2026-2027", "preschool", "french"), []);
  assert.deepEqual(readProgramPeriods({ [SCHOOL_PROGRAM_PERIODS_KEY]: { version: 0 } }), { version: 1, years: {} });
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  isScopedDashboardSelection,
  resolveScopedDashboardCounts,
  type CycleDashboardSummary,
} from "../src/lib/multicycle-dashboard";
import type { SchoolNavigationContext } from "../src/lib/school-navigation";

const all: SchoolNavigationContext = { cycle: "all", track: "all", level: "", classId: "" };
const summary: CycleDashboardSummary = {
  ok: true,
  enabled: true,
  academicYear: "2026-2027",
  cycles: {
    primary: { count: 3, students: 42, teachers: 10 },
    secondary: { count: 2, students: 31, teachers: 8 },
  },
  programs: {
    primary: { arabic: { uniqueTeachers: 4 }, french: { uniqueTeachers: 7 } },
    secondary: { arabic: { uniqueTeachers: 2 }, french: { uniqueTeachers: 6 } },
  },
};

test("unfiltered view stays with established school-wide metrics", () => {
  assert.equal(isScopedDashboardSelection(all), false);
  assert.equal(isScopedDashboardSelection({ ...all, track: "arabic" }), true);
});

test("a selected cycle uses deduplicated roster counts, not sums across programs", () => {
  assert.deepEqual(
    resolveScopedDashboardCounts({ ...all, cycle: "primary" }, summary),
    { classes: 3, students: 42, teachers: 10 },
  );
});

test("Arabic/French classroom membership is not guessed from mixed classes", () => {
  for (const track of ["arabic", "french"] as const) {
    const numbers = resolveScopedDashboardCounts({ ...all, cycle: "primary", track }, summary);
    assert.equal(numbers.classes, null);
    assert.equal(numbers.students, null);
    assert.equal(numbers.teachers, track === "arabic" ? 4 : 7);
  }
});

test("cross-cycle union and level/class filters never fabricate counts", () => {
  const empty = { classes: null, students: null, teachers: null };
  assert.deepEqual(resolveScopedDashboardCounts({ ...all, track: "arabic" }, summary), empty);
  assert.deepEqual(resolveScopedDashboardCounts({ ...all, cycle: "primary", level: "CM2" }, summary), empty);
  assert.deepEqual(resolveScopedDashboardCounts({ ...all, cycle: "primary", classId: "p1" }, summary), empty);
});

test("missing/incomplete authoritative data is unknown, not zero", () => {
  const unknown = { classes: null, students: null, teachers: null };
  assert.deepEqual(resolveScopedDashboardCounts({ ...all, cycle: "primary" }, null), unknown);
  assert.deepEqual(resolveScopedDashboardCounts({ ...all, cycle: "primary" }, { enabled: true, ok: false }), unknown);
  assert.deepEqual(resolveScopedDashboardCounts({ ...all, cycle: "primary" }, {
    ok: true, enabled: true, cycles: { primary: { count: -1, students: NaN, teachers: 2 } },
  }), { classes: null, students: null, teachers: 2 });
});

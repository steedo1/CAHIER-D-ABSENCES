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
    primary: {
      arabic: { uniqueTeachers: 4, subjects: [{ id: "arabic-subject", name: "Coran" }] },
      french: { uniqueTeachers: 7, subjects: [{ id: "french-subject", name: "Mathématiques" }] },
    },
    secondary: {
      arabic: { uniqueTeachers: 2, subjects: [{ id: "arabic-subject", name: "Coran" }] },
      french: { uniqueTeachers: 6, subjects: [{ id: "french-subject", name: "Mathématiques" }] },
    },
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

test("an unmapped teaching program must not report zero teachers as a confirmed value", () => {
  const incomplete: CycleDashboardSummary = {
    ok: true, enabled: true,
    cycles: { primary: { count: 3, students: 42, teachers: 10 } },
    programs: { primary: { arabic: { uniqueTeachers: 0, subjects: [] } } },
  };
  assert.equal(
    resolveScopedDashboardCounts({ ...all, cycle: "primary", track: "arabic" }, incomplete).teachers,
    null,
  );
});

test("exact French/Arabic student counters activate only when the entire cycle roster is classified", () => {
  const withPrograms: CycleDashboardSummary = {
    ...summary,
    studentPrograms: {
      primary: {
        french: { students: 31, classes: 3, complete: true, unclassifiedStudents: 0 },
        arabic: { students: 26, classes: 2, complete: true, unclassifiedStudents: 0 },
      },
    },
  };
  assert.deepEqual(
    resolveScopedDashboardCounts({ ...all, cycle: "primary", track: "arabic" }, withPrograms),
    { classes: 2, students: 26, teachers: 4 },
  );
  withPrograms.studentPrograms!.primary!.french!.complete = false;
  assert.equal(resolveScopedDashboardCounts({ ...all, cycle: "primary", track: "french" }, withPrograms).students, null);
});

test("whole-school teaching filter uses unique school totals, not a sum of cycle averages", () => {
  const withPrograms: CycleDashboardSummary = {
    ...summary,
    studentProgramTotals: {
      arabic: { students: 33, classes: 5, complete: true, unclassifiedStudents: 0 },
      french: { students: 45, classes: 6, complete: false, unclassifiedStudents: 2 },
    },
    programTeacherTotals: {
      arabic: { uniqueTeachers: 8 }, french: { uniqueTeachers: 12 },
    },
  };
  assert.deepEqual(resolveScopedDashboardCounts({ ...all, track: "arabic" }, withPrograms),
    { classes: 5, students: 33, teachers: 8 });
  assert.deepEqual(resolveScopedDashboardCounts({ ...all, track: "french" }, withPrograms),
    { classes: null, students: null, teachers: 12 });
});

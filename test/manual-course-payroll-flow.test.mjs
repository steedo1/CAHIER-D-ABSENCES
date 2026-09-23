import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const statisticsSource = read("src/app/api/admin/statistics/route.ts");
const payrollSource = read("src/app/admin/finance/payroll/page.tsx");
const payrollValuesSource = read("src/lib/finance/payroll-values.ts");

function functionSource(source, name) {
  const file = ts.createSourceFile(`${name}.ts`, source, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(declaration, `Missing function ${name}`);
  return declaration.getText(file);
}

function sourceBetween(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source block ${start}`);
  return source.slice(first, last);
}

function evaluate(source, args = [], values = []) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", ...args, code)(exports, ...values);
  return exports;
}

const { aggregateSessions } = evaluate(`
  ${functionSource(statisticsSource, "isCallWithinPlannedSlot")}
  const pad2 = (n: number) => String(n).padStart(2, "0");
  export function aggregateSessions(sessRows: any[]) {
    ${sourceBetween(statisticsSource,
      "const seen = new Set<string>();",
      "/* ======================== SUMMARY")}
    return sessions;
  }
`);

const payrollValues = evaluate(payrollValuesSource);
const { classifyExtraSessions } = evaluate(`
  ${functionSource(payrollSource, "numberValue")}
  ${functionSource(payrollSource, "cycleFromLevel")}
  export function classifyExtraSessions(
    actualRows: any[], usedRows: Set<number>, payrollAssignments: any[],
    classMap: Map<string, any>,
    canonicalSubjectByInstitutionId = new Map<string, string>(),
  ) {
    const sessionReferenceMinutes = 55;
    const rateFirst = 1500;
    const rateSecond = 2000;
    const lateToleranceMin = 15;
    const earlyDepartureToleranceMin = 5;
    ${sourceBetween(payrollSource,
      "const horsEdtItems = actualRows.flatMap",
      "const sessionItems =")}
    return horsEdtItems;
  }
`, ["assignmentCoversDay", "calculatePayrollSession"], [
  payrollValues.assignmentCoversDay,
  payrollValues.calculatePayrollSession,
]);

const day = "2026-09-22";
function manualSession(id, classId, start, end, teacherId = "teacher-eps") {
  return {
    id,
    teacher_id: teacherId,
    class_id: classId,
    subject_id: "eps",
    started_at: `${day}T${start}:00.000Z`,
    actual_call_at: `${day}T${start}:00.000Z`,
    ended_at: `${day}T${end}:00.000Z`,
    expected_minutes: 55,
    status: "closed",
    origin: "class_device",
  };
}

function payrollRows(sessions) {
  return sessions.map((session) => ({
    dateISO: session.started_at,
    class_id: session.class_id,
    class_ids: session.class_ids,
    subject_id: session.subject_id,
    subject_ids: session.subject_ids,
    class_subject_pairs: session.class_subject_pairs,
    actual_call_iso: session.actual_call_at,
    ended_at: session.ended_at,
    expected_minutes: session.expected_minutes,
    late_minutes: 0,
    observed_minutes: 54,
    real_minutes: 54,
  }));
}

const assignments = ["5e2", "5e3"].map((classId) => ({
  class_id: classId, subject_id: "eps", start_date: "2026-09-01", end_date: null,
}));
const classMap = new Map([
  ["5e2", { level: "5e" }],
  ["5e3", { level: "5e" }],
]);

test("grouped manual classes started a minute apart produce one payable physical lesson", () => {
  const sessions = aggregateSessions([
    manualSession("first", "5e2", "09:06", "10:00"),
    manualSession("second", "5e3", "09:07", "10:00"),
  ]);
  assert.equal(sessions.length, 1);
  assert.deepEqual(new Set(sessions[0].class_ids), new Set(["5e2", "5e3"]));
  const payroll = classifyExtraSessions(payrollRows(sessions), new Set(), assignments, classMap);
  assert.equal(payroll.length, 1);
  assert.equal(payroll[0].counted_for_pay, true);
  assert.equal(payroll[0].adjusted_amount, 1500);
});

test("sequential manual lessons remain two distinct payable lessons", () => {
  const sessions = aggregateSessions([
    manualSession("first", "5e2", "09:00", "09:30"),
    manualSession("second", "5e3", "09:31", "10:00"),
  ]);
  assert.equal(sessions.length, 2);
  const payroll = classifyExtraSessions(payrollRows(sessions), new Set(), assignments, classMap);
  assert.equal(payroll.length, 2);
});

test("two separate lessons with a brief timetable overlap still pay separately", () => {
  const sessions = aggregateSessions([
    manualSession("first", "5e2", "09:00", "09:35"),
    manualSession("second", "5e3", "09:30", "10:05"),
  ]);
  assert.equal(sessions.length, 2);
  const payroll = classifyExtraSessions(payrollRows(sessions), new Set(), assignments, classMap);
  assert.equal(payroll.length, 2);
});

test("substantially overlapping but shifted lessons do not merge into one vacation", () => {
  const sessions = aggregateSessions([
    manualSession("first", "5e2", "09:00", "10:00"),
    manualSession("second", "5e3", "09:30", "10:30"),
    manualSession("third", "5e2", "10:00", "11:00"),
  ]);
  assert.equal(sessions.length, 3);
});

test("a short lesson contained within a longer one remains a distinct vacation", () => {
  const sessions = aggregateSessions([
    manualSession("long", "5e2", "09:00", "10:00"),
    manualSession("short", "5e3", "09:20", "09:30"),
  ]);
  assert.equal(sessions.length, 2);
});

test("nearby grouped starts cannot bridge lessons separated by more than ten minutes", () => {
  const sessions = aggregateSessions([
    manualSession("first", "5e2", "09:00", "10:00"),
    manualSession("second", "5e3", "09:09", "10:09"),
    manualSession("third", "5e2", "09:18", "10:18"),
  ]);
  assert.equal(sessions.length, 2);
});

test("another teacher never shares a payable lesson", () => {
  const sessions = aggregateSessions([
    manualSession("first", "5e2", "09:06", "10:00"),
    manualSession("second", "5e3", "09:07", "10:00", "teacher-other"),
  ]);
  assert.equal(sessions.length, 2);
});

test("unassigned or unfinished manual lessons are not paid", () => {
  const unassigned = payrollRows(aggregateSessions([
    manualSession("unassigned", "5e2", "11:00", "11:55"),
  ]));
  assert.equal(classifyExtraSessions(unassigned, new Set(), [], classMap).length, 0);
  const unfinished = [{ ...unassigned[0], ended_at: null }];
  assert.equal(classifyExtraSessions(unfinished, new Set(), assignments, classMap).length, 0);
});

test("a grouped lesson uses its valid class and subject pair, regardless of row order", () => {
  const sessions = aggregateSessions([
    manualSession("first", "5e2", "09:06", "10:00"),
    manualSession("second", "5e3", "09:07", "10:00"),
  ]);
  const payroll = classifyExtraSessions(
    payrollRows(sessions), new Set(), [assignments[1]], classMap,
  );
  assert.equal(payroll.length, 1);
  assert.equal(payroll[0].class_id, "5e3");
  assert.equal(payroll[0].counted_for_pay, true);
});

test("a grouped lesson spanning payroll cycles requires review instead of choosing a rate", () => {
  const sessions = aggregateSessions([
    manualSession("first", "5e2", "09:06", "10:00"),
    manualSession("second", "5e3", "09:07", "10:00"),
  ]);
  const mixedCycles = new Map(classMap);
  mixedCycles.set("5e3", { level: "2nde" });
  assert.throws(
    () => classifyExtraSessions(payrollRows(sessions), new Set(), assignments, mixedCycles),
    /cycles différents/,
  );
});

test("a class and a subject from different grouped sessions cannot form a false assignment", () => {
  const sessions = aggregateSessions([
    manualSession("first", "5e2", "09:06", "10:00"),
    { ...manualSession("second", "5e3", "09:07", "10:00"), subject_id: "math" },
  ]);
  const falseAssignment = [{ class_id: "5e2", subject_id: "math", start_date: "2026-09-01" }];
  assert.equal(classifyExtraSessions(payrollRows(sessions), new Set(), falseAssignment, classMap).length, 0);
});

test("historical canonical subject assignment is accepted for a closed manual lesson", () => {
  const sessions = aggregateSessions([manualSession("first", "5e2", "11:00", "11:55")]);
  const canonicalAssignment = [{ class_id: "5e2", subject_id: "subject-eps", start_date: "2026-09-01" }];
  const subjectAliases = new Map([["eps", "subject-eps"]]);
  const payroll = classifyExtraSessions(
    payrollRows(sessions), new Set(), canonicalAssignment, classMap, subjectAliases,
  );
  assert.equal(payroll.length, 1);
  assert.equal(payroll[0].counted_for_pay, true);
});

test("planned payroll matches a real class and subject pair, not two unrelated grouped values", () => {
  const observed = {
    ...payrollRows(aggregateSessions([
      manualSession("first", "5e2", "09:00", "09:55"),
      { ...manualSession("second", "5e3", "09:00", "09:55"), subject_id: "math" },
    ]))[0],
    period_id: "period-one",
  };
  const expected = {
    session_date: day,
    period_id: "period-one",
    class_id: "5e2",
    class_ids: ["5e2"],
    subject_id: "math",
    subject_ids: ["math"],
    class_subject_pairs: [{ class_id: "5e2", subject_id: "math" }],
    start_time: "09:00:00",
  };
  assert.equal(payrollValues.findPayrollSession([observed], new Set(), expected), null);
});

test("5e2 EPS synced after offline capture pays one planned lesson after closure", () => {
  const captured = manualSession("offline-open-operation", "5e2", "09:05", "10:00");
  const sessions = aggregateSessions([captured, { ...captured }]);
  assert.equal(sessions.length, 1);
  const actualRows = payrollRows(sessions);
  const slot = {
    session_date: day,
    period_id: "csca-monday-0905",
    class_id: "5e2",
    class_ids: ["5e2"],
    subject_id: "eps",
    subject_ids: ["eps"],
    class_subject_pairs: [{ class_id: "5e2", subject_id: "eps" }],
    start_time: "09:05:00",
  };
  const usedRows = new Set();
  const matched = payrollValues.findPayrollSession(actualRows, usedRows, slot);
  assert.equal(matched, actualRows[0]);
  const planned = payrollValues.calculatePayrollSession(matched, 55, 55, 1500, 15, 5);
  const extra = classifyExtraSessions(actualRows, usedRows, assignments, classMap);
  assert.equal(planned.counted_for_pay, true);
  assert.equal(planned.adjusted_amount, 1500);
  assert.equal(extra.length, 0);
  assert.equal(usedRows.size, 1);
});

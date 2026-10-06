import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, dependencies = {}) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  });
  return exports;
}

const permanents = load("src/lib/finance/payroll-permanents.ts");
const { calculatePayrollSession } = load("src/lib/finance/payroll-values.ts");
const { savePermanentCycle } = load("src/lib/finance/payroll-settings.ts", { "./payroll-permanents": permanents });
const { allocatePermanentOvertime, expectedPermanentOvertime, payrollFullWeeks,
  permanentCycle, permanentWeeklyQuota, permanentCyclesFromSettings,
  settingsWithPermanentCycle, permanentPayrollSnapshot, payrollTeacherRate } = permanents;

function lesson(index, day = "2026-10-05", rate = 1500, late = 0) {
  const time = `${String(7 + Math.floor(index / 6)).padStart(2, "0")}:${String(index % 6 * 10).padStart(2, "0")}:00`;
  return {
    session_date: day, start_time: time, period_id: `period-${index}`,
    ...calculatePayrollSession({ dateISO: `${day}T${time}Z`, real_minutes: 55 - late,
      late_minutes: late, observed_minutes: 55 - late,
      actual_call_iso: `${day}T${time}Z`, ended_at: `${day}T23:59:00Z` },
    55, 55, rate, 15, 5),
  };
}

const lessons = (count, day, rate) => Array.from({ length: count }, (_, i) => lesson(i, day, rate));
const net = (rows) => rows.reduce((sum, row) => sum + row.adjusted_amount, 0);

test("college quota 21: 21 hours pay zero and 24 hours pay three vacations", () => {
  assert.equal(permanentWeeklyQuota("college"), 21);
  assert.equal(net(allocatePermanentOvertime(lessons(21), "college")), 0);
  const rows = allocatePermanentOvertime(lessons(24), "college");
  assert.equal(rows.filter((row) => row.counted_for_pay).length, 3);
  assert.equal(net(rows), 4500);
  assert.equal(rows.filter((row) => row.service_held).length, 24);
});

test("lycee quota 18: 18 hours pay zero and 22 hours pay four vacations", () => {
  assert.equal(permanentWeeklyQuota("lycee"), 18);
  assert.equal(net(allocatePermanentOvertime(lessons(18, undefined, 2000), "lycee")), 0);
  assert.equal(net(allocatePermanentOvertime(lessons(22, undefined, 2000), "lycee")), 8000);
});

test("one quota covers both school cycles and lycée permanent overtime uses lycée rate only", () => {
  const rows = [...lessons(18),
    lesson(18, "2026-10-05", payrollTeacherRate("permanent", "lycee", "second_cycle", 1500, 2000)),
    lesson(19, "2026-10-05", payrollTeacherRate("permanent", "lycee", "first_cycle", 1500, 2000))];
  assert.equal(net(allocatePermanentOvertime(rows.reverse(), "lycee")), 4000);
  assert.equal(net(allocatePermanentOvertime(rows, "college")), 0);
});

test("permanent category has one rate while vacation rates still follow each class cycle", () => {
  for (const classCycle of ["first_cycle", "second_cycle"]) {
    assert.equal(payrollTeacherRate("permanent", "college", classCycle, 1500, 2000), 1500);
    assert.equal(payrollTeacherRate("permanent", "lycee", classCycle, 1500, 2000), 2000);
  }
  assert.equal(payrollTeacherRate("vacataire", null, "first_cycle", 1500, 2000), 1500);
  assert.equal(payrollTeacherRate("vacataire", null, "second_cycle", 1500, 2000), 2000);
  assert.throws(() => payrollTeacherRate("permanent", null, "first_cycle", 1500, 2000), /renseigner/);
});

test("weekly reset does not pool two under-quota weeks into monthly overtime", () => {
  const rows = [...lessons(18, "2026-10-05"), ...lessons(18, "2026-10-12")];
  assert.equal(net(allocatePermanentOvertime(rows, "lycee")), 0);
  assert.equal(net(allocatePermanentOvertime([...rows, lesson(18, "2026-10-12")], "lycee")), 1500);
});

test("month boundary shares the same quota and credits overtime to its own month only", () => {
  assert.deepEqual(payrollFullWeeks("2026-10-01", "2026-10-31"),
    { periodStart: "2026-09-28", periodEnd: "2026-11-01" });
  const rows = [...lessons(18, "2026-09-30"), ...lessons(3, "2026-10-01")];
  const allocated = allocatePermanentOvertime(rows, "lycee");
  assert.equal(net(allocated.filter((row) => row.session_date < "2026-10-01")), 0);
  assert.equal(net(allocated.filter((row) => row.session_date >= "2026-10-01")), 4500);
});

test("absence or unfinished session never consumes quota or deducts from fixed salary", () => {
  const missing = { ...lesson(0), ...calculatePayrollSession(null, 55, 55, 1500, 15, 5) };
  const rows = allocatePermanentOvertime([missing, ...lessons(18)], "lycee");
  assert.equal(net(rows), 0);
  assert.equal(rows.reduce((sum, row) => sum + row.lost_amount, 0), 0);
  assert.equal(rows.filter((row) => row.service_held).length, 18);
});

test("overtime lateness retains existing vacation tolerance and exact deduction", () => {
  const overtime = lesson(18, "2026-10-05", 2000, 20);
  const rows = allocatePermanentOvertime([...lessons(18), overtime], "lycee");
  assert.equal(rows.at(-1).lost_amount, 182);
  assert.equal(net(rows), 1818);
  assert.equal(rows.at(-1).lost_minutes_after_tolerance, 5);
});

test("planned overtime is kept separate from actual overtime when regular lessons were missed", () => {
  assert.equal(expectedPermanentOvertime(lessons(22), "college").length, 1);
  assert.equal(net(allocatePermanentOvertime(lessons(20), "college")), 0);
});

test("settings preserve unrelated fields, other teachers, and explicit unconfigured profiles", () => {
  const before = { logo: "unchanged", teacher_payroll: { rate: 123, permanent_cycles: { other: "lycee" } } };
  const after = settingsWithPermanentCycle(before, "teacher", "college");
  assert.equal(after.logo, "unchanged");
  assert.equal(after.teacher_payroll.rate, 123);
  assert.deepEqual(permanentCyclesFromSettings(after), { other: "lycee", teacher: "college" });
  assert.deepEqual(permanentCyclesFromSettings(before), { other: "lycee" });
  assert.deepEqual(permanentCyclesFromSettings(settingsWithPermanentCycle(after, "teacher", null)), { other: "lycee" });
  for (const value of [undefined, null, "", "permanent", "second_cycle"]) assert.equal(permanentCycle(value), null);
});

test("payroll snapshot retains category and quota even after the current profile changes", () => {
  const snapshot = { kind: "permanent_overtime_v1", cycle: "college", weekly_quota: 21,
    service_sessions: 24, overtime_sessions: 3, expected_overtime_sessions: 3, notes: "note" };
  assert.deepEqual(permanentPayrollSnapshot(JSON.stringify(snapshot)), snapshot);
  for (const notes of [null, "human note", "{}", '{"kind":"permanent_overtime_v1","cycle":"wrong"}']) {
    assert.equal(permanentPayrollSnapshot(notes), null);
  }
});

test("concurrent settings edit is reread and preserved before saving teacher quota", async () => {
  let stored = { header: "initial" };
  let attempts = 0;
  const admin = { from(table) {
    assert.equal(table, "institutions");
    return {
      select() { return { eq() { return { single: async () => ({ data: { settings_json: structuredClone(stored) } }) }; } }; },
      update(payload) {
        let previous;
        const query = { eq(column, value) { if (column === "settings_json") previous = value; return query; },
          is() { return query; }, async select() {
            attempts++;
            if (attempts === 1) stored = { ...stored, header: "concurrent", attendance: { grace: 15 } };
            if (previous !== JSON.stringify(stored)) return { data: [] };
            stored = payload.settings_json;
            return { data: [{ id: "institution" }] };
          } };
        return query;
      },
    };
  } };
  await savePermanentCycle(admin, "institution", "teacher", "college");
  assert.equal(attempts, 2);
  assert.equal(stored.header, "concurrent");
  assert.deepEqual(stored.attendance, { grace: 15 });
  assert.equal(permanentCyclesFromSettings(stored).teacher, "college");
});

test("real print sheet renders permanent category, historical quota, service and overtime", async () => {
  const { default: React } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const jsx = await import("react/jsx-runtime");
  const { default: PayrollPrintSheet } = load("src/app/admin/finance/payroll/PayrollPrintSheet.tsx", {
    "react/jsx-runtime": jsx,
    "./PayrollPrintDocument": { default: ({ children }) => children },
    "@/lib/finance/payroll-values": load("src/lib/finance/payroll-values.ts"),
    "@/lib/finance/payroll-permanents": permanents,
    "@/lib/supabase-server": { getSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
  });
  const snapshot = { kind: "permanent_overtime_v1", cycle: "college", weekly_quota: 21,
    service_sessions: 24, overtime_sessions: 3, expected_overtime_sessions: 3, notes: null };
  const element = await PayrollPrintSheet({ autoPrint: false, institutionCfg: { institution_name: "École test" },
    selectedRun: { period_month: "2026-10-01", period_start: "2026-10-01", period_end: "2026-10-31", status: "draft", scope: "all_teachers" },
    lines: [{ id: "line", teacher_name_snapshot: "Permanent test", employment_type: "permanent", notes: JSON.stringify(snapshot),
      actual_sessions: 3, expected_sessions: 3, gross_amount: 4500, lost_amount: 0, adjusted_amount: 4500,
      rate_first_cycle: 1500, rate_second_cycle: 0 }],
    totals: { actualSessions: 3, gross: 4500, retained: 0, payable: 4500 },
    effectiveReferenceMinutes: 55, effectiveLateTolerance: 15, effectiveEarlyTolerance: 5,
  });
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, element));
  assert.match(html, /Vacations et heures supplémentaires des permanents/);
  assert.match(html, /Permanent collège · 21 h \/ semaine · service : 24 h · HS : 3 h/);
  assert.match(html, /Salaire fixe exclu/);
  assert.match(html, /Émargement/);
  assert.doesNotMatch(html, /permanent_overtime_v1/);
});

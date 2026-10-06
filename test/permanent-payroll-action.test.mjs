import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function evaluate(source, bindings = {}) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("exports", ...Object.keys(bindings), code)(exports, ...Object.values(bindings));
  return exports;
}
const values = evaluate(read("src/lib/finance/payroll-values.ts"));
const permanents = evaluate(read("src/lib/finance/payroll-permanents.ts"));
const source = read("src/app/admin/finance/payroll/page.tsx");
const parsed = ts.createSourceFile("payroll.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  const node = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(parsed);
}
const helpers = ["numberValue", "normalizeMonth", "parseAmount", "parsePositiveInt", "monthRange",
  "periodIsInsideAcademicYear", "clampPeriodToAcademicYear", "cycleFromLevel", "teacherLabel"];
const actionSource = `${helpers.map(declaration).join("\n")}\nexport ${declaration("calculatePayrollAction")}`;

function sessions(count, day) {
  return Array.from({ length: count }, (_, index) => {
    const time = `${String(6 + Math.floor(index / 6)).padStart(2, "0")}:${String(index % 6 * 10).padStart(2, "0")}:00`;
    const period = `${day}-${index}`;
    return {
      slot: { class_id: "class", subject_id: "math", period_id: period, session_date: day,
        start_time: time, weekday: 4, cycle: "first_cycle", expected_minutes: 55 },
      actual: { dateISO: `${day}T${time}Z`, period_id: period, class_id: "class", subject_id: "math",
        actual_call_iso: `${day}T${time}Z`, ended_at: `${day}T23:59:00Z`, late_minutes: 0,
        real_minutes: 55, observed_minutes: 55, expected_minutes: 55 },
    };
  });
}

async function calculate({ cycle = "college", employmentType = "permanent", scope = "all_teachers", rows = [], disabled = false } = {}) {
  const writes = [];
  const statisticRanges = [];
  const teacher = { profile_id: "teacher", display_name: "Test permanent", employment_type: employmentType,
    payroll_enabled: !disabled, permanent_cycle: cycle, notes: "Note conservée" };
  function table(name) {
    let operation = "read", payload;
    const query = {
      select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; }, limit() { return query; },
      insert(value) { operation = "insert"; payload = value; return query; },
      update(value) { operation = "update"; payload = value; return query; },
      delete() { operation = "delete"; return query; },
      maybeSingle: async () => execute(true), single: async () => execute(true),
      then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
    };
    function execute(single) {
      if (operation !== "read") {
        writes.push({ table: name, operation, payload });
        return { data: single ? { id: name === "teacher_payroll_runs" ? "run" : "line" } : [], error: null };
      }
      const fixtures = {
        classes: [{ id: "class", level: "6e", label: "6e1", academic_year: "2026-2027" }],
        institution_subjects: [],
        class_teachers: [{ teacher_id: "teacher", class_id: "class", subject_id: "math" }],
        teacher_payroll_runs: [], teacher_payroll_lines: [],
      };
      assert.ok(name in fixtures, `Unexpected table ${name}`);
      return { data: single ? fixtures[name][0] || null : fixtures[name], error: null };
    }
    return query;
  }
  const admin = { from: table, schema() { return admin; } };
  const { calculatePayrollAction } = evaluate(actionSource, {
    ...values, ...permanents,
    PERMANENT_PAYROLL_RUN_MARKER: "permanent_overtime_v1",
    getFinanceAccessForCurrentUser: async () => ({ ok: true }),
    getCurrentContextOrThrow: async () => ({ institutionId: "institution", userId: "admin" }),
    getSupabaseServiceClient: () => admin,
    getFinanceAcademicYearContext: async () => ({ selectedAcademicYearId: "year", selectedAcademicYearCode: "2026-2027",
      selectedAcademicYearStart: "2026-09-01", selectedAcademicYearEnd: "2027-07-31" }),
    getPayrollTeachers: async () => [teacher],
    fetchStatisticsDetailServer: async (_teacher, from, to) => {
      statisticRanges.push({ from, to });
      return { rows: rows.map((row) => row.actual) };
    },
    buildExpectedSlotsForTeacher: async () => rows.map((row) => row.slot),
    revalidatePath: () => {},
    redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); },
  });
  const form = new FormData();
  form.set("month", "2026-10"); form.set("academic_year", "2026-2027"); form.set("scope", scope);
  let url;
  try { await calculatePayrollAction(form); }
  catch (error) { if (!error.url) throw error; url = error.url; }
  return { writes, statisticRanges, url };
}

test("server action persists only the three overtime payments after a college teacher's 24 hours", async () => {
  const result = await calculate({ rows: sessions(24, "2026-10-05") });
  const line = result.writes.find((write) => write.table === "teacher_payroll_lines" && write.operation === "insert").payload;
  const details = result.writes.find((write) => write.table === "teacher_payroll_line_sessions").payload;
  assert.equal(line.employment_type, "permanent");
  assert.equal(line.actual_sessions, 3);
  assert.equal(line.gross_amount, 4500);
  assert.equal(line.adjusted_amount, 4500);
  assert.equal(details.filter((row) => row.counted_for_pay).length, 3);
  assert.equal(permanents.permanentPayrollSnapshot(line.notes).service_sessions, 24);
  assert.match(result.url, /payroll_calculated/);
});

test("server action reads September boundary days but stores only October overtime details", async () => {
  const result = await calculate({ cycle: "lycee", rows: [...sessions(18, "2026-09-30"), ...sessions(3, "2026-10-01")] });
  assert.deepEqual(result.statisticRanges, [{ from: "2026-09-28", to: "2026-11-01" }]);
  const details = result.writes.find((write) => write.table === "teacher_payroll_line_sessions").payload;
  assert.equal(details.length, 3);
  assert.ok(details.every((row) => row.session_date === "2026-10-01" && row.counted_for_pay));
  assert.equal(details.reduce((sum, row) => sum + row.adjusted_amount, 0), 6000);
});

test("lycée permanent teaching college classes receives only the lycée rate for overtime", async () => {
  const result = await calculate({ cycle: "lycee", rows: sessions(22, "2026-10-05") });
  const line = result.writes.find((write) => write.table === "teacher_payroll_lines" && write.operation === "insert").payload;
  assert.equal(line.actual_sessions, 4);
  assert.equal(line.adjusted_amount, 8000);
  assert.equal(line.rate_first_cycle, 0);
  assert.equal(line.rate_second_cycle, 2000);
  assert.equal(line.sessions_first_cycle, 0);
  assert.equal(line.sessions_second_cycle, 4);
});

test("college permanent teaching lycée classes receives only the college rate for overtime", async () => {
  const rows = sessions(24, "2026-10-05");
  rows.forEach((row) => { row.slot.cycle = "second_cycle"; });
  const result = await calculate({ cycle: "college", rows });
  const line = result.writes.find((write) => write.table === "teacher_payroll_lines" && write.operation === "insert").payload;
  assert.equal(line.actual_sessions, 3);
  assert.equal(line.adjusted_amount, 4500);
  assert.equal(line.rate_first_cycle, 1500);
  assert.equal(line.rate_second_cycle, 0);
  assert.equal(line.sessions_first_cycle, 3);
  assert.equal(line.sessions_second_cycle, 0);
});

test("missing permanent category is rejected before replacing or writing any payroll draft", async () => {
  const result = await calculate({ cycle: null, rows: sessions(24, "2026-10-05") });
  assert.match(result.url, /permanent_quota_missing/);
  assert.deepEqual(result.writes, []);
  assert.deepEqual(result.statisticRanges, []);
});

test("vacataires-only calculation remains unchanged and reads only the requested month", async () => {
  const result = await calculate({ employmentType: "vacataire", cycle: null, scope: "vacataires_only", rows: sessions(24, "2026-10-05") });
  const line = result.writes.find((write) => write.table === "teacher_payroll_lines" && write.operation === "insert").payload;
  assert.equal(line.employment_type, "vacataire");
  assert.equal(line.actual_sessions, 24);
  assert.equal(line.adjusted_amount, 36000);
  assert.equal(line.notes, "Note conservée");
  assert.deepEqual(result.statisticRanges, [{ from: "2026-10-01", to: "2026-10-31" }]);
});

test("a disabled permanent is excluded even when its category is unconfigured", async () => {
  const result = await calculate({ cycle: null, disabled: true });
  assert.match(result.url, /payroll_calculated/);
  assert.deepEqual(result.statisticRanges, []);
  assert.equal(result.writes.filter((write) => write.table === "teacher_payroll_lines" && write.operation === "insert").length, 0);
});

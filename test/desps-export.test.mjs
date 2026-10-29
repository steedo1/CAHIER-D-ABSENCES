import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function evaluate(path, imports = {}, extra = "", globals = {}) {
  const context = { exports: {}, process, console, URL, setTimeout, clearTimeout, AbortController, Response, ArrayBuffer, Uint8Array,
    require: (name) => name in imports ? imports[name] : require(name), ...globals };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8") + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context);
  return context.exports;
}
const shared = evaluate("src/lib/desps-export.ts");
const school = "school", year = "2026-2027";
const classA = { id: "9cf05b9b-985e-4801-ba97-9c9d3960fa03", label: "6e1", level: "6e",
  official_track_code: "6eme", institution_id: school, academic_year: year, education_type: "general_secondary" };
const classB = { ...classA, id: "52865d09-b6d5-4164-bc7a-ef288ee3c1e4", label: "6e2" };
const periods = [
  { code: "T1", label: "1er Trimestre", start_date: "2026-08-31", end_date: "2026-12-04", coeff: 1 },
  { code: "T2", label: "2e Trimestre", start_date: "2026-12-07", end_date: "2027-03-12", coeff: 2 },
  { code: "T3", label: "3e Trimestre", start_date: "2027-03-15", end_date: "2027-06-11", coeff: 2 },
].map((p, i) => ({ ...p, id: `10000000-0000-0000-0000-00000000000${i}`, institution_id: school, academic_year: year }));
function enrollment(cls, n) {
  return { id: `${cls.label}-${String(n).padStart(6, "0")}`, class_id: cls.id, student_id: `${cls.label}-${n}`,
    end_date: null, students: { first_name: "Test", last_name: String(n), matricule: `${cls.label}-${n}`, gender: n % 2 ? "F" : "M" } };
}
function fixture(entries, values = [null, null, null], options = {}) {
  const tables = { classes: [classA, classB], class_enrollments: entries, grade_periods: periods,
    user_roles: [{ profile_id: "user", institution_id: school, role: "admin" }],
    institutions: [{ id: school, name: "Test", settings_json: {} }],
    student_year_decisions: entries.map(e => ({ institution_id: school, academic_year: year,
      current_class_id: e.class_id, student_id: e.student_id, decision_type: "admitted", decided_at: "2027-06-12" })) };
  const reads = [], fetches = [];
  const database = { from(table) {
    let rows = [...(tables[table] || [])], single = false, range = null;
    const query = {
      select() { return query; }, returns() { return query; },
      eq(k, v) { rows = rows.filter(r => r[k] === v); return query; },
      in(k, v) { rows = rows.filter(r => v.includes(r[k])); return query; },
      is(k, v) { rows = rows.filter(r => (r[k] ?? null) === v); return query; },
      or() { return query; }, limit(n) { rows = rows.slice(0, n); return query; },
      order(k) { rows.sort((a, b) => String(a[k]).localeCompare(String(b[k]))); return query; },
      maybeSingle() { single = true; return query; },
      range(from, to) { range = [from, to]; return query; },
      then(resolve, reject) {
        reads.push({ table, range });
        const error = table === "class_enrollments" && range?.[0] === options.failAt ? { message: "failed" } : null;
        const data = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000);
        return Promise.resolve({ data: error ? null : single ? data[0] || null : data, error }).then(resolve, reject);
      },
    }; return query;
  } };
  const auth = { ...database, auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) } };
  const imports = {
    "@/lib/desps-export": shared,
    "@/lib/school-cycles": { parseSchoolCyclesSettings: value => value },
    "@/lib/school-student-programs": { isBilingualSchool: () => false },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => auth },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => database },
  };
  const route = evaluate("src/app/api/admin/exports/averages/route.ts", imports,
    "\nexports.helpers = { loadClasses, loadStudentMeta, prepareDespsOfficialTermExport, prepareDespsOfficialAnnualExport, sendPreparedWorkbook, validateOfficialStudentRegistry };",
    { fetch: async input => {
      const url = new URL(input), classId = url.searchParams.get("class_id"); fetches.push(url);
      const periodIndex = periods.findIndex(p => p.start_date === url.searchParams.get("from"));
      return { ok: true, json: async () => ({ ok: true, class: { id: classId, academic_year: year },
        subjects: [{ subject_id: "math", subject_name: "Mathématiques" }], subject_components: [],
        items: entries.filter(e => e.class_id === classId && !e.end_date).map(e => ({ student_id: e.student_id,
          general_avg: values[periodIndex], annual_avg: 10, annual_avg_is_complete: true,
          annual_coverage: { is_complete: true }, per_subject: [{ subject_id: "math", avg20: values[periodIndex] }] })) }) };
    } });
  const req = (query = "") => ({ url: `https://fixture.invalid/api/admin/exports/averages?${query}`,
    nextUrl: { origin: "https://fixture.invalid" }, headers: new Headers({ host: "fixture.invalid" }) });
  const params = { req: req(), supabase: database, institutionId: school, institutionName: "Test",
    institutionStatusLabel: "Privé", academicYear: year, classId: classA.id, periodRef: `period:${periods[0].id}`, term: 1 };
  return { ...route, reads, fetches, params, tables, req, diagnostic: evaluate("src/app/api/admin/exports/averages/diagnostic/route.ts", imports) };
}

test("official class-filtered workbook contains only that class and preserves NC", async () => {
  const f = fixture([classA, classB].flatMap(c => Array.from({ length: 32 }, (_, n) => enrollment(c, n))));
  const prepared = await f.helpers.prepareDespsOfficialTermExport(f.params);
  const response = await f.helpers.sendPreparedWorkbook(prepared, "xlsx");
  assert.equal(response.status, 200, response.status === 200 ? "" : await response.clone().text());
  const XLSX = require("xlsx"), workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  const sheet = workbook.Sheets["Etab Rendement au général"];
  assert.equal(sheet.G7.v, 32); assert.equal(sheet.G24.v, 32);
  assert.equal(sheet.J7.v, 0); assert.equal(sheet.M7.v, 32);
  assert.equal(sheet.G8.v, 0);
  assert.equal(f.fetches.length, 1); assert.equal(f.fetches[0].searchParams.get("class_id"), classA.id);
  assert.equal(f.fetches[0].searchParams.get("export_light"), "true");
});
test("annual workbook weights each subject 1/2/2 and retains bulletin general averages", async () => {
  const f = fixture([enrollment(classA, 1)], [2, 12, 12]);
  const prepared = await f.helpers.prepareDespsOfficialAnnualExport(f.params);
  assert.equal(prepared.error, undefined);
  const subject = prepared.sheets.find(s => s.sheetName === "Moy par discipline au général").aoa;
  assert.equal(subject[6][20], 1, "one girl classed in mathematics");
  assert.equal(subject[6][21], 0, "weighted average 10 is not counted below 10");
  const response = await f.helpers.sendPreparedWorkbook(prepared, "xlsx");
  assert.equal(response.status, 200, response.status === 200 ? "" : await response.clone().text());
  const workbook = require("xlsx").read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  assert.equal(workbook.Sheets["Moy par discipline au général"].V7.v, 0);
  assert.equal(workbook.Sheets["Classes intermédiaires"].H7.v, 1);
});
test("all 1201 enrollments are read in stable pages, excluding inactive and other classes", async () => {
  const entries = Array.from({ length: 1201 }, (_, n) => enrollment(classA, n));
  const f = fixture([...entries, enrollment(classB, 0), { ...enrollment(classA, 9999), end_date: "2026-10-01" }]);
  const registry = await f.helpers.loadStudentMeta({ ...f.params, classes: [classA], activeFrom: "2026-08-31" });
  assert.equal(registry.size, 1201);
  assert.deepEqual(f.reads.filter(r => r.table === "class_enrollments").map(r => r.range), [[0, 499], [500, 999], [1000, 1499]]);
});
test("a later-page failure returns 503 rather than exporting a partial registry", async () => {
  const f = fixture(Array.from({ length: 501 }, (_, n) => enrollment(classA, n)), undefined, { failAt: 500 });
  const response = await f.GET(f.req(`academic_year=${year}&class_id=${classA.id}&period_ref=period:${periods[0].id}&export_kind=desps_official_term&term=1`));
  assert.equal(response.status, 503); assert.equal((await response.json()).error, "DESPS_REGISTRY_UNAVAILABLE");
  assert.equal(f.fetches.length, 0);
});
test("exact page boundaries and max size are complete or explicitly refused", async () => {
  for (const count of [0, 500, 1000, 20000]) {
    const rows = await shared.readDespsEnrollmentPages(async (from, to) => ({ data: Array.from({ length: Math.max(0, Math.min(to + 1, count) - from) }, (_, i) => from + i), error: null }));
    assert.equal(rows.length, count);
  }
  await assert.rejects(shared.readDespsEnrollmentPages(async () => ({ data: Array(500).fill({}), error: null })),
    error => error.code === "DESPS_REGISTRY_TOO_LARGE");
});
test("registry diagnostic and export agree on normalized genders and duplicate matricules", async () => {
  const one = enrollment(classA, 1), two = enrollment(classA, 2);
  one.students.gender = "female"; two.students.gender = "garçons";
  one.students.matricule = " Ab 123 "; two.students.matricule = "AB123";
  const f = fixture([one, two]);
  const registry = await f.helpers.loadStudentMeta({ ...f.params, classes: [classA], activeFrom: "" });
  assert.equal(f.helpers.validateOfficialStudentRegistry(registry).error, "DUPLICATE_MATRICULE");
  const result = await f.diagnostic.GET(f.req(`academic_year=${year}&class_id=${classA.id}`));
  const report = await result.json(); assert.equal(result.status, 200);
  assert.equal(report.unknown, 0); assert.equal(report.girls, 1); assert.equal(report.boys, 1);
  assert.equal(report.byCode.MATRICULE_DOUBLON, 2);
});
test("missing matricules are reported by name and block official export without rewriting data", async () => {
  const row = enrollment(classA, 1); row.students.matricule = null;
  const f = fixture([row]);
  const response = await f.GET(f.req(`academic_year=${year}&class_id=${classA.id}&period_ref=period:${periods[0].id}&export_kind=desps_official_term&term=1`));
  assert.equal(response.status, 422); assert.equal((await response.json()).error, "MISSING_MATRICULE");
  const report = await (await f.diagnostic.GET(f.req(`academic_year=${year}&class_id=${classA.id}`))).json();
  assert.equal(report.byCode.MATRICULE_ABSENT, 1); assert.equal(report.issues[0].studentName, "1 Test");
  assert.equal(row.students.matricule, null);
});
test("duplicate active enrollment is refused instead of silently collapsed", async () => {
  const row = enrollment(classA, 1), f = fixture([row, { ...row, id: "second-enrollment" }]);
  await assert.rejects(f.helpers.loadStudentMeta({ ...f.params, classes: [classA], activeFrom: "" }),
    error => error.code === "MULTIPLE_ACTIVE_ENROLLMENTS");
});
test("invalid class, another school or another academic year never widens the selection", async () => {
  const f = fixture([enrollment(classA, 1)]);
  assert.equal((await f.helpers.loadClasses({ ...f.params, classId: "invalid" })).error, "INVALID_CLASS_ID");
  assert.equal((await f.helpers.loadClasses({ ...f.params, institutionId: "other" })).classes.length, 0);
  assert.equal((await f.helpers.loadClasses({ ...f.params, academicYear: "2025-2026" })).classes.length, 0);
});
test("weighting retains real zero, ignores missing subjects and uses configured weights", () => {
  assert.equal(shared.weightedDespsSubjectAverage([]), null);
  assert.equal(shared.weightedDespsSubjectAverage([{ value: 0, coeff: 1 }, { value: 10, coeff: 2 }]), 6.6667);
  assert.equal(shared.weightedDespsSubjectAverage([{ value: 2, coeff: 1 }, { value: 12, coeff: 2 }, { value: 12, coeff: 2 }]), 10);
  assert.equal(shared.weightedDespsSubjectAverage([{ value: 2, coeff: null }, { value: 12, coeff: 0 }]), 7);
});

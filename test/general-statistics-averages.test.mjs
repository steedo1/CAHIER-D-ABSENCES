import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in imports, `${path}: ${name}`); return imports[name];
  });
  return exports;
}
const api = load("src/lib/general-statistics-averages.ts");
const periods = [1, 2, 3].map((n) => ({ id: `t${n}`, label: `Trimestre ${n}`, start_date: `2027-0${n}-01`,
  end_date: `2027-0${n}-28`, coeff: n === 1 ? 1 : 2, class_ids: ["class-a"] }));
function bulletin(period, item = {}, classId = "class-a") {
  return { ok: true, class: { id: classId, academic_year: "2026-2027" },
    period: { from: period.start_date, to: period.end_date }, subjects: [{ subject_id: "math", subject_name: "Mathématiques" }],
    items: [{ student_id: "student", general_avg: 0, annual_avg: 17.25, per_subject: [{ subject_id: "math", avg20: 10 }], ...item }] };
}
function data(items) {
  return { periods, bulletins: new Map(periods.map((p, i) => [`class-a|${p.id}`, bulletin(p, items[i])])), subjects: [] };
}
test("bounds are inclusive, accept decimal commas, and distinguish missing grades from a real zero", () => {
  assert.deepEqual(api.statisticsAverageBounds("0", "12,5"), { min: 0, max: 12.5, error: null });
  assert.equal(api.statisticsAverageMatches({ value: 0 }, 0, 0), true);
  assert.equal(api.statisticsAverageMatches({ value: null }, 0, 20), false);
  assert.equal(api.statisticsAverageMatches({ value: null }, null, null), true);
  assert.equal(api.statisticsAverageMatches({ value: 12.4999 }, 12.5, 12.5), true);
  for (const [min, max] of [["-1", ""], ["", "21"], ["abc", ""], ["15", "10"], ["NaN", "20"]]) {
    assert.ok(api.statisticsAverageBounds(min, max).error);
  }
  assert.equal(api.formatStatisticsAverage({ value: 0, partial: false }), "0,00");
  assert.equal(api.formatStatisticsAverage({ value: null, partial: false }), "—");
});
test("no discipline uses the official quarterly or annual average, including council adjustments", () => {
  const results = data([{ general_avg: 12 }, { general_avg: 10 }, { general_avg: 8, annual_avg: 17.25 }]);
  assert.equal(api.statisticsStudentAverage(results, "class-a", "student", "t1", "all").value, 12);
  assert.equal(api.statisticsStudentAverage(results, "class-a", "student", "annual", "all").value, 17.25);
  assert.equal(api.statisticsStudentAverage(results, "another-class", "student", "annual", "all").value, null);
});
test("a yearly discipline weights published subject means by period coefficients, without mixing general means", () => {
  const results = data([18, 16, 14].map((avg20) => ({ per_subject: [{ subject_id: "math", avg20 }] })));
  assert.equal(api.statisticsStudentAverage(results, "class-a", "student", "t2", "math").value, 16);
  assert.equal(api.statisticsStudentAverage(results, "class-a", "student", "annual", "math").value, 15.6);
  results.bulletins.get("class-a|t3").items[0].per_subject[0].avg20 = null;
  assert.deepEqual(api.statisticsStudentAverage(results, "class-a", "student", "annual", "math"), { value: 16.6667, partial: true });
});
test("before the official annual bulletin, available quarterly means produce a clearly provisional annual mean", () => {
  const results = data([{ general_avg: 12 }, { general_avg: 10 }, { general_avg: null, annual_avg: null }]);
  assert.deepEqual(api.statisticsStudentAverage(results, "class-a", "student", "annual", "all"), { value: 10.6667, partial: true });
  results.bulletins.get("class-a|t3").items[0].admin_annual_forced_nc = true;
  assert.equal(api.statisticsStudentAverage(results, "class-a", "student", "annual", "all").value, null);
});
test("administrative NC, a missing subject or a non-assigned subject never become a numeric average", () => {
  const results = data([{ general_avg: 18, admin_forced_nc: true }, {}, { annual_avg: 17, admin_annual_forced_nc: true }]);
  assert.equal(api.statisticsStudentAverage(results, "class-a", "student", "t1", "all").value, null);
  assert.equal(api.statisticsStudentAverage(results, "class-a", "student", "annual", "all").value, null);
  for (const flag of [{ is_nc: true }, { is_assigned: false }, { has_grade: false }]) {
    results.bulletins.get("class-a|t2").items[0].per_subject = [{ subject_id: "math", avg20: 18, ...flag }];
    assert.equal(api.statisticsStudentAverage(results, "class-a", "student", "t2", "math").value, null);
  }
});
test("bulletins are read at most two at a time, with light GETs, and reused when bounds or discipline change", async () => {
  const cache = new Map(); let active = 0, maxActive = 0, reads = 0;
  const fetcher = async (url, options) => {
    assert.equal(options.method, undefined); assert.equal(options.credentials, "include");
    const query = new URL(url, "https://fixture.invalid").searchParams;
    assert.equal(query.get("export_light"), "1"); reads++; maxActive = Math.max(maxActive, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return Response.json(bulletin(periods.find((p) => p.start_date === query.get("from"))));
  };
  const input = { classIds: ["class-a"], selection: "annual", periods, academicYear: "2026-2027", cache,
    signal: new AbortController().signal, fetcher };
  const loaded = await api.loadStatisticsAcademicData(input);
  assert.equal(maxActive, 2); assert.equal(reads, 3); assert.equal(loaded.bulletins.size, 3);
  await api.loadStatisticsAcademicData({ ...input, selection: "t1" });
  assert.equal(reads, 3);
  for (const entry of cache.values()) entry.loadedAt -= 61_000;
  await api.loadStatisticsAcademicData({ ...input, selection: "t1" });
  assert.equal(reads, 4, "a cached average does not outlive its freshness budget");
});
for (const mismatch of ["class", "year", "period"]) test(`a ${mismatch} mismatch refuses publication and caching`, async () => {
  const cache = new Map();
  await assert.rejects(api.loadStatisticsAcademicData({ classIds: ["class-a"], selection: "t1", periods,
    academicYear: "2026-2027", signal: new AbortController().signal, cache,
    fetcher: async () => { const result = bulletin(periods[0]);
      if (mismatch === "class") result.class.id = "other-school-class";
      if (mismatch === "year") result.class.academic_year = "2025-2026";
      if (mismatch === "period") result.period.from = "2025-01-01";
      return Response.json(result); },
  }), /correspondent pas/);
  assert.equal(cache.size, 0);
});
test("switching filters aborts a stalled response without caching or publishing it", async () => {
  const controller = new AbortController(), cache = new Map();
  const pending = api.loadStatisticsAcademicData({ classIds: ["class-a"], selection: "t1", periods,
    academicYear: "2026-2027", signal: controller.signal, cache, fetcher: () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cache.size, 0);
});

test("period lookups are grouped by education context and retain class applicability", async () => {
  const calls = [];
  const helper = load("src/lib/server/general-statistics-periods.ts", {
    "@/lib/education-grading-periods": { listApplicableGradePeriods: async (...args) => {
      calls.push(args); return { items: [{ ...periods[0], id: args[3] === "primary" ? "semester" : "t1" }] };
    } },
  });
  const loaded = await helper.loadStatisticsGradePeriods({}, "school", "2026-2027", [
    ...Array.from({ length: 19 }, (_, i) => ({ id: `class-${i}`, education_type: "general_secondary" })),
    { id: "primary", education_type: "primary" },
  ]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call[1] === "school" && call[2] === "2026-2027"));
  assert.equal(loaded.find((p) => p.id === "t1").class_ids.length, 19);
  assert.deepEqual(loaded.find((p) => p.id === "semester").class_ids, ["primary"]);
});

function routeFixture({ role = "file_correspondent", institution = "school", failPeriods = false, authenticated = true } = {}) {
  let periodReads = 0;
  const tables = {
    profiles: [{ id: "actor", institution_id: "school" }], user_roles: [{ profile_id: "actor", role, institution_id: institution }],
    academic_years: [{ institution_id: "school", code: "2026-2027", is_current: true }], student_year_profiles: [],
    class_enrollments: [{ institution_id: "school", student_id: "student", class_id: "class-a", end_date: null,
      students: { id: "student", full_name: "ÉLÈVE TEST" }, classes: { id: "class-a", institution_id: "school", academic_year: "2026-2027" } }],
  };
  function query(table) {
    assert.ok(table in tables, table); let rows = [...tables[table]];
    return { select() { return this; }, order() { return this; }, limit() { return this; },
      eq(key, value) { rows = rows.filter((row) => key.split(".").reduce((v, k) => v?.[k], row) === value); return this; },
      is(key, value) { return this.eq(key, value); },
      async maybeSingle() { return { data: rows[0] || null, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
    };
  }
  const service = { from: query }, session = { from: query, auth: { getUser: async () => ({ data: { user: authenticated ? { id: "actor" } : null } }) } };
  const route = load("src/app/api/admin/statistiques-generales/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => session },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/server/general-statistics-periods": { loadStatisticsGradePeriods: async (_srv, inst, year, classes) => {
      assert.equal(inst, "school"); assert.equal(year, "2026-2027"); assert.deepEqual(classes.map((c) => c.id), ["class-a"]);
      periodReads++; if (failPeriods) throw new Error("unavailable"); return periods;
    } },
  });
  return { get: route.GET, periodReads: () => periodReads };
}
test("the real statistics route authorizes academic metadata for its own file correspondent", async () => {
  const fixture = routeFixture(), response = await fixture.get(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.can_filter_averages, true);
  assert.equal(body.items.length, 1); assert.equal(body.academic_periods.length, 3); assert.equal(fixture.periodReads(), 1);
});
test("academic metadata follows existing bulletin rights, while demographic statistics remain available to finance", async () => {
  const fixture = routeFixture({ role: "finance_manager" }), response = await fixture.get(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.items.length, 1);
  assert.equal(body.can_filter_averages, false); assert.deepEqual(body.academic_periods, []); assert.equal(fixture.periodReads(), 0);
});
for (const options of [{ role: "teacher" }, { institution: "another-school" }, { authenticated: false }]) test(`unapproved statistics scope is rejected: ${JSON.stringify(options)}`, async () => {
  const fixture = routeFixture(options), response = await fixture.get();
  assert.equal(response.status, options.authenticated === false ? 401 : 403); assert.equal(fixture.periodReads(), 0);
});
test("an unavailable period configuration does not break the existing demographic statistics", async () => {
  const response = await routeFixture({ failPeriods: true }).get(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.items.length, 1);
  assert.deepEqual(body.academic_periods, []); assert.match(body.academic_filter_error, /périodes/);
});

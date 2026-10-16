import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
function load(path, overrides = {}, cache = new Map(), env = {}) {
  if (cache.has(path)) return cache.get(path);
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", code)((id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`, overrides, cache, env);
    return require(id);
  }, module, module.exports, { env });
  cache.set(path, module.exports);
  return module.exports;
}

function fixture({ roles = ["educator", "admin"], signedIn = true, failCounts = false, failHistory = false, tables = {} } = {}) {
  const calls = [];
  const rows = {
    profiles: [{ id: "admin", institution_id: "school-1" }],
    user_roles: roles.map((role) => ({ profile_id: "admin", institution_id: "school-1", role })),
    academic_years: [{ id: "year-1", institution_id: "school-1", code: "2026-2027", label: "2026–2027", start_date: "2026-09-01", end_date: "2027-07-31", is_current: true }],
    classes: [
      { id: "class-1", institution_id: "school-1", academic_year: "2026-2027", label: "3e3", level: "3e" },
      { id: "class-2", institution_id: "school-1", academic_year: "2026-2027", label: "3e30", level: "3e" },
      { id: "old-class", institution_id: "school-1", academic_year: "2025-2026", label: "6e1", level: "6e" },
      { id: "other-class", institution_id: "school-2", academic_year: "2026-2027", label: "3e1", level: "3e" },
    ],
    class_enrollments: [
      { id: "1", institution_id: "school-1", class_id: "class-1", student_id: "s1", end_date: null },
      { id: "2", institution_id: "school-1", class_id: "class-1", student_id: "s1", end_date: null },
      { id: "3", institution_id: "school-1", class_id: "class-1", student_id: "s2", end_date: null },
      { id: "4", institution_id: "school-1", class_id: "class-1", student_id: "ended", end_date: "2026-10-01" },
      { id: "5", institution_id: "school-1", class_id: "class-2", student_id: "s3", end_date: null },
      { id: "6", institution_id: "school-1", class_id: "old-class", student_id: "old", end_date: null },
      { id: "7", institution_id: "school-2", class_id: "class-1", student_id: "other", end_date: null },
    ],
    grade_periods: [{ institution_id: "school-1", academic_year: "2026-2027", id: "t1", code: "T1", label: "Premier trimestre", start_date: "2026-09-01", end_date: "2026-12-20", coeff: 1 }],
    ...tables,
  };
  const db = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "admin" } : null } }) },
    from(table) {
      const filters = [];
      const call = { table, method: "select", filters };
      let rowLimit, page;
      const query = {
        select(columns) { call.columns = columns; return query; },
        eq(key, value) { filters.push({ op: "eq", key, value }); return query; },
        in(key, value) { filters.push({ op: "in", key, value }); return query; },
        is(key, value) { filters.push({ op: "is", key, value }); return query; },
        order() { return query; },
        limit(value) { rowLimit = value; return query; },
        range(start, end) { page = [start, end]; call.range = page; return query; },
        insert(data) { call.method = "insert"; call.data = data; return query; },
        maybeSingle() { return execute(true); },
        then(resolve, reject) { return execute(false).then(resolve, reject); },
      };
      async function execute(single) {
        calls.push(call);
        if (call.method === "insert") return failHistory
          ? { data: null, error: { message: "history unavailable" } }
          : { data: single ? { id: "run-1" } : [], error: null };
        if (table === "class_enrollments" && failCounts) return { data: null, error: { message: "unavailable" } };
        let data = (rows[table] || []).filter((row) => filters.every(({ op, key, value }) => op === "in" ? value.includes(row[key]) : row[key] === value));
        if (rowLimit != null) data = data.slice(0, rowLimit);
        if (page) data = data.slice(page[0], page[1] + 1);
        if (single && data.length > 1) return { data: null, error: { message: "multiple rows" } };
        return { data: single ? data[0] || null : data, error: null };
      }
      return query;
    },
    async rpc(name, params) {
      calls.push({ rpc: name, params });
      return { data: [{ student_id: "s1", class_id: params.p_class_id, last_name: "ÉLÈVE", first_name: "TEST", general_avg_20: null, raw_all_avg_20: null, raw_core_avg_20: null, p_success: null, conduct_total_20: null, total_absent_hours: null, nb_lates: null, presence_rate: null }], error: null };
    },
  };
  const overrides = {
    "@/lib/supabase-server": { getSupabaseServerClient: async () => db },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => db },
  };
  const bootstrap = load("src/app/api/admin/mon-cahier-ia/bootstrap/route.ts", overrides);
  const assistant = load("src/app/api/admin/mon-cahier-ia/assistant/route.ts", overrides);
  return { db, calls, bootstrap, assistant };
}
function request(question = "Combien d’élèves compte l’établissement ?", extra = {}) {
  return new NextRequest("https://school.invalid/api/admin/mon-cahier-ia/assistant", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: "fixture=session" },
    body: JSON.stringify({ question, academic_year: "2026-2027", exam_date: "2026-10-16", ...extra }),
  });
}

test("bootstrap accepts an authorized account with multiple roles and keeps the institution boundary", async () => {
  const f = fixture();
  const result = await f.bootstrap.GET();
  assert.equal(result.status, 200);
  const json = await result.json();
  assert.equal(json.current_academic_year.code, "2026-2027");
  assert.ok(json.classes.every((item) => item.id !== "other-class"));
  assert.equal(f.calls.filter((call) => call.method === "insert").length, 0);
});

for (const [options, expected] of [[{ signedIn: false }, 401], [{ roles: ["teacher", "finance_manager"] }, 403]]) {
  test(`both chat endpoints reject unauthorized access with HTTP ${expected}`, async () => {
    const f = fixture(options);
    assert.equal((await f.bootstrap.GET()).status, expected);
    assert.equal((await f.assistant.POST(request())).status, expected);
    assert.ok(!f.calls.some((call) => ["classes", "class_enrollments"].includes(call.table)));
  });
}

test("the actual assistant counts unique active students using a single minimal roster query and no bulletin or persistence", async () => {
  const f = fixture();
  globalThis.fetch = () => { throw new Error("a simple count must not load a bulletin or external model"); };
  const result = await f.assistant.POST(request());
  assert.equal(result.status, 200);
  const json = await result.json();
  assert.equal(json.answer.quick_stats.cards.find((card) => card.key === "scope_students").value, "3");
  assert.equal(json.answer.quick_stats.cards.find((card) => card.key === "scope_classes").value, "2");
  const roster = f.calls.filter((call) => call.table === "class_enrollments");
  assert.equal(roster.length, 1);
  assert.equal(roster[0].columns, "student_id");
  assert.ok(roster[0].filters.some((filter) => filter.key === "institution_id" && filter.value === "school-1"));
  assert.deepEqual(roster[0].filters.find((filter) => filter.key === "class_id").value, ["class-1", "class-2"]);
  assert.ok(!f.calls.some((call) => call.rpc || call.method === "insert" || call.table === "grade_periods"));
});

test("an explicit class count excludes its sibling, other institutions and other years", async () => {
  const f = fixture();
  const json = await (await f.assistant.POST(request("Quel est l’effectif de la 3e 3 ?"))).json();
  assert.equal(json.answer.quick_stats.cards[0].value, "2");
  assert.equal(json.context_meta.scope_stats.active_label, "3e3");
  assert.equal(json.context_meta.scope_stats.total_classes_count, 2);
  assert.equal(json.context_meta.scope_stats.is_filtered, true);
  const roster = f.calls.find((call) => call.table === "class_enrollments");
  assert.deepEqual(roster.filters.find((filter) => filter.key === "class_id").value, ["class-1"]);
});

test("an unavailable level returns no matching class rather than analyzing the whole school", async () => {
  const f = fixture();
  const json = await (await f.assistant.POST(request("Quels élèves de 6e doivent être suivis ?"))).json();
  assert.equal(json.answer.title, "Aucune classe trouvée");
  assert.ok(!f.calls.some((call) => call.rpc || call.table === "class_enrollments"));
});

test("a failed roster count is not displayed as zero", async () => {
  const f = fixture({ failCounts: true });
  const result = await f.assistant.POST(request());
  assert.equal(result.status, 500);
  const json = await result.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /effectif.*indisponible/);
  assert.equal(json.answer, undefined);
});

test("roster pagination includes more than 1000 enrollments and deduplicates students across pages", async () => {
  const enrollments = Array.from({ length: 1101 }, (_, index) => ({
    id: String(index), student_id: `student-${index === 1100 ? 0 : index}`,
    institution_id: "school-1", class_id: "class-1", end_date: null,
  }));
  const f = fixture({ tables: { class_enrollments: enrollments } });
  const { loadRosterCount } = load("src/lib/mon-cahier-ai/roster-stats.ts");
  assert.equal(await loadRosterCount(f.db, "school-1", ["class-1"]), 1100);
  assert.deepEqual(f.calls.filter((call) => call.table === "class_enrollments").map((call) => call.range), [[0, 999], [1000, 1999]]);
});

test("only basic counts take the lightweight path; qualified questions retain the full analysis", () => {
  const { isRosterCountQuestion } = load("src/lib/mon-cahier-ai/roster-stats.ts");
  for (const text of ["Combien d’élèves compte l’établissement ?", "Quel est l’effectif de la 3e3 ?", "Combien de classes avons-nous ?"]) assert.equal(isRosterCountQuestion(text, ["3e3"]), true, text);
  for (const text of ["Combien d’élèves sous 10 ?", "Combien de filles ?", "Combien d’élèves ont échoué ?", "Combien d’élèves internes ?", "Combien d’élèves sans notes ?", "Quelles classes sont fragiles ?", "Combien d’élèves par classe ?"]) assert.equal(isRosterCountQuestion(text, ["3e3"]), false, text);
});

for (const failHistory of [false, true]) test(`the full route builds a class council note from official period averages when annual averages are absent (history failure: ${failHistory})`, async () => {
  const f = fixture({ failHistory });
  const bulletinCalls = [];
  globalThis.fetch = async (url, options) => {
    bulletinCalls.push({ url: new URL(url), options });
    return Response.json({ subjects: [{ subject_id: "maths", subject_name: "Mathématiques" }], items: [{
      student_id: "s1", full_name: "ÉLÈVE TEST", general_avg: 12.5, annual_avg: null, conduct_avg: null,
      per_subject: [{ subject_id: "maths", subject_name: "Mathématiques", avg20: 12.5 }],
    }] });
  };
  const result = await f.assistant.POST(request("Prépare une note pour le conseil en 3e3"));
  assert.equal(result.status, 200);
  const json = await result.json();
  assert.equal(json.ok, true);
  assert.match(json.answer.council_note, /12[,.]5/);
  assert.match(json.answer.council_note, /3e3/);
  assert.equal(bulletinCalls.length, 1);
  assert.equal(bulletinCalls[0].url.searchParams.get("class_id"), "class-1");
  assert.equal(bulletinCalls[0].url.searchParams.get("to"), "2026-12-20");
  assert.equal(bulletinCalls[0].url.searchParams.get("export_light"), "1");
  assert.equal(bulletinCalls[0].options.headers.cookie, "fixture=session");
  assert.equal(f.calls.filter((call) => call.rpc).length, 1);
  assert.ok(f.calls.filter((call) => call.method === "insert").every((call) => call.table.startsWith("ai_")));
});

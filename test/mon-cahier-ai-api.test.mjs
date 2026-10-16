import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const institution = "school-a";
const year = "2026-2027";
const classes = [
  { id: "a3", label: "3e3", level: "3e", institution_id: institution, academic_year: year },
  { id: "a1", label: "3e1", level: "3e", institution_id: institution, academic_year: year },
  { id: "old", label: "3e3", level: "3e", institution_id: institution, academic_year: "2025-2026" },
  { id: "foreign", label: "3e3", level: "3e", institution_id: "school-b", academic_year: year },
];

function harness(options = {}) {
  const calls = [];
  const tables = {
    profiles: [{ id: "admin-a", institution_id: institution }],
    user_roles: (options.roles ?? ["admin"]).map((role) => ({ profile_id: "admin-a", institution_id: institution, role })),
    academic_years: [{ code: year, institution_id: institution, is_current: true, start_date: "2026-09-01", end_date: "2027-07-31" }],
    classes: options.classes ?? classes,
    class_enrollments: options.enrollments ?? [
      { id: "1", student_id: "s1", class_id: "a3", institution_id: institution, end_date: null },
      { id: "2", student_id: "s2", class_id: "a3", institution_id: institution, end_date: null },
      { id: "3", student_id: "s1", class_id: "a3", institution_id: institution, end_date: null },
      { id: "4", student_id: "ended", class_id: "a3", institution_id: institution, end_date: "2026-10-01" },
      { id: "5", student_id: "other-class", class_id: "a1", institution_id: institution, end_date: null },
      { id: "6", student_id: "previous-year", class_id: "old", institution_id: institution, end_date: null },
      { id: "7", student_id: "another-school", class_id: "a3", institution_id: "school-b", end_date: null },
    ],
    grade_periods: [{ id: "t1", institution_id: institution, academic_year: year, label: "Trimestre 1", start_date: "2026-09-01", end_date: "2026-12-20" }],
  };
  const db = {
    auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: "admin-a" } } }) },
    from(table) {
      const call = { table, filters: [], operation: "select" };
      calls.push(call);
      let rows = [...(tables[table] ?? [])];
      const query = {
        select() { return query; },
        eq(key, value) { call.filters.push([key, value]); rows = rows.filter((row) => row[key] === value); return query; },
        in(key, values) { call.filters.push([key, values]); rows = rows.filter((row) => values.includes(row[key])); return query; },
        is(key, value) { call.filters.push([key, value]); rows = rows.filter((row) => row[key] === value); return query; },
        order() { return query; },
        limit(count) { rows = rows.slice(0, count); return query; },
        range(from, to) { rows = rows.slice(from, to + 1); return query; },
        insert(value) { call.operation = "insert"; call.value = value; rows = []; return query; },
        maybeSingle: async () => rows.length > 1
          ? { data: null, error: { message: "Multiple rows" } }
          : { data: rows[0] ?? null, error: null },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
      return query;
    },
    async rpc(name, args) { calls.push({ rpc: name, args }); return { data: [], error: null }; },
  };
  const loaded = new Map();
  function load(path) {
    if (loaded.has(path)) return loaded.get(path);
    const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", code)((id) => {
      if (id === "@/lib/supabase-server") return { getSupabaseServerClient: async () => db };
      if (id === "@/lib/supabaseAdmin") return { getSupabaseServiceClient: () => db };
      if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`);
      return require(id);
    }, module, module.exports);
    loaded.set(path, module.exports);
    return module.exports;
  }
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/admin/grades/bulletin", "no external model is needed");
    assert.equal(parsed.searchParams.get("export_light"), "1", "analysis must not generate QR codes");
    assert.equal(parsed.searchParams.get("from"), "2026-09-01");
    assert.equal(parsed.searchParams.get("to"), "2026-12-20");
    assert.ok(init.signal, "bulletin requests are bounded");
    calls.push({ bulletin: parsed.searchParams.get("class_id") });
    return Response.json({ ok: true, items: options.bulletinItems ?? [] });
  };
  return {
    calls, load,
    bootstrap: () => load("src/app/api/admin/mon-cahier-ia/bootstrap/route.ts").GET(),
    async ask(question, overrides = {}) {
      const handler = load("src/app/api/admin/mon-cahier-ia/assistant/route.ts").POST;
      return handler(new NextRequest("https://school.invalid/api/admin/mon-cahier-ia/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, academic_year: year, exam_date: "2026-10-16", ...overrides }),
      }));
    },
  };
}

test("both routes authorize an admin with several roles and reject teachers and signed-out users", async () => {
  for (const [options, status] of [
    [{ roles: ["teacher", "admin", "educator"] }, 200],
    [{ roles: ["teacher"] }, 403],
    [{ signedOut: true }, 401],
  ]) {
    const app = harness(options);
    assert.equal((await app.bootstrap()).status, status);
    assert.equal((await app.ask("Combien d’élèves compte l’établissement ?")).status, status);
    if (status !== 200) assert.ok(app.calls.every((call) => ["profiles", "user_roles"].includes(call.table)));
  }
});

test("an exact class count uses active distinct inscriptions for this school and year without prediction or bulletin calls", async () => {
  const app = harness();
  const response = await app.ask("Combien d’élèves compte la 3e3 ?");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.answer.quick_stats.cards[0].value, "2");
  assert.equal(result.answer.quick_stats.cards[1].value, "1");
  assert.equal(result.answer.quick_stats.scope_label, "3e3");
  assert.ok(app.calls.every((call) => !call.rpc && !call.bulletin && call.operation !== "insert"));
});

test("a bare effectif request also uses the direct count", async () => {
  const app = harness();
  const result = await (await app.ask("Quel est l’effectif ?")).json();
  assert.equal(result.answer.quick_stats.cards[0].value, "3");
  assert.ok(app.calls.every((call) => !call.rpc && !call.bulletin));
});

test("school counts include more than 80 classes and more than 1000 inscriptions without truncation", async () => {
  const manyClasses = Array.from({ length: 85 }, (_, n) => ({ ...classes[0], id: `class-${n}`, label: `3e${n + 1}` }));
  const enrollments = Array.from({ length: 1205 }, (_, n) => ({ id: String(n), class_id: manyClasses[n % 85].id, student_id: `student-${n}`, institution_id: institution, end_date: null }));
  const app = harness({ classes: manyClasses, enrollments });
  const result = await (await app.ask("Combien d’élèves compte l’établissement ?")).json();
  assert.equal(result.answer.quick_stats.cards[0].value, "1205");
  assert.equal(result.answer.quick_stats.cards[1].value, "85");
  assert.equal(app.calls.filter((call) => call.table === "class_enrollments").length, 2);
});

test("a missing level or another school's class never widens the analysis to this whole school", async () => {
  for (const overrides of [{ level: "Terminale" }, { class_id: "foreign" }, { academic_year: "2040-2041" }]) {
    const app = harness();
    const result = await (await app.ask("Résume la situation", overrides)).json();
    assert.equal(result.answer.title, "Aucune classe trouvée");
    assert.ok(app.calls.every((call) => !call.rpc && !call.bulletin));
  }
});

test("missing averages remain unknown and do not create a failing class or high-risk pupils", async () => {
  const app = harness({ bulletinItems: [{ student_id: "s1", full_name: "Élève test", general_avg: null, annual_avg: null, conduct_avg: null, per_subject: [] }] });
  const result = await (await app.ask("Résume la 3e3")).json();
  assert.equal(result.ok, true);
  assert.match(result.answer.summary, /Indice moyen de préparation : —/);
  assert.deepEqual(result.answer.classes_at_risk, []);
  assert.deepEqual(result.answer.students_to_follow, []);
  assert.equal(result.context_meta.students_count, 1);
  assert.equal(result.context_meta.data_quality.status, "missing");
  assert.deepEqual(app.calls.filter((call) => call.bulletin).map((call) => call.bulletin), ["a3"]);
  assert.ok(app.calls.filter((call) => call.operation === "insert").every((call) => call.table.startsWith("ai_")));
});

test("a genuine zero average still generates an alert and the council note and remediation are populated", async () => {
  for (const question of ["Prépare une note de conseil pour la 3e3", "Propose un plan de remédiation pour la 3e3"]) {
    const app = harness({ bulletinItems: [{ student_id: "s1", full_name: "Élève test", general_avg: 0, annual_avg: null, conduct_avg: null, per_subject: [] }] });
    const result = await (await app.ask(question)).json();
    assert.equal(result.answer.students_to_follow[0].general_avg_20, 0);
    assert.equal(result.answer.students_to_follow[0].risk_level, "high");
    assert.ok(result.answer.council_note || result.answer.remediation_plan?.length);
  }
});

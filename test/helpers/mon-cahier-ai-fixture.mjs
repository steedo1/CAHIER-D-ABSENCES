import assert from "node:assert/strict";
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
    grade_periods: [{ id: "t1", institution_id: institution, academic_year: year, code: "T1", scope_type: "common", is_active: true, label: "Trimestre 1", start_date: "2026-09-01", end_date: "2026-12-20" }],
    ...options.tables,
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
        or(expression) { rows = rows.filter((row) => expression.split(",").some((term) => {
          const [key, op, value] = term.split(".");
          return op === "is" && value === "null" ? row[key] == null : String(row[key]) === value;
        })); return query; },
        abortSignal(signal) { call.signal = signal; return query; },
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
    const source = fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", "process", code)((id) => {
      if (id === "@/lib/supabase-server") return { getSupabaseServerClient: async () => db };
      if (id === "@/lib/supabaseAdmin") return { getSupabaseServiceClient: () => db };
      if (id === "ai" && options.model) {
        const sdk = require("ai");
        return { ...sdk, ToolLoopAgent: class extends sdk.ToolLoopAgent {
          constructor(settings) { super({ ...settings, model: options.model }); }
        } };
      }
      if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`);
      return require(id);
    }, module, module.exports, { env: options.env || {} });
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
    db, calls, load,
    bootstrap: () => load("src/app/api/admin/mon-cahier-ia/bootstrap/route.ts").GET(),
    async ask(question, overrides = {}) {
      const handler = load("src/app/api/admin/mon-cahier-ia/assistant/route.ts").POST;
      return handler(new NextRequest("https://school.invalid/api/admin/mon-cahier-ia/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, academic_year: year, exam_date: "2026-10-16", ...overrides,
          ...(overrides.history_scope ? { history_scope: {
            context_key: load("src/lib/mon-cahier-ai/conversation-scope.ts").conversationContext("admin-a", institution), ...overrides.history_scope,
          } } : {}),
        }),
      }));
    },
  };
}

export { harness, institution, year, classes };

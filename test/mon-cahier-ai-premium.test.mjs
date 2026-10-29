import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(import.meta.url);
function loader(overrides = {}) {
  const loaded = new Map();
  const load = path => {
    if (loaded.has(path)) return loaded.get(path);
    let source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    if (path === "src/app/super/abonnements/page.tsx") source += "\nexports.saveAi = saveAiAction;";
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function("require", "module", "exports", code)(id => {
      if (id in overrides) return overrides[id];
      if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`);
      return require(id);
    }, module, module.exports);
    loaded.set(path, module.exports); return module.exports;
  };
  return load;
}
test("module state fails closed on lookup failure, absence and expiry, without trusting truthy values", async () => {
  const api = loader()("src/lib/mon-cahier-ai/module.ts");
  for (const [row, error, enabled, reason] of [
    [null, null, false, "disabled"], [{ ai_premium_enabled: "true" }, null, false, "disabled"],
    [{ ai_premium_enabled: true, expires_on: "2020-01-01" }, null, false, "expired"],
    [{ ai_premium_enabled: true }, null, true, "active"], [null, { message: "offline" }, false, "unavailable"],
  ]) {
    const filters = [];
    const q = { select: () => q, eq: (k, v) => { filters.push([k, v]); return q; }, maybeSingle: async () => ({ data: row, error }) };
    const state = await api.getAiModuleState({ from: () => q }, "school-a");
    assert.equal(state.enabled, enabled); assert.equal(state.reason, reason);
    assert.deepEqual(filters, [["institution_id", "school-a"]]);
  }
});
test("request budget stops repeated analyses without writing a counter to the database", async () => {
  const api = loader()("src/lib/mon-cahier-ai/module.ts");
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { ai_premium_enabled: true }, error: null }) };
  for (let i = 0; i < 20; i++) assert.equal(await api.aiModuleDeniedResponse({ from: () => q }, "school"), null);
  const response = await api.aiModuleDeniedResponse({ from: () => q }, "school");
  assert.equal(response.status, 429); assert.equal(response.headers.get("Retry-After"), "60");
});
test("cache coalesces concurrent identical work, isolates schools, expires and retries failures", async () => {
  const { reuseAiAnalysis } = loader()("src/lib/mon-cahier-ai/analysis-cache.ts");
  let release, calls = 0;
  const one = reuseAiAnalysis("school-a/user/scope", async () => { calls++; await new Promise(resolve => { release = resolve; }); return { students: ["a"] }; });
  const two = reuseAiAnalysis("school-a/user/scope", async () => { throw new Error("duplicate work"); });
  release(); assert.equal((await one).reused, false); assert.equal((await two).reused, true); assert.equal(calls, 1);
  assert.deepEqual((await reuseAiAnalysis("school-b/user/scope", async () => ({ students: ["b"] }))).value.students, ["b"]);
  assert.equal((await reuseAiAnalysis("school-a/user/scope", async () => ({ fresh: true }), Date.now() + 181_000)).value.fresh, true);
  await assert.rejects(reuseAiAnalysis("failed", async () => { throw new Error("unavailable"); }));
  assert.equal((await reuseAiAnalysis("failed", async () => 1)).value, 1);
});
test("cache limits simultaneous distinct work, entry count and retained bytes", async () => {
  const { reuseAiAnalysis } = loader()("src/lib/mon-cahier-ai/analysis-cache.ts");
  let releaseA, releaseB;
  const a = reuseAiAnalysis("a", () => new Promise(resolve => { releaseA = resolve; }));
  const b = reuseAiAnalysis("b", () => new Promise(resolve => { releaseB = resolve; }));
  await assert.rejects(reuseAiAnalysis("c", async () => 3), /Deux analyses/);
  releaseA(1); releaseB(2); await Promise.all([a, b]);
  for (const key of ["c", "d", "e"]) await reuseAiAnalysis(key, async () => key);
  assert.equal((await reuseAiAnalysis("a", async () => "new")).reused, false);
  await reuseAiAnalysis("huge", async () => "x".repeat(8 * 1024 * 1024 + 1));
  assert.equal((await reuseAiAnalysis("huge", async () => "small")).reused, false);
});
test("only super admin can save activation; expiry and actor are validated on the server", async () => {
  for (const superAdmin of [false, true]) {
    const writes = [], invalidations = [];
    const db = { auth: { getUser: async () => ({ data: { user: { id: "trusted-actor" } } }) }, from(table) {
      const q = { select: () => q, eq: () => q,
        upsert: async data => { writes.push({ table, data }); return { error: null }; },
        then: (resolve, reject) => Promise.resolve({ data: [{ role: superAdmin ? "super_admin" : "admin" }], error: null }).then(resolve, reject) };
      return q;
    } };
    const api = loader({
      "next/navigation": { redirect: path => { throw new Error("redirect:" + path); } },
      "next/cache": { revalidatePath: path => invalidations.push(path) },
      "@/lib/supabase-server": { getSupabaseServerClient: async () => db },
      "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => db },
    })("src/app/super/abonnements/page.tsx");
    const form = new FormData(); form.set("institution_id", "00000000-0000-0000-0000-000000000001");
    form.set("ai_premium_enabled", "on"); form.set("updated_by", "untrusted-actor");
    if (!superAdmin) { await assert.rejects(api.saveAi(form), /forbidden/); assert.equal(writes.length, 0); }
    else {
      await api.saveAi(form); assert.equal(writes[0].data.ai_premium_enabled, true);
      assert.equal(writes[0].data.updated_by, "trusted-actor"); assert.equal(writes[0].data.expires_on, null);
      form.set("ai_expires_on", "2020-01-01"); await assert.rejects(api.saveAi(form), /dépassée/);
      assert.equal(writes.length, 1);
      form.set("ai_expires_on", ""); form.delete("ai_premium_enabled"); await api.saveAi(form);
      assert.equal(writes[1].data.ai_premium_enabled, false);
    }
  }
});
test("SQL defaults to disabled, denies self-activation and direct prediction RPC, and permits trusted service access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.institutions(id uuid primary key);
      create function public.predict_success_for_class(uuid,uuid,text,date,numeric) returns integer language sql as 'select 1';
      insert into public.institutions values ('00000000-0000-0000-0000-000000000001');`);
    await db.exec(fs.readFileSync(new URL("../supabase/migrations/20261029120902_mon_cahier_ai_premium_access.sql", import.meta.url), "utf8"));
    assert.equal((await db.query("select count(*)::int count from institution_ai_module_settings")).rows[0].count, 0);
    await db.exec("set role authenticated;");
    await assert.rejects(db.query("select * from institution_ai_module_settings"), /permission denied/);
    await assert.rejects(db.exec("insert into institution_ai_module_settings(institution_id,ai_premium_enabled) values ('00000000-0000-0000-0000-000000000001',true)"), /permission denied/);
    await assert.rejects(db.query("select public.predict_success_for_class(null,null,null,null,null)"), /permission denied/);
    await db.exec("reset role; set role service_role;");
    await db.exec("insert into institution_ai_module_settings(institution_id) values ('00000000-0000-0000-0000-000000000001')");
    assert.equal((await db.query("select ai_premium_enabled from institution_ai_module_settings")).rows[0].ai_premium_enabled, false);
    assert.equal((await db.query("select public.predict_success_for_class(null,null,null,null,null) value")).rows[0].value, 1);
  } finally { await db.close(); }
});

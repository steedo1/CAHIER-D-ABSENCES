import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function moduleFrom(path, dependencies = {}) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  });
  return exports;
}
const permanents = moduleFrom("src/lib/finance/payroll-permanents.ts");

function fixture({ signedIn = true, initialCycle = null } = {}) {
  const changes = [];
  let settings = { teacher_payroll: { permanent_cycles: initialCycle ? { teacher: initialCycle } : {} } };
  let pay = { profile_id: "teacher", employment_type: "permanent", payroll_enabled: true, notes: "Conservée" };
  const profile = { id: "teacher", display_name: "Enseignant test", institution_id: "institution", email: null, phone: null };
  function from(name) {
    const filters = {};
    let mutation;
    const query = {
      select() { return query; }, eq(key, value) { filters[key] = value; return query; }, in() { return query; }, order() { return query; },
      upsert(payload) { mutation = payload; return query; },
      maybeSingle: async () => result(true), single: async () => result(true),
      then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
    };
    function result(single) {
      let rows;
      if (name === "user_roles") rows = filters.role === "admin"
        ? [{ institution_id: "institution", profile_id: "admin" }]
        : filters.profile_id && filters.profile_id !== "teacher" ? [] : [{ profile_id: "teacher" }];
      else if (name === "profiles") rows = [filters.id === "admin" ? { id: "admin", institution_id: "institution" } : profile];
      else if (name === "teacher_pay_profiles") {
        if (mutation) {
          changes.push({ type: "profile", ...mutation });
          pay = mutation;
        }
        rows = [pay];
      } else throw new Error(`Unexpected table ${name}`);
      return { data: single ? rows[0] || null : rows, error: null };
    }
    return query;
  }
  const admin = { from, schema() { return admin; } };
  const api = moduleFrom("src/app/api/admin/teachers/payroll-profile/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: "admin" } : null } }) } }) },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => admin },
    "@/lib/finance/payroll-permanents": permanents,
    "@/lib/finance/payroll-settings": {
      readPayrollSettings: async () => settings,
      savePermanentCycle: async (_admin, institutionId, teacherId, cycle) => {
        changes.push({ type: "category", institutionId, teacherId, cycle });
        settings = permanents.settingsWithPermanentCycle(settings, teacherId, cycle);
      },
    },
  });
  const post = (body, suffix = "") => api.POST(new Request(`https://example.test/api/admin/teachers/payroll-profile${suffix}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { api, post, changes };
}

test("profile API saves college category and returns the same 21-hour quota on the next read", async () => {
  const { post, api, changes } = fixture();
  const response = await post({ profile_id: "teacher", employment_type: "permanent", permanent_cycle: "college", notes: "Conservée" });
  assert.equal(response.status, 200);
  const saved = (await response.json()).item;
  assert.equal(saved.permanent_cycle, "college");
  assert.equal(saved.weekly_quota, 21);
  assert.equal(saved.notes, "Conservée");
  const read = await api.GET(new Request("https://example.test/api/admin/teachers/payroll-profile"));
  assert.equal((await read.json()).items[0].permanent_cycle, "college");
  assert.equal(changes[0].institutionId, "institution");
  assert.equal(changes[0].teacherId, "teacher");
});

test("profile API saves lycée category with an 18-hour quota", async () => {
  const { post } = fixture();
  const response = await post({ profile_id: "teacher", employment_type: "permanent", permanent_cycle: "lycee" });
  assert.equal((await response.json()).item.weekly_quota, 18);
});

test("invalid permanent category is rejected before settings or profile changes", async () => {
  const { post, changes } = fixture();
  const response = await post({ profile_id: "teacher", employment_type: "permanent", permanent_cycle: "other" });
  assert.equal(response.status, 400);
  assert.deepEqual(changes, []);
});

test("unsigned-in or another institution's teacher cannot change a payroll profile", async () => {
  const denied = fixture({ signedIn: false });
  assert.equal((await denied.post({ profile_id: "teacher", permanent_cycle: "college" })).status, 401);
  assert.deepEqual(denied.changes, []);
  const foreign = fixture();
  assert.equal((await foreign.post({ profile_id: "foreign-teacher", permanent_cycle: "college" }, "?institution_id=foreign-institution")).status, 400);
  assert.deepEqual(foreign.changes, []);
});

test("legacy profile clients can update notes without clearing the permanent category", async () => {
  const { post, changes } = fixture({ initialCycle: "lycee" });
  const response = await post({ profile_id: "teacher", employment_type: "permanent", notes: "Nouvelle note" });
  const item = (await response.json()).item;
  assert.equal(item.permanent_cycle, "lycee");
  assert.equal(item.weekly_quota, 18);
  assert.equal(item.notes, "Nouvelle note");
  assert.equal(changes.filter((row) => row.type === "category").length, 0);
});

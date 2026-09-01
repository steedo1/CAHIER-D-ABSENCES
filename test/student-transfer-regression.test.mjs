import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as membership from "../src/lib/student-class-membership.ts";

// Execute the real handlers with an authenticated institution and a small
// database double enforcing the production columns and enrollment date check.
const require = createRequire(import.meta.url);
function load(path, mocks) {
  const file = new URL(`../${path}`, import.meta.url);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => id in mocks ? mocks[id] : require(id), module, module.exports,
  );
  return module.exports;
}

const inst = "school-a";
const year = "2026-2027";
const student = (id, extra = {}) => ({
  id, institution_id: inst, last_name: "N'GUESSAN", first_name: "Élodie Ange-Marie",
  matricule: null, lifecycle_status: "active", exit_date: null, exit_reason: null,
  is_affecte: true, is_boarder: false, ...extra,
});
const cls = (id, extra = {}) => ({
  id, institution_id: inst, label: id, code: id, level: "2A",
  official_track_code: "2ndeA", academic_year: year, ...extra,
});
const enrollment = (id, classId, studentId, start = "2026-09-09", extra = {}) => ({
  id, institution_id: inst, class_id: classId, student_id: studentId,
  start_date: start, end_date: null, official_track_code: "2ndeA", ...extra,
});

function database(seed, fail = () => false, before = async () => {}) {
  const tables = structuredClone({ students: [], classes: [], class_enrollments: [],
    academic_years: [], student_year_profiles: [],
    profiles: [{ id: "admin", institution_id: inst }],
    user_roles: [{ profile_id: "admin", role: "admin", institution_id: inst }],
    institutions: [{ id: inst, name: "Test school" }], educator_class_assignments: [], ...seed });
  const calls = [];
  const value = (row, key) => key === "classes.academic_year"
    ? tables.classes.find((c) => c.id === row.class_id)?.academic_year : row[key];
  const srv = { auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) }, from(table) {
    const q = { table, action: "read", filters: [], orders: [], offset: 0, count: Infinity,
      select(columns) { this.columns = columns; return this; },
      eq(key, expected) { this.filters.push((r) => value(r, key) === expected); return this; },
      neq(key, expected) { this.filters.push((r) => value(r, key) !== expected); return this; },
      is(key, expected) { return this.eq(key, expected); },
      in(key, expected) { this.filters.push((r) => expected.includes(value(r, key))); return this; },
      or(expression) {
        const clauses = expression.split(",").map((clause) => {
          const [key, op, ...rest] = clause.split("."); const expected = rest.join(".");
          return (row) => op === "is" ? value(row, key) == null
            : op === "neq" ? value(row, key) != null && value(row, key) !== expected
            : op === "ilike" ? String(value(row, key) || "").toUpperCase().includes(expected.replaceAll("%", "").toUpperCase())
            : (() => { throw new Error(`Unsupported filter: ${clause}`); })();
        });
        this.filters.push((row) => clauses.some((matches) => matches(row))); return this;
      },
      ilike(key, pattern) {
        this.filters.push((r) => String(r[key]).toUpperCase().includes(pattern.replaceAll("%", "").toUpperCase()));
        return this;
      },
      order(key, opts = {}) { this.orders.push([key, opts.ascending !== false]); return this; },
      range(start, end) { this.offset = start; this.count = end - start + 1; return this; },
      limit(count) { this.count = count; return this; },
      maybeSingle() { this.single = true; return this; },
      update(patch) { this.action = "update"; this.patch = patch; return this; },
      insert(rows) { this.action = "insert"; this.patch = Array.isArray(rows) ? rows : [rows]; return this; },
      upsert(row) { this.action = "upsert"; this.patch = row; return this; },
      delete() { this.action = "delete"; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(async () => {
          calls.push({ table, action: this.action, offset: this.offset, patch: structuredClone(this.patch) });
          await before(this);
          if (/classes[^()]*\([^)]*\bname\b/.test(this.columns || "")) {
            return { data: null, error: { code: "42703", message: "column classes_1.name does not exist" } };
          }
          if (fail(this)) return { data: null, error: { message: "simulated database failure" } };
          let rows = tables[table].filter((r) => this.filters.every((f) => f(r)));
          if (this.action === "update" || this.action === "insert") {
            const next = this.action === "insert" ? this.patch : rows.map((r) => ({ ...r, ...this.patch }));
            if (table === "class_enrollments" && next.some((r) => r.end_date && r.end_date < r.start_date)) {
              return { data: null, error: { code: "23514", message: "chk_dates_coherent" } };
            }
            if (this.action === "insert") {
              rows = next.map((r, i) => ({ id: `inserted-${tables[table].length + i}`, ...r }));
              tables[table].push(...rows);
            } else rows.forEach((r) => Object.assign(r, this.patch));
          } else if (this.action === "delete") {
            tables[table] = tables[table].filter((r) => !rows.includes(r));
          } else if (this.action === "upsert") {
            rows = [this.patch]; tables[table].push(this.patch);
          }
          rows.sort((a, b) => {
            for (const [key, asc] of this.orders) {
              const compared = String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
              if (compared) return asc ? compared : -compared;
            }
            return 0;
          });
          rows = rows.slice(this.offset, this.offset + this.count).map((r) => {
            const result = structuredClone(r);
            if (table === "class_enrollments" && this.columns?.includes("classes")) {
              result.classes = tables.classes.find((c) => c.id === r.class_id) ?? null;
            }
            if (table === "class_enrollments" && this.columns?.includes("students")) {
              result.students = tables.students.find((s) => s.id === r.student_id) ?? null;
            }
            return result;
          });
          return { data: this.single ? rows[0] ?? null : rows, error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  } };
  return { srv, tables, calls };
}

function handlers(db, accessError) {
  const financeCalls = [];
  let rollbacks = 0;
  const mocks = {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/student-class-membership": membership,
    "@/lib/student-identity-conflicts": load("src/lib/student-identity-conflicts.ts", { "./student-class-membership": membership }),
    "@/lib/supabase-server": { getSupabaseServerClient: async () => db.srv },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => db.srv },
    "next/cache": { revalidatePath() {} },
    "../../_helpers/institutionAccess": { requireInstitutionAccess: async () => accessError
      ? { error: Response.json({ error: "forbidden" }, { status: 403 }) }
      : { srv: db.srv, institutionId: inst, user: { id: "admin" }, roles: new Set(["admin"]) } },
    "@/lib/finance/student-finance-sync": { synchronizeStudentFinance: async (args) => {
      financeCalls.push(args);
      return { transfer: {}, reconciliation: {}, rollback: async () => { rollbacks++; } };
    } },
  };
  const series = load("src/lib/student-series-class-transfer.ts", mocks);
  mocks["@/lib/student-series-class-transfer"] = series;
  return {
    search: load("src/app/api/admin/students/search/route.ts", mocks).GET,
    assign: load("src/app/api/admin/enrollments/assign/route.ts", mocks).POST,
    series: series.transferStudentToSeriesClass,
    roster: load("src/app/api/admin/classes/[id]/roster/route.ts", mocks),
    importStudents: load("src/app/api/admin/students/import/route.ts", mocks).POST,
    financeCalls, get rollbacks() { return rollbacks; },
  };
}

async function search(h, params = {}) {
  return h.search(new Request(`https://example.test/search?${new URLSearchParams({
    last_name: "n guessan", first_name: "Elodie", academic_year: year, ...params,
  })}`));
}
async function assign(h, params = {}) {
  return h.assign(new Request("https://example.test/assign", { method: "POST",
    body: JSON.stringify({ action: "assign", class_id: "target", student_id: "one", ...params }) }));
}
function transferFixture(start = "2026-09-09") {
  return { students: [student("one")], classes: [cls("source"), cls("target")],
    class_enrollments: [enrollment("source-enrollment", "source", "one", start)],
    academic_years: [{ id: "year", institution_id: inst, code: year,
      start_date: "2026-09-09", end_date: "2027-07-11" }] };
}

test("identity search returns accented names and the class in the selected year", async () => {
  const db = database({ students: [student("one"), student("foreign", { institution_id: "school-b" })],
    classes: [cls("2A1"), cls("old", { academic_year: "2025-2026" })],
    class_enrollments: [enrollment("new", "2A1", "one"), enrollment("old", "old", "one")] });
  const response = await search(handlers(db));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.items.map((s) => [s.id, s.class_label]), [["one", "2A1"]]);
  assert.equal(body.ambiguous, false);
});

test("unaccented identity search reads the existing class label column", async () => {
  const db = database({ students: [student("one", { last_name: "KOUASSI", first_name: "Ange Aristide" })],
    classes: [cls("2A1")], class_enrollments: [enrollment("new", "2A1", "one")] });
  const response = await search(handlers(db), { last_name: "KOUASSI", first_name: "Ange" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items[0].class_label, "2A1");
});

test("identity search finds matches after the first 500 records and flags homonyms", async () => {
  const db = database({ students: [
    ...Array.from({ length: 510 }, (_, i) => student(`other-${i}`, { last_name: "AAAA", first_name: "Autre" })),
    student("one"), student("two", { first_name: "Élodie Alice" }),
  ] });
  const body = await (await search(handlers(db))).json();
  assert.deepEqual(body.items.map((s) => s.id).sort(), ["one", "two"]);
  assert.equal(body.ambiguous, true);
  assert.ok(db.calls.some((c) => c.table === "students" && c.offset === 500));
});

test("one complete given name is enough and a partial surname cannot select another child", async () => {
  const h = handlers(database({ students: [student("one")] }));
  assert.equal((await (await search(h, { first_name: "Marie" })).json()).items.length, 1);
  assert.equal((await (await search(h, { last_name: "GUESSAN" })).json()).items.length, 0);
  assert.equal((await (await search(h, { first_name: "" })).json()).identity_ready, false);
});

test("a limited homonym result still signals that more choices exist", async () => {
  const body = await (await search(handlers(database({ students: [student("one"), student("two")] })), { limit: "1" })).json();
  assert.equal(body.items.length, 1);
  assert.equal(body.ambiguous, true);
  assert.equal(body.has_more, true);
});

test("database errors and forbidden access never become successful empty searches", async () => {
  const db = database({ students: [student("one")] }, (q) => q.table === "class_enrollments");
  assert.equal((await search(handlers(db))).status, 400);
  const protectedDb = database({});
  assert.equal((await search(handlers(protectedDb, true))).status, 403);
  assert.equal(protectedDb.calls.length, 0);
});

test("transfer by selected identity before school starts respects the date constraint", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-01T10:00:00Z") });
  const db = database(transferFixture()); const h = handlers(db);
  const response = await assign(h);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(db.tables.class_enrollments.find((e) => e.class_id === "source").end_date, "2026-09-09");
  assert.equal(db.tables.class_enrollments.find((e) => e.class_id === "target").start_date, "2026-09-09");
  assert.deepEqual(h.financeCalls[0].sourceClassIds, ["source"]);
});

test("transfer by matricule during the year starts on the effective transfer date", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T10:00:00Z") });
  const seed = transferFixture(); seed.students[0].matricule = "TEST123";
  const db = database(seed);
  assert.equal((await assign(handlers(db), { student_id: null, matricule: "TEST123" })).status, 200);
  assert.equal(db.tables.class_enrollments.find((e) => e.class_id === "target").start_date, "2026-10-15");
});

test("previous-year closures keep their official end date", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-01T10:00:00Z") });
  const seed = transferFixture();
  seed.classes.push(cls("old", { academic_year: "2025-2026" }));
  seed.class_enrollments.push(enrollment("old-enrollment", "old", "one", "2025-09-01"));
  seed.academic_years.push({ id: "old-year", institution_id: inst, code: "2025-2026", start_date: "2025-09-01", end_date: "2026-07-18" });
  const db = database(seed);
  assert.equal((await assign(handlers(db))).status, 200);
  assert.equal(db.tables.class_enrollments.find((e) => e.class_id === "old").end_date, "2026-07-18");
});

test("a failed target write restores the source enrollment and invokes finance rollback", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-01T10:00:00Z") });
  const db = database(transferFixture(), (q) => q.table === "class_enrollments" && q.action === "insert");
  const h = handlers(db); const before = structuredClone(db.tables.class_enrollments);
  const response = await assign(h);
  assert.equal(response.status, 409);
  assert.deepEqual(db.tables.class_enrollments, before);
  assert.equal(h.rollbacks, 1);
});

test("series correction uses the same valid dates and its rollback restores both classes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-01T10:00:00Z") });
  const db = database(transferFixture()); const h = handlers(db);
  const before = structuredClone(db.tables.class_enrollments);
  const result = await h.series({ srv: db.srv, institutionId: inst, userId: "admin", studentId: "one",
    sourceClassId: "source", targetClass: cls("target"), officialTrackCode: "2ndeA" });
  assert.equal(db.tables.class_enrollments[0].end_date, "2026-09-09");
  assert.equal(db.tables.class_enrollments[1].start_date, "2026-09-09");
  await result.rollback();
  assert.deepEqual(db.tables.class_enrollments, before);
  assert.equal(h.rollbacks, 1);
});

test("reactivating a former target enrollment does not duplicate it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T10:00:00Z") });
  const seed = transferFixture();
  seed.class_enrollments.push(enrollment("target-enrollment", "target", "one", "2026-09-09", { end_date: "2026-09-20" }));
  const db = database(seed);
  assert.equal((await assign(handlers(db))).status, 200);
  assert.equal(db.tables.class_enrollments.length, 2);
  assert.equal(db.tables.class_enrollments.find((e) => e.class_id === "target").end_date, null);
});

test("identity and generic searches omit merged records while preserving legacy null statuses", async () => {
  const db = database({ students: [student("current"), student("legacy", { lifecycle_status: null }),
    student("merged", { lifecycle_status: "duplicate_merged" })] });
  const h = handlers(db);
  for (const params of [{}, { last_name: "", first_name: "", q: "GUESSAN" }]) {
    const body = await (await search(h, params)).json();
    assert.deepEqual(body.items.map((s) => s.id).sort(), ["current", "legacy"]);
  }
});

test("an old selected ID cannot reactivate a merged record or modify its finances", async () => {
  const seed = transferFixture(); seed.students[0].lifecycle_status = "duplicate_merged";
  const db = database(seed); const h = handlers(db);
  const response = await assign(h);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "student_already_merged");
  assert.equal(db.calls.some((call) => call.action !== "read"), false);
  assert.equal(h.financeCalls.length, 0);
});

test("create-and-assign also refuses a merged record found by matricule before updating it", async () => {
  const seed = transferFixture(); Object.assign(seed.students[0], { lifecycle_status: "duplicate_merged", matricule: "TEST123" });
  const db = database(seed);
  const response = await assign(handlers(db), { action: "create_and_assign", last_name: "Nom", first_name: "Prénom", matricule: "TEST123" });
  assert.equal(response.status, 409);
  assert.equal(db.calls.some((call) => call.action !== "read"), false);
});

test("creation without matricule catches punctuation/accent variants before any write", async () => {
  const db = database(transferFixture()); const h = handlers(db);
  const response = await assign(h, { action: "create_and_assign", last_name: "N GUESSAN", first_name: "ELODIE ANGE MARIE", matricule: null });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "student_identity_exists");
  assert.equal(db.calls.some((call) => call.action !== "read"), false);
  assert.equal(h.financeCalls.length, 0);
});

test("adding a new matricule cannot create a second identity beside a matricule-free record", async () => {
  const db = database(transferFixture());
  const response = await assign(handlers(db), { action: "create_and_assign", last_name: "N'GUESSAN", first_name: "Élodie Ange-Marie", matricule: "NEW123" });
  assert.equal(response.status, 409);
  assert.equal(db.tables.students.length, 1);
});

test("transferring the historical spelling cannot duplicate a current-year enrollment", async () => {
  const seed = transferFixture();
  seed.students.push(student("historical", { first_name: "ELODIE ANGE MARIE", matricule: "OLD123" }));
  const db = database(seed); const h = handlers(db);
  const response = await assign(h, { student_id: "historical" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "student_identity_already_enrolled");
  assert.equal(db.calls.some((call) => call.action !== "read"), false);
  assert.equal(h.financeCalls.length, 0);
  // The current record remains transferable; the historical one has no active enrollment.
  assert.equal((await assign(h)).status, 200);
});

test("distinct matricules allow real homonyms and missing given names cannot create a record", async () => {
  const seed = transferFixture(); seed.students[0].matricule = "OLD123";
  const db = database(seed); const h = handlers(db);
  assert.equal((await assign(h, { action: "create_and_assign", last_name: "N'GUESSAN", first_name: "Élodie Ange-Marie", matricule: "NEW123" })).status, 200);
  assert.equal(db.tables.students.length, 2);
  assert.equal((await assign(h, { action: "create_and_assign", last_name: "Nom", first_name: "" })).status, 400);
  assert.equal(db.tables.students.length, 2);
});

test("a failed identity lookup blocks creation rather than risking a duplicate", async () => {
  const db = database(transferFixture(), (q) => q.table === "students" && q.action === "read");
  const response = await assign(handlers(db), { action: "create_and_assign", last_name: "Nom", first_name: "Prénom" });
  assert.equal(response.status, 400);
  assert.equal(db.calls.some((call) => call.action !== "read"), false);
});

test("the roster creation endpoint has the same identity guard", async () => {
  const db = database(transferFixture());
  const response = await handlers(db).roster.POST(new Request("https://example.test/roster", { method: "POST", body: JSON.stringify({
    first_name: "ELODIE ANGE MARIE", last_name: "N GUESSAN", is_affecte: true, is_boarder: false,
  }) }), { params: Promise.resolve({ id: "target" }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "student_identity_exists");
  assert.equal(db.calls.some((call) => call.action !== "read"), false);
});

test("CSV import reports spelling variants before creating a second record", async () => {
  const seed = transferFixture();
  Object.assign(seed.students[0], { full_name: "N'GUESSAN Élodie Ange-Marie", full_name_key: "n'guessan elodie ange-marie" });
  const db = database(seed);
  const response = await handlers(db).importStudents(new Request("https://example.test/import", { method: "POST", body: JSON.stringify({
    action: "commit", class_id: "target", csv: "NOM;PRENOM;MATRICULE\nN GUESSAN;ELODIE ANGE MARIE;NEW123",
  }) }));
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).identity_conflict_rows, [2]);
  assert.equal(db.calls.some((call) => call.action !== "read"), false);
});

test("roster overlaps independent queries and preserves authorization and class output", async () => {
  let releaseProfile, releaseInstitution;
  const profileGate = new Promise((resolve) => { releaseProfile = resolve; });
  const institutionGate = new Promise((resolve) => { releaseInstitution = resolve; });
  const seed = transferFixture();
  seed.profiles = [{ id: "admin", institution_id: inst }, { id: "educator", display_name: "Educator" }];
  seed.user_roles = [{ profile_id: "admin", role: "admin", institution_id: inst }, { profile_id: "educator", role: "educator", institution_id: inst }];
  seed.educator_class_assignments = [{ institution_id: inst, profile_id: "educator", class_id: "source" },
    { institution_id: inst, profile_id: "not-an-educator", class_id: "source" }];
  const db = database(seed, () => false, async (q) => {
    if (q.table === "profiles" && q.columns === "id,institution_id") await profileGate;
    if (q.table === "institutions") await institutionGate;
  });
  const pending = handlers(db).roster.GET(new Request(`https://example.test/roster?academic_year=${year}`), { params: Promise.resolve({ id: "source" }) });
  await new Promise(setImmediate);
  assert.ok(db.calls.some((q) => q.table === "user_roles"), "roles must not wait on the profile");
  assert.equal(db.calls.some((q) => q.table === "class_enrollments"), false, "authorization must finish first");
  releaseProfile();
  await new Promise(setImmediate);
  assert.ok(db.calls.some((q) => q.table === "class_enrollments"), "roster must not wait on institution metadata");
  assert.ok(db.calls.some((q) => q.table === "educator_class_assignments"));
  releaseInstitution();
  const response = await pending; const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.students.map((s) => s.id), ["one"]);
  assert.deepEqual(body.staff.educators.map((s) => s.id), ["educator"]);
  assert.equal(body.totals.students, 1);
  assert.match(response.headers.get("Server-Timing"), /access;dur=.*data;dur=.*total;dur=/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("forbidden roster requests read no class data", async () => {
  const db = database({ ...transferFixture(), user_roles: [] });
  const response = await handlers(db).roster.GET(new Request(`https://example.test/roster?academic_year=${year}`), { params: Promise.resolve({ id: "source" }) });
  assert.equal(response.status, 403);
  assert.equal(db.calls.some((q) => ["classes", "class_enrollments", "institutions"].includes(q.table)), false);
});

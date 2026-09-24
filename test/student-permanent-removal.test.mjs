import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const routeFile = "src/app/api/admin/enrollments/remove/route.ts";
const migrationFile = "supabase/migrations/20260924002003_atomic_student_removal.sql";
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");

function loadRoute(requireInstitutionAccess) {
  const code = ts.transpileModule(read(routeFile), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const mocks = {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "../../_helpers/institutionAccess": { requireInstitutionAccess },
  };
  new Function("require", "module", "exports", code)(
    (name) => name in mocks ? mocks[name] : require(name), module, module.exports,
  );
  return module.exports.POST;
}

function fixture(options = {}) {
  const institutionId = "school-a";
  const studentId = "student-a";
  const classId = "class-a";
  const rows = {
    classes: [{ id: classId, institution_id: institutionId, academic_year: "2026-2027" }],
    students: [{ id: studentId, institution_id: institutionId, student_person_id: "person-a" }],
    class_enrollments: [{
      id: "enrollment-a", institution_id: institutionId, class_id: classId,
      student_id: studentId, end_date: null,
    }],
    ...options.rows,
  };
  const calls = [];
  const rpcData = options.rpcData ?? {
    deleted: true,
    student_id: studentId,
    student_person_deleted: true,
    receipts_deleted: 1,
    charges_deleted: 1,
  };
  const service = {
    from(table) {
      assert.ok(table in rows, `unexpected REST table: ${table}`);
      const filters = [];
      return {
        select() { return this; },
        eq(column, expected) {
          filters.push((row) => row[column] === expected);
          return this;
        },
        is(column, expected) {
          filters.push((row) => row[column] === expected);
          return this;
        },
        delete() { throw new Error("REST deletion bypasses the atomic RPC"); },
        async maybeSingle() {
          calls.push({ kind: "read", table });
          return options.readErrorTable === table
            ? { data: null, error: { message: "simulated read failure" } }
            : { data: (rows[table] ?? []).find((row) => filters.every((match) => match(row))) ?? null, error: null };
        },
      };
    },
    async rpc(name, args) {
      calls.push({ kind: "rpc", name, args });
      return options.rpcError
        ? { data: null, error: { message: "simulated atomic delete failure" } }
        : { data: rpcData, error: null };
    },
  };
  let allowedRoles;
  const access = options.accessError
    ? { error: Response.json({ error: "forbidden" }, { status: 403 }) }
    : { srv: service, institutionId };
  const POST = loadRoute(async ({ allowedRoles: roles }) => {
    allowedRoles = [...roles];
    return access;
  });
  const request = (body = { class_id: classId, student_id: studentId }) => new Request(
    "https://example.test/api/admin/enrollments/remove",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  return { POST, request, calls, rows, rpcData, get allowedRoles() { return allowedRoles; } };
}

test("Retirer valide la classe, l'élève et l'inscription, puis confie toute suppression à un seul RPC", async () => {
  const f = fixture();
  const response = await f.POST(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), f.rpcData);
  assert.deepEqual(f.calls, [
    { kind: "read", table: "classes" },
    { kind: "read", table: "students" },
    { kind: "read", table: "class_enrollments" },
    { kind: "rpc", name: "delete_student_completely_v1", args: {
      p_institution_id: "school-a", p_class_id: "class-a", p_student_id: "student-a",
    } },
  ]);
  assert.ok(f.allowedRoles.includes("admin"));
  assert.ok(f.allowedRoles.includes("finance"));
});

test("un échec du RPC est signalé sans suppression REST supplémentaire", async () => {
  const f = fixture({ rpcError: true });
  const response = await f.POST(f.request());
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /simulated atomic delete failure/);
  assert.equal(f.calls.filter((call) => call.kind === "rpc").length, 1);
});

test("un accès interdit s'arrête avant toute lecture ou suppression métier", async () => {
  const f = fixture({ accessError: true });
  const response = await f.POST(f.request());
  assert.equal(response.status, 403);
  assert.deepEqual(f.calls, []);
});

test("Retirer refuse les identifiants manquants et les classes d'un autre établissement", async () => {
  const missing = fixture();
  assert.equal((await missing.POST(missing.request({ student_id: "student-a" }))).status, 400);
  assert.deepEqual(missing.calls, []);

  const foreign = fixture({ rows: { classes: [{ id: "class-a", institution_id: "school-b" }] } });
  assert.equal((await foreign.POST(foreign.request())).status, 400);
  assert.deepEqual(foreign.calls, [{ kind: "read", table: "classes" }]);
});

test("Retirer refuse un élève absent ou une inscription non active", async () => {
  const absent = fixture({ rows: { students: [] } });
  assert.equal((await absent.POST(absent.request())).status, 404);
  assert.equal(absent.calls.some((call) => call.kind === "rpc"), false);

  const inactive = fixture({ rows: { class_enrollments: [{
    id: "enrollment-a", institution_id: "school-a", class_id: "class-a",
    student_id: "student-a", end_date: "2026-09-20",
  }] } });
  assert.equal((await inactive.POST(inactive.request())).status, 404);
  assert.equal(inactive.calls.some((call) => call.kind === "rpc"), false);
});

test("une erreur de lecture empêche l'appel du RPC", async () => {
  const f = fixture({ readErrorTable: "class_enrollments" });
  const response = await f.POST(f.request());
  assert.equal(response.status, 400);
  assert.equal(f.calls.some((call) => call.kind === "rpc"), false);
});

test("la migration réserve le RPC atomique au service et ne masque pas ses erreurs", () => {
  const sql = read(migrationFile);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.delete_student_completely_v1\s*\(/i);
  assert.match(sql, /security\s+invoker/i);
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.delete_student_completely_v1[\s\S]*from\s+public/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.delete_student_completely_v1[\s\S]*to\s+service_role/i);
  assert.doesNotMatch(sql, /exception\s+when\s+others\s+then[\s\S]*?return/i);
  assert.match(sql, /delete\s+from\s+public\.students/i);
  assert.match(sql, /delete\s+from\s+public\.student_persons/i);
  for (const table of ["online_payment_intents", "receipt_allocations", "reminder_logs", "receipts", "student_charges"]) {
    assert.match(sql, new RegExp(`delete\\s+from\\s+finance\\.${table}`, "i"));
  }
});

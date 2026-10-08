import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import crypto from "node:crypto";
import ts from "typescript";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function evaluate(file, imports) {
  const exports = {};
  new Function("exports", "require", ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports, (name) => { assert.ok(name in imports, name); return imports[name]; });
  return exports;
}

function fixture() {
  const identity = { institutionId: "csca", classId: "3e1", actorProfileId: "phone", operationId: "open-test-call" };
  const sessionId = evaluate("src/lib/class-device-cloud-session.ts", { "node:crypto": crypto }).classDeviceCloudSessionId(identity);
  const endedAt = "2026-10-08T03:25:11.933Z";
  const tables = {
    classes: [{ id: "3e1", institution_id: "csca" }],
    teacher_sessions: [{ id: sessionId, class_id: "3e1", institution_id: "csca", created_by: "phone", ended_at: endedAt }],
    relay_attendance_session_causality: [{ institution_id: "csca", session_id: sessionId, last_operation_id: "final-call", last_captured_at_device: endedAt }],
  };
  let authorized = true, authenticated = true, failedTable = null;
  const service = { from(table) {
    let rows = [...tables[table]];
    return { select() { return this; }, eq(key, value) { rows = rows.filter((row) => row[key] === value); return this; },
      maybeSingle: async () => ({ data: rows[0] || null, error: table === failedTable ? { message: "unavailable" } : null }) };
  } };
  const route = evaluate("src/app/api/class/sync/reconcile-v2/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: "phone" } : null } }) } }) },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/class-device-identity": { classDeviceMayAccessClass: async () => authorized },
    "@/lib/class-device-cloud-session": evaluate("src/lib/class-device-cloud-session.ts", { "node:crypto": crypto }),
  });
  const completion = { class_id: "3e1", session_id: "client:open-test-call", open_operation_id: "open-test-call", ended_at: endedAt, relay_state: "device_pending" };
  return { tables, route, completion, sessionId,
    authorize(value) { authorized = value; }, authenticate(value) { authenticated = value; }, fail(table) { failedTable = table; },
    async check(value = completion) {
      const response = await route.POST({ json: async () => ({ class_id: "3e1", operations: [], completion: value }) });
      return { status: response.status, body: await response.json() };
    },
  };
}

test("PWA after a worker ACK: an empty outbox still verifies the final all-present call and close", async () => {
  const f = fixture();
  const result = await f.check();
  assert.equal(result.status, 200);
  assert.equal(result.body.completion.confirmed, true);
  assert.equal(result.body.completion.session_id, f.sessionId);
  assert.equal((await f.check({ ...f.completion, session_id: f.sessionId })).body.completion.confirmed, true);
});

for (const scenario of ["no receipt", "older student batch", "different closing time", "another class", "another actor", "receipt lookup failure"]) {
  test(`PWA never confirms a last call with ${scenario}`, async () => {
    const f = fixture();
    if (scenario === "no receipt") f.tables.relay_attendance_session_causality = [];
    if (scenario === "older student batch") f.tables.relay_attendance_session_causality[0].last_captured_at_device = "2026-10-08T03:24:00Z";
    if (scenario === "different closing time") f.tables.teacher_sessions[0].ended_at = "2026-10-08T03:25:12.000Z";
    if (scenario === "another class") f.tables.teacher_sessions[0].class_id = "4e2";
    if (scenario === "another actor") f.tables.teacher_sessions[0].created_by = "another-phone";
    if (scenario === "receipt lookup failure") f.fail("relay_attendance_session_causality");
    assert.equal((await f.check()).body.completion.confirmed, false);
  });
}

test("completion checks require authentication and class authorization", async () => {
  const f = fixture(); f.authorize(false);
  assert.equal((await f.check()).status, 403);
  f.authorize(true); f.authenticate(false);
  assert.equal((await f.check()).status, 401);
});

test("a late Cloud confirmation cannot overwrite a newer local call, or remove protected actions", async () => {
  const source = ts.createSourceFile("fake.ts", read("test/offline-outbox-ordering.test.ts"), ts.ScriptTarget.Latest, true);
  const fake = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "installFakeIndexedDb");
  const restore = new Function(`${ts.transpileModule(fake.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return installFakeIndexedDb;`)()();
  try {
    const offline = evaluate("src/lib/offline.ts", {
      "@/lib/attendance-cache-contract": { isTeacherCacheKey: () => false, isTeacherScheduleKey: () => false },
      "@/lib/attendance-cache-identity": { attendanceAuthGeneration: () => 1 },
      "@/lib/offline-release": { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1 },
      "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
    });
    const first = fixture().completion;
    await offline.cacheSet("classDevice:last-completion:v1", first);
    await offline.offlineMutateJson("/api/test-protected", { method: "POST", body: { value: "kept" } }, { queueOnly: true, operationId: "protected-action" });
    await offline.confirmClassDeviceCompletionInCloud(first);
    assert.equal((await offline.cacheGet("classDevice:last-completion:v1")).relay_state, "cloud_confirmed");
    const newer = { ...first, session_id: "client:next-course", ended_at: "2026-10-08T04:00:00Z" };
    await offline.cacheSet("classDevice:last-completion:v1", newer);
    await offline.confirmClassDeviceCompletionInCloud(first);
    assert.deepEqual(await offline.cacheGet("classDevice:last-completion:v1"), newer);
    assert.equal((await offline.listOfflineOutboxEntries())[0].operationId, "protected-action");
  } finally { restore(); }
});

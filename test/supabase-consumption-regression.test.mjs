import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, imports = {}) {
  const exports = {};
  new Function("exports", "require", ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports, (name) => { assert.ok(name in imports, name); return imports[name]; });
  return exports;
}
function recoveryFixture() {
  const cached = new Map([["classDevice:my-classes", { items: [{ id: "class-a", institution_id: "school-a" }] }]]);
  const journals = { opens: [], attendance: [], lifecycle: [] };
  let requests = 0;
  const api = load("src/lib/class-device-sync-reconcile-v2.ts", {
    "@/lib/offline": { cacheGet: async (key) => cached.get(key), listOfflineOutboxEntries: async () => [] },
    "@/lib/attendance-network": { fetchAttendanceBackground: async () => { requests++; return Response.json({ items: [] }); } },
    "@/lib/teacher-session-delivery": { listTeacherSessionOpenOperations: async () => journals.opens },
    "@/lib/teacher-attendance-delivery": { listTeacherAttendanceOperations: async () => journals.attendance },
    "@/lib/teacher-session-lifecycle-delivery": { listTeacherSessionLifecycleOperations: async () => journals.lifecycle },
  });
  return { api, cached, journals, requests: () => requests };
}
test("idle class recovery performs zero HTTP requests over 720 background ticks", async () => {
  const f = recoveryFixture();
  for (let i = 0; i < 720; i++) assert.equal((await f.api.repairClassDeviceSyncV2()).after, 0);
  assert.equal(f.requests(), 0);
  await f.api.repairClassDeviceSyncV2({ force: true });
  assert.equal(f.requests(), 1, "explicit recovery still discovers fresh authorized classes");
});
test("pending journals, receipts and queue rows keep recovery; confirmed records do not", async () => {
  const f = recoveryFixture();
  for (const [journal, state] of [["opens", "device_pending"], ["attendance", "delivery_unknown"], ["lifecycle", "device_pending"]]) {
    f.journals[journal] = [{ state, kind: "close" }];
    assert.equal(await f.api.classDeviceSyncHasPendingWork([]), true);
    f.journals[journal] = [];
  }
  f.journals.opens = [{ state: "cloud_opened" }];
  f.journals.attendance = [{ state: "cloud_synced" }, { state: "superseded" }];
  f.journals.lifecycle = [{ kind: "close", state: "cloud_confirmed" }];
  assert.equal(await f.api.classDeviceSyncHasPendingWork([]), false);
  assert.equal(await f.api.classDeviceSyncHasPendingWork([{ operationType: "attendance", state: "blocked" }]), true);
  f.cached.set("classDevice:last-completion:v1", { relay_state: "device_pending" });
  assert.equal(await f.api.classDeviceSyncHasPendingWork([]), true);
  f.cached.clear();
  assert.equal(await f.api.classDeviceSyncHasPendingWork([]), true, "missing preparation cannot suppress discovery");
});
function routeFixture({ authorized = true, authenticated = true, failSessions = false, otherCreator = false } = {}) {
  let sessionReads = 0;
  const filters = [];
  const ids = Array.from({ length: 20 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`);
  const rows = ids.map((id) => ({ id, institution_id: "school-a", class_id: "class-a", created_by: otherCreator ? "other-user" : "phone" }));
  const service = { from(table) {
    if (table === "teacher_sessions") sessionReads++;
    let filtered = table === "classes" ? [{ id: "class-a", institution_id: "school-a" }] : [...rows];
    return { select() { return this; }, in(column, values) { filters.push([column, values]); filtered = filtered.filter((row) => values.includes(row[column])); return this; },
      eq(column, value) { filters.push([column, value]); filtered = filtered.filter((row) => row[column] === value); return this; },
      maybeSingle: async () => ({ data: filtered[0] || null, error: null }),
      then(resolve) { return Promise.resolve({ data: filtered, error: failSessions ? { message: "unavailable" } : null }).then(resolve); },
    };
  } };
  const route = load("src/app/api/class/sync/reconcile-v2/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: "phone" } : null } }) } }) },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/class-device-identity": { classDeviceMayAccessClass: async () => authorized },
    "@/lib/class-device-cloud-session": { classDeviceCloudSessionId: ({ operationId }) => ids[Number(operationId.slice(-2))] },
  });
  return { sessionReads: () => sessionReads, filters, run: () => route.POST({ json: async () => ({ class_id: "class-a", operations: ids.map((_, i) => ({ operation_id: `operation-${String(i).padStart(2, "0")}`, operation_type: "session-start" })) }) }) };
}
test("20 session proofs use one fresh tenant-scoped batch per API request", async () => {
  const f = routeFixture();
  const response = await f.run();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.acknowledged_operation_ids.length, 20);
  assert.equal(f.sessionReads(), 1);
  assert.ok(f.filters.some(([column, value]) => column === "institution_id" && value === "school-a"));
  assert.ok(f.filters.some(([column, value]) => column === "class_id" && value === "class-a"));
  await f.run(); assert.equal(f.sessionReads(), 2, "no attendance authorization cache between requests");
});
test("batch recovery fails closed on authentication, scope, lookup errors and another creator", async () => {
  for (const options of [{ authenticated: false }, { authorized: false }]) {
    const f = routeFixture(options); assert.ok([401, 403].includes((await f.run()).status)); assert.equal(f.sessionReads(), 0);
  }
  for (const options of [{ failSessions: true }, { otherCreator: true }]) {
    const payload = await (await routeFixture(options).run()).json();
    assert.equal(payload.acknowledged_operation_ids.length, 0);
  }
});
test("role requests share concurrent transport by actor and retain fresh later lookups", async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 5)); return Response.json({ role: "admin" }); };
  try {
    const { fetchAuthRole } = load("src/lib/auth/role-client.ts");
    const responses = await Promise.all(Array.from({ length: 20 }, () => fetchAuthRole("actor-a")));
    assert.equal(calls, 1); for (const response of responses) assert.equal((await response.json()).role, "admin");
    await fetchAuthRole("actor-a"); assert.equal(calls, 2);
    await Promise.all([fetchAuthRole("actor-a"), fetchAuthRole("actor-b")]); assert.equal(calls, 4);
  } finally { globalThis.fetch = previous; }
});
test("quota/rate-limit failures stop cloud replay probes and use progressive bounded retry", async () => {
  const previousFetch = globalThis.fetch, previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"), previousNow = Date.now;
  let clock = 1000, calls = 0, status = 402;
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  Date.now = () => clock; globalThis.fetch = async () => { calls++; return new Response("{}", { status }); };
  try {
    const api = load("src/lib/attendance-network.ts");
    assert.equal(await api.attendanceCloudAvailableForSync(), false);
    clock += 5000; assert.equal(await api.attendanceCloudAvailableForSync(), false); assert.equal(calls, 1);
    clock += 5000; status = 429; assert.equal(await api.attendanceCloudAvailableForSync(), false); assert.equal(calls, 2);
    clock += 19999; await api.attendanceCloudAvailableForSync(); assert.equal(calls, 2);
    clock++; status = 401; assert.equal(await api.attendanceCloudAvailableForSync(), true); assert.equal(calls, 3);
    clock += 1000; await api.attendanceCloudAvailableForSync(); assert.equal(calls, 3);
    api.resetAttendanceCloudProbe(); await api.attendanceCloudAvailableForSync(); assert.equal(calls, 4, "reconnection immediately permits a fresh probe");
  } finally { Date.now = previousNow; globalThis.fetch = previousFetch; if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete globalThis.navigator; }
});
function relayAgentFixture() {
  const file = "desktop/relay/src/cloud-sync-grade-v4-safe.mts";
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "createRelayCloudSyncAgent");
  let timer, wake, clock = 0, calls = 0, status = 402;
  const exports = {};
  new Function("exports", "syncRelayOnce", "registerRelayCloudSyncWake", "clearRelayCloudSyncWake", "setInterval", "clearInterval", ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports, async (_config, _store, options) => { await options.fetchImpl("https://example.invalid/pull"); }, (callback) => { wake = callback; }, () => {}, (callback) => { timer = callback; return { unref() {} }; }, () => {});
  const agent = exports.createRelayCloudSyncAgent({ cloudSyncIntervalMs: 15000 }, {}, {
    now: () => new Date(clock), fetchImpl: async () => { calls++; return new Response("{}", { status }); },
  });
  return { agent, calls: () => calls, status: (value) => { status = value; }, async tick(time) { clock = time; assert.equal(typeof timer, "function"); await wake(); }, wake: () => wake() };
}
test("relay retains normal heartbeat, pauses outage retries and permits explicit recovery", async () => {
  const f = relayAgentFixture(); f.agent.start(); await f.agent.runOnce(); assert.equal(f.calls(), 1);
  await f.tick(15000); await f.wake(); assert.equal(f.calls(), 1);
  await f.tick(30000); assert.equal(f.calls(), 2);
  await f.tick(60000); assert.equal(f.calls(), 2);
  await f.tick(90000); assert.equal(f.calls(), 3);
  await f.tick(150000); assert.equal(f.calls(), 3);
  f.status(200); await f.tick(210000); assert.equal(f.calls(), 4);
  await f.tick(225000); assert.equal(f.calls(), 5);
  f.status(402); await f.tick(240000); assert.equal(f.calls(), 6);
  f.status(200); await f.agent.runOnce(); assert.equal(f.calls(), 7);
  await f.agent.stop();
});
test("class institution metadata queries match the real schema and keep relay disabled without provisioning", async () => {
  const api = load("src/lib/class-device-access-server.ts", {
    "@/lib/education-attendance": { resolveAttendanceEducationContext: () => ({}) },
    "@/lib/attendance-presence-server": { createRelayAttendanceAccessToken: () => { throw new Error("must not issue token"); } },
    "@/lib/relay-endpoints": { relayEndpointCandidates: () => [] },
  });
  const service = { from(table) { return { select(columns) {
    if (table === "institutions") assert.ok(!columns.includes("short_name"));
    return { in: async () => ({ data: table === "institutions" ? [{ id: "school-a", name: "École", acronym: "E" }] : [], error: null }) };
  } }; } };
  const value = await api.enrichClassDeviceAccess({ items: [{ id: "class-a", institution_id: "school-a" }], actorProfileId: "actor", service });
  assert.equal(value.items[0].institution_name, "École");
  assert.equal(value.items[0].attendance_presence.relay_access_token, null);
});

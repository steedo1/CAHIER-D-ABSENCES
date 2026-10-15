import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function load(path, imports = {}) {
  const exports = {};
  new Function("exports", "require", compile(read(path)))(exports, (name) => {
    assert.ok(name in imports, `${path}: ${name}`);
    return imports[name];
  });
  return exports;
}
function declaration(path, name) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, name);
  return found.getText(source);
}

const snapshot = (revision = 100, preparation = 90, actor = "teacher-a") => ({
  institution_id: "school-a", actor_profile_id: actor,
  schedule_revision: revision, preparation_revision: preparation,
});
function fixture(options = {}) {
  const undoDb = new Function(compile(declaration("test/offline-outbox-ordering.test.ts", "installFakeIndexedDb")) + "; return installFakeIndexedDb;")()();
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  globalThis.window = { setTimeout, clearTimeout, dispatchEvent() {} };
  let actor = "teacher-a", generation = 1, cloud = { ok: true, ...snapshot(102) };
  const known = new Map();
  const identity = {
    attendanceCacheActor: async () => actor,
    attendanceAuthGeneration: () => generation,
    knownScheduleRevision: (institutionId) => known.get(institutionId) ?? null,
    observeScheduleRevision: (institutionId, revision) => known.set(institutionId, Math.max(known.get(institutionId) ?? 0, revision)),
  };
  const release = { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1, MON_CAHIER_SERVICE_WORKER_RELEASE: "worker", MON_CAHIER_WEB_RELEASE: "web" };
  const offline = load("src/lib/offline.ts", {
    "@/lib/attendance-cache-contract": load("src/lib/attendance-cache-contract.ts"),
    "@/lib/attendance-cache-identity": identity,
    "@/lib/offline-release": release,
    "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
  });
  const slots = [1, 2].map((day) => ({ key: `${day}|07:15|08:10`, weekday: day,
    start_time: "07:15", end_time: "08:10", items: [{ class_id: `class-${day}`, subject_id: "math" }] }));
  const requests = [], writes = [], warmed = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (options.respond) {
      const result = await options.respond(String(url));
      if (result) return result;
    }
    if (String(url).includes("offline/bootstrap")) return Response.json({ version: 1,
      ...snapshot(), snapshot_completeness: "complete", slots, assignments: [], generated_at: "now" });
    if (String(url).includes("institution/basics")) return Response.json({ ...snapshot(101),
      periods: slots, tz: "Africa/Abidjan", attendance_presence: options.relay
        ? { relay_local_url: "http://192.168.1.2:4317", relay_access_token: "test-teacher-token" }
        : { allow_local_relay: false } });
    if (String(url).includes("roster")) return Response.json({ items: [{ id: new URL(String(url), "https://fixture.invalid").searchParams.get("class_id") + "-student" }] });
    if (String(url).includes("schedule-status")) return Response.json(cloud);
    throw new Error(`Unexpected URL: ${url}`);
  };
  const api = load("src/lib/offline-readiness.ts", {
    "@/lib/attendance-cache-identity": identity,
    "@/lib/attendance-cache-contract": load("src/lib/attendance-cache-contract.ts"),
    "@/lib/offline": { ...offline, ...release,
      cacheSetMany: async (entries) => { writes.push(structuredClone(entries)); return offline.cacheSetMany(entries); },
      warmOfflineShell: async (paths) => warmed.push(paths),
      getActiveOfflineWorkerInfo: async () => ({ offlineSchemaVersion: 1, release: "worker" }),
    },
    "@/lib/offline-grades": {}, "@/lib/offline-textbook": {}, "@/lib/offline-bulletins": {},
    "@/lib/offline-communication": {}, "@/lib/offline-parent": {},
    "@/lib/local-relay": {
      preferredRelayBaseUrl: ({ baseUrl }) => baseUrl,
      fetchRelayTeacherOfflineSchedule: async () => {
        assert.ok(options.relay);
        return { version: 1, ...snapshot(102), snapshot_completeness: "complete", slots,
          assignments: [], rosters: Object.fromEntries([1, 2].map((index) => [`class-${index}`, { items: [{ id: `relay-student-${index}` }] }])) };
      },
      checkRelayTeacherConnectivity: async () => { assert.ok(options.relay); return { status: "unreachable" }; },
    },
    "@/lib/cloud-availability": { probeCloudSchedule: async () => cloud,
      rememberCloudScheduleStatus: async (value) => { cloud = value; identity.observeScheduleRevision(value.institution_id, value.schedule_revision); } },
    "@/lib/class-device-preparation-revision": {},
    "@/lib/offline-preparation-failure": load("src/lib/offline-preparation-failure.ts"),
    "@/lib/offline-release": release,
    "@/lib/relay-capability": { relayEnabledForInstitution: () => false },
    "@/lib/offline-schedule-policy": {}, "@/lib/offlineClassDevice": {},
  });
  return { api, offline, requests, writes, warmed, known,
    setCloud(value) { cloud = value; if (value) identity.observeScheduleRevision(value.institution_id, value.schedule_revision); },
    switchActor(value) { actor = value; generation++; },
    close() { undoDb(); globalThis.window = previous.window; globalThis.fetch = previous.fetch; } };
}

test("a teacher phone finishes preparation while other calls advance the live revision", async () => {
  const f = fixture();
  try {
    await f.offline.offlineMutateJson("/api/test-protected", { method: "POST", body: { value: "kept" } }, { queueOnly: true, operationId: "pending-call" });
    const ready = await f.api.prepareOffline("teacher");
    assert.equal(ready.preparation_revision, 90);
    assert.equal(ready.schedule_revision, 102);
    assert.equal(ready.class_count, 2);
    assert.equal(ready.student_count, 2);
    assert.equal((await f.api.assessTeacherOfflineReadiness(ready)).status, "ready");
    assert.deepEqual(f.warmed, [["/attendance", "/login"]]);
    assert.equal(f.writes.length, 1, "the complete bundle is committed once");
    assert.ok(f.requests.filter((url) => /bootstrap|basics/.test(url)).every((url) => url.endsWith("offline_preparation=v1")));
    assert.equal((await f.offline.listOfflineOutboxEntries())[0].operationId, "pending-call");
  } finally { f.close(); }
});

test("a live revision change reuses the prepared rosters, including after losing Internet", async () => {
  const f = fixture();
  try {
    const original = await f.api.prepareOffline("teacher");
    const requestCount = f.requests.length;
    f.setCloud({ ok: true, ...snapshot(110) });
    const stored = await f.api.getOfflineReadiness("teacher");
    assert.ok(stored, "the prepared bundle survives revision-scoped cache invalidation");
    const checked = await f.api.assessTeacherOfflineReadiness(stored);
    assert.equal(checked.status, "ready");
    assert.equal(checked.readiness.schedule_revision, 110);
    assert.equal(checked.readiness.prepared_at, original.prepared_at);
    assert.equal(f.requests.length, requestCount, "no roster or bootstrap download");
    assert.equal((await f.offline.cacheGet("teacher:roster:class-1")).items[0].id, "class-1-student");
    f.setCloud(null);
    assert.equal((await f.api.assessTeacherOfflineReadiness(await f.api.getOfflineReadiness("teacher"))).status, "ready");
  } finally { f.close(); }
});

test("a genuine timetable change refuses promotion and keeps the previous local bundle", async () => {
  const f = fixture();
  try {
    await f.api.prepareOffline("teacher");
    const before = await f.offline.cacheGet("teacher:prepared-bundle:v1");
    f.setCloud({ ok: true, ...snapshot(110, 91) });
    const assessed = await f.api.assessTeacherOfflineReadiness(await f.api.getOfflineReadiness("teacher"));
    assert.equal(assessed.status, "phone_stale");
    assert.deepEqual(await f.offline.cacheGet("teacher:prepared-bundle:v1"), before);
    f.switchActor("teacher-b");
    assert.equal(await f.api.getOfflineReadiness("teacher"), null);
  } finally { f.close(); }
});

for (const [label, change] of [
  ["a timetable change", { preparation_revision: 91 }],
  ["another teacher", { actor_profile_id: "teacher-b" }],
  ["another institution", { institution_id: "school-b" }],
  ["a missing stable proof", { preparation_revision: null }],
  ["an older confirmation", { schedule_revision: 99 }],
]) test(`preparation refuses ${label} without replacing any local data`, async () => {
  const f = fixture({ respond: (url) => url.includes("schedule-status")
    ? Response.json({ ok: true, ...snapshot(102), ...change }) : null });
  try {
    await f.offline.cacheSet("classDevice:local-open", { id: "class-call", class_id: "TA" });
    await assert.rejects(f.api.prepareOffline("teacher"), /schedule_changed_during_prepare/);
    assert.equal(f.writes.length, 0);
    assert.equal(await f.api.getOfflineReadiness("teacher"), null);
    assert.deepEqual(await f.offline.cacheGet("classDevice:local-open"), { id: "class-call", class_id: "TA" });
  } finally { f.close(); }
});

test("a new teacher phone can start preparation automatically and duplicate triggers share one task", async () => {
  const f = fixture();
  try {
    const initial = await f.api.assessTeacherOfflineReadiness(null);
    assert.equal(initial.status, "not_prepared");
    assert.equal(initial.cloud_reachable, true);
    const [a, b] = await Promise.all([f.api.prepareOffline("teacher"), f.api.prepareOffline("teacher")]);
    assert.strictEqual(a, b);
    assert.equal(f.writes.length, 1);
    assert.equal(f.requests.filter((url) => url.includes("offline/bootstrap")).length, 1);
  } finally { f.close(); }
});

test("losing Internet before the newer revision is verified cannot revive an outdated packet", async () => {
  const f = fixture();
  try {
    await f.api.prepareOffline("teacher");
    f.setCloud({ ok: true, ...snapshot(110) });
    f.setCloud(null);
    const checked = await f.api.assessTeacherOfflineReadiness(await f.api.getOfflineReadiness("teacher"));
    assert.equal(checked.status, "phone_stale");
    assert.equal(f.writes.length, 1);
  } finally { f.close(); }
});

test("a fresh relay configuration is retained when the Cloud bootstrap fails on the first preparation", async () => {
  const f = fixture({ relay: true, respond: (url) => url.includes("offline/bootstrap") ? Response.json({ error: "unavailable" }, { status: 503 }) : null });
  try {
    const ready = await f.api.prepareOffline("teacher");
    assert.equal(ready.preparation_source, "relay");
    assert.equal(ready.class_count, 2);
    assert.equal(f.writes.length, 1);
    assert.equal((await f.offline.cacheGet("teacher:roster:class-1")).items[0].id, "relay-student-1");
  } finally { f.close(); }
});

test("an incomplete stored bundle never produces a ready card", async () => {
  const f = fixture();
  try {
    const ready = await f.api.prepareOffline("teacher");
    const bundle = await f.offline.cacheGet("teacher:prepared-bundle:v1");
    delete bundle.rosters["class-1"];
    await f.offline.cacheSet("teacher:prepared-bundle:v1", bundle);
    const assessment = await f.api.assessTeacherOfflineReadiness(ready);
    assert.equal(assessment.status, "not_prepared");
    assert.match(assessment.message, /incomplet/);
  } finally { f.close(); }
});

function query(rows) {
  let selected = rows;
  return {
    select() { return this; }, eq(key, value) { selected = selected.filter((row) => row[key] === value); return this; },
    is(key, value) { selected = selected.filter((row) => row[key] === value); return this; },
    order() { return this; }, limit() { return this; },
    async maybeSingle() { return { data: selected[0] || null, error: null }; },
    then(resolve, reject) { return Promise.resolve({ data: selected, error: null }).then(resolve, reject); },
  };
}
for (const [label, preparing, preparation, expected] of [
  ["live attendance during preparation", true, 90, 200],
  ["a genuine schedule change", true, 91, 409],
  ["the legacy strict protocol", false, 90, 409],
]) test(`the real bootstrap route handles ${label}`, async () => {
  let revisionReads = 0;
  const tables = {
    profiles: [{ id: "teacher-a", institution_id: "school-a" }],
    academic_years: [{ institution_id: "school-a", code: "2026-2027", is_current: true }],
    classes: [{ id: "class-1", institution_id: "school-a", label: "3e1", academic_year: "2026-2027" }],
    institution_periods: [{ id: "period-1", institution_id: "school-a", weekday: 1, start_time: "07:15", end_time: "08:10" }],
    teacher_timetables: [{ institution_id: "school-a", teacher_id: "teacher-a", class_id: "class-1", period_id: "period-1" },
      { institution_id: "school-a", teacher_id: "teacher-b", class_id: "class-2", period_id: "period-1" }],
    class_teachers: [],
  };
  const service = { from(table) {
    if (table === "attendance_schedule_revisions") {
      revisionReads++;
      return query([{ institution_id: "school-a", revision: revisionReads === 1 ? 100 : 110,
        preparation_revision: revisionReads === 1 ? 90 : preparation }]);
    }
    assert.ok(table in tables, table);
    return query(tables[table]);
  } };
  const route = load("src/app/api/teacher/offline/bootstrap/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "teacher-a" } } }) } }) },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/offline-release": { MON_CAHIER_WEB_RELEASE: "test" },
    "@/lib/attendance-schedule-revision-server": load("src/lib/attendance-schedule-revision-server.ts"),
  });
  const response = await route.GET(new Request(`https://fixture.invalid/api/teacher/offline/bootstrap${preparing ? "?offline_preparation=v1" : ""}`));
  assert.equal(response.status, expected);
  const body = await response.json();
  if (expected === 200) {
    assert.equal(body.preparation_revision, 90);
    assert.equal(body.schedule_revision, 110);
    assert.deepEqual(body.slots.flatMap((slot) => slot.items.map((item) => item.class_id)), ["class-1"]);
  } else assert.equal(body.error, "schedule_changed_during_prepare");
});

test("the rendered teacher card reaches ready automatically from an unprepared phone", async () => {
  const f = fixture();
  const { Window } = await import("happy-dom");
  const React = await import("react");
  const runtime = await import("react/jsx-runtime");
  const browser = new Window({ url: "https://fixture.invalid/attendance" });
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  keys.forEach((key) => Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? browser : browser[key] }));
  let root;
  try {
    const { createRoot } = await import("react-dom/client");
    const icons = Object.fromEntries(["AlertTriangle", "CloudDownload", "RefreshCcw", "ShieldCheck", "WifiOff"].map((name) => [name, () => null]));
    const Card = load("src/components/OfflineReadinessCard.tsx", {
      react: React, "react/jsx-runtime": runtime, "lucide-react": icons,
      "@/lib/offline-readiness": f.api, "@/lib/offline": f.offline,
      "@/lib/offlineClassDevice": { isClassDeviceOperationalReadiness: () => false },
      "@/lib/offline-preparation-failure": load("src/lib/offline-preparation-failure.ts"),
      "@/components/RelayCapabilityProvider": { useRelayCapability: () => ({ relayEnabled: false }) },
    }).default;
    const host = browser.document.createElement("div"); browser.document.body.append(host);
    root = createRoot(host);
    await React.act(async () => { root.render(React.createElement(Card, { role: "teacher" })); });
    for (let i = 0; i < 100 && !host.textContent.includes("Préparation réussie"); i++) {
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    assert.match(host.textContent, /Téléphone professeur prêt/);
    assert.match(host.textContent, /Préparation réussie/);
    assert.doesNotMatch(host.textContent, /pas encore prêt|Étape interrompue|relais/i);
    assert.equal(f.writes.length, 1);
  } finally {
    if (root) await React.act(async () => root.unmount());
    await browser.close();
    keys.forEach((key, index) => { if (previous[index]) Object.defineProperty(globalThis, key, previous[index]); else delete globalThis[key]; });
    f.close();
  }
});

test("a stalled JSON body releases the preparation after its deadline", async () => {
  let timeout, cleared = false;
  const get = new Function("window", "fetch", compile(declaration("src/lib/offline-readiness.ts", "fetchFreshJson")) + "; return fetchFreshJson;")(
    { setTimeout: (callback) => { timeout = callback; return 1; }, clearTimeout: () => { cleared = true; } },
    async () => ({ ok: true, json: () => new Promise(() => {}) }),
  );
  const pending = get("/api/teacher/offline/bootstrap");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleared, false, "the timeout must cover the body, not just HTTP headers");
  timeout();
  await assert.rejects(pending, /délai|répondu/);
  assert.equal(cleared, true);
});

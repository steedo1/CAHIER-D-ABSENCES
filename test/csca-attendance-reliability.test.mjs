import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
function method(file, name) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    else ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.ok(found, name);
  return found;
}
function scoped(source, result, state) {
  return new Function("state", `with (state) { ${compile(source.replace(/^export /gm, ""))} return ${result}; }`)(state);
}

for (const file of ["src/app/class/page.tsx", "src/components/teacher/TeacherDashboard.tsx"]) {
  test(`${file}: all-present call sends every pupil; stale rows never enter another roster`, () => {
    const state = {
      roster: [{ id: "a" }, { id: "b" }, { id: "c" }],
      observedNowIso: () => "2026-10-07T08:10:00.000Z",
    };
    const marks = scoped(method(file, "attendanceMarksFromRows"), "attendanceMarksFromRows", state);
    assert.deepEqual(marks({}).map((mark) => mark.status), ["present", "present", "present"]);
    const mixed = marks({ b: { absent: true }, c: { late: true, late_observed_at: "2026-10-07T08:05:00.000Z" }, old: { absent: true } });
    assert.deepEqual(mixed.map((mark) => mark.student_id), ["a", "b", "c"]);
    assert.deepEqual(mixed.map((mark) => mark.status), ["present", "absent", "late"]);
    assert.equal(mixed[2].observed_at, "2026-10-07T08:05:00.000Z");
  });
}

function classCloseState({ sessionId = "client:open-a", failClose = false, roster = [{ id: "a" }, { id: "b" }] } = {}) {
  const queued = [], saved = new Map();
  const open = { id: sessionId, class_id: "class-a", institution_id: "csca", subject_id: "eps", period_id: "p1", started_at: "2026-10-07T08:00:00.000Z" };
  const state = {
    openRef: { current: open }, open, roster, rows: {}, busy: false, loadingRoster: false,
    selectedClass: { id: "class-a", institution_id: "csca", actor_profile_id: "actor" },
    relayClassScheduleRef: { current: null }, periodsByDay: {}, duration: 60, inst: {}, penRubric: "discipline", msg: null,
    LAST_COMPLETION_KEY: "completion",
    window: { confirm: () => true }, observedNowIso: () => "2026-10-07T09:00:00.000Z",
    getClassDeviceCoherentSchedule: async () => null,
    cacheSet: async (key, value) => saved.set(key, value),
    buildPlannedRangeLabel: () => "08:00–09:00", saveClassDeviceSnapshot: (id, value) => saved.set(id, value),
    clearReminderLoop() {}, setSubjects() {}, setManualSubjectMode() {}, setSubjectScheduleIssue() {},
    subjectSelectionSlotRef: { current: "" }, pendingSnapshotSubjectRef: { current: "" },
    setOpen: (value) => { state.open = value; }, setRoster() {}, setRows() {}, setPenaltyOpen() {}, setPenRows() {},
    setSubjectId() {}, setLastCompletion() {}, setSessionRuntimeState() {}, setNowTick() {}, computeDefaultsForNow() {},
    setMsg: (value) => { state.msg = value; }, setBusy: (value) => { state.busy = value; },
    refreshClassScheduleFromRelay: async () => null, refreshPending: async () => queued.length,
    // A stalled background sync must never be awaited by the close gesture.
    syncNowRef: { current: () => new Promise(() => {}) },
    offlineMutateJson: async (url, init, options) => {
      assert.equal(options.queueOnly, true);
      if (failClose && options.meta.operationType === "session-end") throw new Error("storage_full");
      queued.push({ url, init, options });
      return { ok: false, queued: true, offline: true, status: 0 };
    },
  };
  const source = method("src/app/class/page.tsx", "attendanceMarksFromRows") + "\n" + method("src/app/class/page.tsx", "endSession");
  return { state, queued, saved, close: scoped(source, "endSession", state) };
}
for (const sessionId of ["client:open-a", "server-a"]) {
  test(`class phone closes ${sessionId} locally without waiting for the network`, async () => {
    const s = classCloseState({ sessionId });
    await s.close();
    assert.equal(s.state.open, null, s.state.msg);
    assert.equal(s.state.busy, false);
    assert.deepEqual(s.queued.map((row) => row.options.meta.operationType), ["attendance", "session-end"]);
    assert.equal(s.queued[0].init.body.marks.length, 2);
    assert.equal(s.queued[0].init.body.captured_at_device, s.queued[1].init.body.actual_end_at);
    assert.equal(s.saved.get("classDevice:local-open"), null);
    assert.equal(s.saved.get("class-a").open, null);
  });
}
test("storage failure keeps the course displayed, and a missing roster cannot certify an empty call", async () => {
  const failed = classCloseState({ failClose: true });
  await failed.close();
  assert.ok(failed.state.open);
  assert.equal(failed.queued.length, 1);
  assert.equal(failed.state.msg, "storage_full");
  const missing = classCloseState({ roster: [] });
  await missing.close();
  assert.ok(missing.state.open);
  assert.equal(missing.queued.length, 0);
});

const fakeAst = ts.createSourceFile("fake.ts", read("test/offline-outbox-ordering.test.ts"), ts.ScriptTarget.Latest, true);
const fakeFunction = fakeAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "installFakeIndexedDb");
const installFakeIndexedDb = new Function(`${compile(fakeFunction.getText(fakeAst))}; return installFakeIndexedDb;`)();
function offlineApi() {
  const exports = {};
  const imports = {
    "@/lib/attendance-cache-contract": { isTeacherCacheKey: () => false, isTeacherScheduleKey: () => false },
    "@/lib/attendance-cache-identity": { attendanceAuthGeneration: () => 1 },
    "@/lib/offline-release": { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1 },
    "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
  };
  // Shorten only background test deadlines; production retains its 8 s budget.
  const source = read("src/lib/offline.ts").replace("OUTBOX_REPLAY_TIMEOUT_MS = 8_000", "OUTBOX_REPLAY_TIMEOUT_MS = 500");
  new Function("exports", "require", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports, (name) => { assert.ok(name in imports, name); return imports[name]; });
  return exports;
}
function workerApi(navigator = {}) {
  const context = { self: { addEventListener() {}, navigator, location: { origin: "https://test.invalid" }, clients: { matchAll: async () => [] } },
    indexedDB: globalThis.indexedDB, fetch: (...args) => globalThis.fetch(...args), Request, Response, Headers, URL, AbortController, DOMException,
    setTimeout, clearTimeout, Date, console };
  vm.createContext(context);
  vm.runInContext(read("public/moncahier-sw.js").replace("ATTENDANCE_REPLAY_TIMEOUT_MS = 8_000", "ATTENDANCE_REPLAY_TIMEOUT_MS = 500"), context);
  return { replay: () => vm.runInContext("replayAttendanceOutboxFromWorker()", context) };
}

for (const manual of [false, true]) {
  test(`a restarted class device reconstructs its ${manual ? "manual" : "planned"} start from the durable journal`, async () => {
    const restore = installFakeIndexedDb(), before = globalThis.fetch;
    try {
      const api = offlineApi(), records = [];
      const state = { offlineMutateJson: api.offlineMutateJson };
      const delivery = "src/lib/teacher-session-delivery.ts";
      const stage = scoped(["normalizedText", "contentKey", "getOrCreateRecord", "stageTeacherAttendanceSessionOpenWithDependencies"]
        .map((name) => method(delivery, name)).join("\n"), "stageTeacherAttendanceSessionOpenWithDependencies", state);
      const record = await stage({
        institutionId: "csca", classId: "4e2", subjectId: "eps", periodId: manual ? "manual:outside" : "p1", attemptKey: "4e2:p1:eps:2026-10-07",
        classStart: { period_id: manual ? null : "p1", expected_minutes: 55, actual_call_at: "2026-10-07T09:08:00Z", manual_course: manual },
      }, {
        store: { list: async () => records, put: async (r) => records.push(r) },
        now: () => new Date("2026-10-07T09:08:00Z"), createOperationId: () => "open-from-journal",
      });
      await api.putDurableAttendanceRecord("session-delivery", record);
      const sync = "src/lib/teacher-attendance-cloud-sync.ts";
      const queue = scoped(["text", "parseTeacherAttemptKey", "queueDurableSessionOpen"].map((name) => method(sync, name)).join("\n"), "queueDurableSessionOpen", state);
      // Simulate a restart before the opening request reached the outbox.
      await queue(record, new Set());
      globalThis.fetch = async (url, init) => {
        assert.equal(url, "/api/class/sessions/start");
        const body = JSON.parse(init.body);
        assert.equal(body.class_id, "4e2"); assert.equal(body.subject_id, "eps");
        assert.equal(body.period_id, manual ? null : "p1"); assert.equal(body.manual_course, manual);
        assert.equal(body.actual_call_at, "2026-10-07T09:08:00Z");
        assert.equal(body.client_session_id, "client:open-from-journal");
        assert.equal(body.operation_id, "open-from-journal");
        return Response.json({ operation_id: "open-from-journal", item: { id: "server-from-journal" } });
      };
      assert.equal((await api.flushOutbox()).remaining, 0);
      assert.equal((await api.cacheGet("teacher:session-delivery:v1:csca"))[0].state, "cloud_opened");
    } finally { globalThis.fetch = before; restore(); }
  });
}

test("interactive calls time out through a stalled body and still return readable JSON on success", async () => {
  const before = globalThis.fetch;
  try {
    const exports = {};
    new Function("exports", ts.transpileModule(read("src/lib/attendance-network.ts"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText)(exports);
    globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); } }));
    await assert.rejects(exports.fetchAttendanceInteractive("/api/teacher/attendance/bulk", {}, 500), { name: "TimeoutError" });
    const controller = new AbortController();
    const request = exports.fetchAttendanceInteractive("/api/teacher/roster", { signal: controller.signal });
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
    globalThis.fetch = async () => Response.json({ ok: true });
    const response = await exports.fetchAttendanceInteractive("/api/teacher/roster");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally { globalThis.fetch = before; }
});

test("a correction made during an ambiguous send preserves the first payload and ID", async () => {
  const restore = installFakeIndexedDb(), before = globalThis.fetch;
  try {
    const api = offlineApi();
    const queue = (id, status) => api.offlineMutateJson("/api/teacher/attendance/bulk", {
      method: "POST", body: { session_id: "s", marks: [{ student_id: "a", status }] },
    }, { operationId: id, queueOnly: true, mergeKey: "call:s", meta: { operationType: "attendance", clientSessionId: "s" } });
    await queue("first", "absent");
    globalThis.fetch = async () => { await queue("correction", "present"); throw new TypeError("ACK lost"); };
    await api.flushOutbox();
    const entries = await api.listOfflineOutboxEntries();
    assert.deepEqual(entries.map((row) => row.operationId), ["first", "correction"]);
    const calls = [], statuses = [];
    globalThis.fetch = async (_, init) => {
      const id = new Headers(init.headers).get("X-Mon-Cahier-Operation-Id"); calls.push(id);
      statuses.push(JSON.parse(init.body).marks[0].status);
      return Response.json({ operation_id: id, session_id: "s" });
    };
    await api.flushOutbox({ releaseNetworkBackoff: true });
    assert.deepEqual(calls, ["first", "correction"]);
    assert.deepEqual(statuses, ["absent", "present"]);
    assert.equal((await api.outboxStats()).total, 0);
  } finally { globalThis.fetch = before; restore(); }
});

test("worker timeout preserves the queue, and simultaneous wakeups share one replay lock", async () => {
  const restore = installFakeIndexedDb(), before = globalThis.fetch;
  try {
    const api = offlineApi();
    await api.offlineMutateJson("/api/teacher/attendance/bulk", { method: "POST", body: { session_id: "s", marks: [] } }, {
      operationId: "worker-call", queueOnly: true, meta: { operationType: "attendance", clientSessionId: "s" },
    });
    let sends = 0, locks = 0;
    globalThis.fetch = async () => { sends += 1; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); } })); };
    const worker = workerApi({ locks: { request: async (name, run) => { assert.equal(name, "moncahier-offline-outbox"); locks += 1; return run(); } } });
    const result = await Promise.allSettled([worker.replay(), worker.replay()]);
    assert.deepEqual(result.map((r) => r.status), ["rejected", "rejected"]);
    assert.equal(sends, 1); assert.equal(locks, 1);
    assert.equal((await api.listOfflineOutboxEntries())[0].operationId, "worker-call");
    globalThis.fetch = async () => Response.json({ operation_id: "worker-call", session_id: "s" });
    await worker.replay();
    assert.equal((await api.outboxStats()).total, 0);
  } finally { globalThis.fetch = before; restore(); }
});

test("admin reception counts keep received courses visible when pupils have no exception", () => {
  const exports = {};
  new Function("exports", ts.transpileModule(read("src/lib/attendance-surveillance.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports);
  assert.deepEqual(exports.attendanceReceptionSummary([
    { session_id: "s1", attendance_receipt_available: true, attendance_received_at: "2026-10-07T09:00:00Z" },
    { session_id: "s2", attendance_receipt_available: true, attendance_received_at: null },
    { session_id: "s3", attendance_receipt_available: false },
    { session_id: null, attendance_receipt_available: true },
  ]), { sessions: 3, confirmed: 1, unconfirmed: 1, unavailable: 1 });
});
test("headers received then body stalls: mutation stays queued with its exact original ID", async () => {
  const restore = installFakeIndexedDb(), before = globalThis.fetch;
  try {
    const api = offlineApi();
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); } }), { headers: { "Content-Type": "application/json" } });
    const started = Date.now();
    const result = await api.offlineMutateJson("/api/teacher/attendance/bulk", { method: "POST", body: { session_id: "s", marks: [] } }, { operationId: "call-stall", timeoutMs: 500 });
    assert.equal(result.queued, true);
    assert.ok(Date.now() - started < 2000);
    const entries = await api.listOfflineOutboxEntries();
    assert.equal(entries[0].operationId, "call-stall");
    globalThis.fetch = async (_, init) => Response.json({ operation_id: new Headers(init.headers).get("X-Mon-Cahier-Operation-Id"), session_id: "s" });
    assert.equal((await api.flushOutbox({ releaseNetworkBackoff: true })).remaining, 0);
  } finally { globalThis.fetch = before; restore(); }
});

for (const channel of ["page", "worker"]) {
for (const mapped of [true, false]) {
  test(`${channel}: exact ACK updates durable journals; ${mapped ? "mapped" : "server"} closes wait for all student batches`, async () => {
    const restore = installFakeIndexedDb(), before = globalThis.fetch;
    try {
      const api = offlineApi(), calls = [];
      if (mapped) await api.registerOfflineSessionReference("client:open-a", "server-a");
      for (const [kind, journal, id] of [["attendance", "attendance-delivery", "call-a"], ["session-end", "session-lifecycle", "close-a"]]) {
        await api.cacheSet(`teacher:${journal}:v1:csca`, [{ operation_id: id, state: "device_pending", session_id: "client:open-a" }]);
        await api.offlineMutateJson(kind === "attendance" ? "/api/teacher/attendance/bulk" : "/api/class/sessions/end", {
          method: kind === "attendance" ? "POST" : "PATCH", body: { session_id: kind === "attendance" || !mapped ? "server-a" : "client:open-a", marks: [] },
        }, { operationId: id, queueOnly: true, meta: { operationType: kind, institutionId: "csca", clientSessionId: kind === "attendance" ? "server-a" : "client:open-a" } });
      }
      globalThis.fetch = async (_, init) => {
        const request = _ instanceof Request ? _ : null;
        const id = new Headers(request?.headers || init.headers).get("X-Mon-Cahier-Operation-Id");
        calls.push(id);
        return Response.json({ operation_id: id, session_id: "server-a" });
      };
      // A close-only pass cannot bypass an attendance queued under the mapped UUID.
      assert.equal((await api.flushOutbox({ includeOperationTypes: ["session-end"] })).flushed, 0);
      assert.deepEqual(calls, []);
      if (channel === "worker") await workerApi().replay();
      else await api.flushOutbox();
      assert.deepEqual(calls, ["call-a", "close-a"]);
      assert.equal((await api.cacheGet("teacher:attendance-delivery:v1:csca"))[0].state, "cloud_synced");
      assert.equal((await api.cacheGet("teacher:session-lifecycle:v1:csca"))[0].state, "cloud_confirmed");
      // A page that prepared an older draft before the worker ACK cannot put
      // that same operation back into a pending state afterwards.
      await api.putDurableAttendanceRecord("attendance-delivery", { institution_id: "csca", operation_id: "call-a", state: "device_pending" });
      await api.putDurableAttendanceRecord("session-lifecycle", { institution_id: "csca", operation_id: "close-a", state: "device_pending" });
      assert.equal((await api.cacheGet("teacher:attendance-delivery:v1:csca"))[0].state, "cloud_synced");
      assert.equal((await api.cacheGet("teacher:session-lifecycle:v1:csca"))[0].state, "cloud_confirmed");
      await api.offlineMutateJson("/api/teacher/attendance/bulk", { method: "POST", body: { session_id: "server-a", marks: [] } }, {
        operationId: "call-a", queueOnly: true, meta: { operationType: "attendance", institutionId: "csca" },
      });
      assert.equal((await api.outboxStats()).total, 0);
    } finally { globalThis.fetch = before; restore(); }
  });
}
}

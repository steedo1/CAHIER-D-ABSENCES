import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, imports = {}) {
  const exports = {};
  new Function("exports", "require", compile(read(file)))(exports, (name) => { assert.ok(name in imports, `${file}: ${name}`); return imports[name]; });
  return exports;
}
const proof = load("src/lib/server/attendance-receipt-proof.ts", { "node:crypto": crypto });
const id = "79223412-a6e3-5d62-8164-6093d125d7f5";
const capture = "2026-10-19T11:12:00.000Z";
const marks = [
  { student_id: "00000000-0000-4000-8000-000000000001", status: "absent", late_minutes: 0, comment: "Malade" },
  { student_id: "00000000-0000-4000-8000-000000000002", status: "present", late_minutes: 0, comment: null },
];
const localMarks = () => marks.map(({ comment, ...mark }) => ({ ...mark, reason: comment }));

function fixture() {
  const tables = {
    classes: [{ id: "class-a", institution_id: "csca" }],
    teacher_sessions: [{ id, institution_id: "csca", class_id: "class-a", teacher_id: "teacher-a", created_by: "phone", started_at: "2026-10-19T10:15:00Z", actual_call_at: "2026-10-19T10:31:11.371Z", ended_at: null, status: "open" }],
    relay_attendance_session_causality: [{ institution_id: "csca", session_id: id, last_operation_id: "mvf5ns5p_392q106gmol", last_captured_at_device: capture, last_payload_fingerprint: proof.attendancePayloadFingerprint(marks) }],
    attendance_marks: [marks[0]],
  };
  let authenticated = true, authorized = true, failedTable = null;
  const writes = [];
  const service = { from(table) {
    assert.ok(table in tables, table);
    let rows = [...tables[table]], patch;
    const result = () => {
      if (table === failedTable) return { data: null, error: { message: "unavailable" } };
      if (patch) { rows.forEach((row) => Object.assign(row, patch)); writes.push({ table, patch }); }
      return { data: rows, error: null };
    };
    return {
      select() { return this; },
      eq(key, value) { rows = rows.filter((row) => row[key] === value); return this; },
      is(key, value) { return this.eq(key, value); },
      in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return this; },
      update(value) { patch = value; return this; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] || null }; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
  } };
  const common = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: "phone" } : null } }) } }) },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
  };
  const route = load("src/app/api/class/sync/reconcile-v2/route.ts", {
    ...common,
    "@/lib/class-device-identity": { classDeviceMayAccessClass: async () => authorized },
    "@/lib/class-device-cloud-session": load("src/lib/class-device-cloud-session.ts", { "node:crypto": crypto }),
    "@/lib/server/attendance-receipt-proof": proof,
  });
  const close = load("src/app/api/class/sessions/end/route.ts", {
    ...common, "@/lib/attendance-end-time": load("src/lib/attendance-end-time.ts"),
  });
  return { tables, writes, service,
    authenticate: (v) => { authenticated = v; }, authorize: (v) => { authorized = v; }, fail: (v) => { failedTable = v; },
    reconcile: (operations) => route.POST({ json: async () => ({ class_id: "class-a", operations }) }),
    close: (body, operationId) => close.PATCH({ headers: new Headers({ "x-mon-cahier-operation-id": operationId }), json: async () => body }),
  };
}
const operation = (operationId, sessionId = id, payload = localMarks()) => ({ operation_id: operationId, operation_type: "attendance", session_dependency_key: sessionId, operation_body: { session_id: sessionId, captured_at_device: capture, marks: payload } });

test("1A: exact duplicate is proven while the session is still open; UUID alias resolves to that session", async () => {
  const f = fixture();
  const response = await f.reconcile([operation("mvfcuheg_gxid7kcdeu6", `client:${id}`)]);
  const result = (await response.json()).results[0];
  assert.equal(result.session_id, id);
  assert.equal(result.session_reference_confirmed, true);
  assert.equal(result.acknowledged, true);
  assert.equal(f.tables.teacher_sessions[0].status, "open");
  assert.equal(f.writes.length, 0, "receipt lookup must never replay a write");
});
test("different marks, timestamps, repeated students, or same ID with changed payload are retained", async () => {
  for (const variant of ["marks", "capture", "duplicate", "same-id"]) {
    const f = fixture(), op = operation(variant === "same-id" ? "mvf5ns5p_392q106gmol" : "different-operation");
    if (["marks", "same-id"].includes(variant)) op.operation_body.marks[0].status = "present";
    if (variant === "capture") op.operation_body.captured_at_device = "2026-10-19T11:12:00.001Z";
    if (variant === "duplicate") op.operation_body.marks.push(op.operation_body.marks[0]);
    assert.equal((await (await f.reconcile([op])).json()).results[0].acknowledged, false, variant);
    assert.equal(f.writes.length, 0);
  }
});
test("recovery fails closed on another tenant, another creator, unavailable receipt and denied identity", async () => {
  for (const variant of ["tenant", "owner", "lookup", "auth", "class"]) {
    const f = fixture();
    if (variant === "tenant") f.tables.teacher_sessions[0].institution_id = "other";
    if (variant === "owner") f.tables.teacher_sessions[0].created_by = "other";
    if (variant === "lookup") f.fail("relay_attendance_session_causality");
    if (variant === "auth") f.authenticate(false);
    if (variant === "class") f.authorize(false);
    const res = await f.reconcile([operation("different-operation", `client:${id}`)]);
    if (res.ok) assert.equal((await res.json()).results[0].acknowledged, false); else assert.ok([401, 403].includes(res.status));
    assert.equal(f.writes.length, 0);
  }
});
test("client UUID opening operation remains deterministic when it is not an existing cloud session", async () => {
  const f = fixture(), openingId = "77777777-7777-4777-8777-777777777777";
  const cloudId = load("src/lib/class-device-cloud-session.ts", { "node:crypto": crypto }).classDeviceCloudSessionId({ institutionId: "csca", classId: "class-a", actorProfileId: "phone", operationId: openingId });
  f.tables.teacher_sessions[0].id = cloudId;
  f.tables.relay_attendance_session_causality[0].session_id = cloudId;
  const result = (await (await f.reconcile([operation("different-operation", `client:${openingId}`)])).json()).results[0];
  assert.equal(result.session_id, cloudId); assert.equal(result.acknowledged, true);
});

test("an alias with two owned candidate sessions is not guessed", async () => {
  const f = fixture();
  const derived = load("src/lib/class-device-cloud-session.ts", { "node:crypto": crypto }).classDeviceCloudSessionId({ institutionId: "csca", classId: "class-a", actorProfileId: "phone", operationId: id });
  f.tables.teacher_sessions.push({ ...f.tables.teacher_sessions[0], id: derived });
  const result = (await (await f.reconcile([operation("different-operation", `client:${id}`)])).json()).results[0];
  assert.equal(result.acknowledged, false);
  assert.equal(result.session_reference_confirmed, false);
});

const fakeAst = ts.createSourceFile("fake.ts", read("test/offline-outbox-ordering.test.ts"), ts.ScriptTarget.Latest, true);
const fakeFunction = fakeAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "installFakeIndexedDb");
const installFakeIndexedDb = new Function(`${compile(fakeFunction.getText(fakeAst))}; return installFakeIndexedDb;`)();
function offlineApi() {
  return load("src/lib/offline.ts", {
    "@/lib/attendance-cache-contract": { isTeacherCacheKey: () => false, isTeacherScheduleKey: () => false },
    "@/lib/attendance-cache-identity": { attendanceAuthGeneration: () => 1 },
    "@/lib/offline-release": { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1 },
    "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
  });
}
function workerApi() {
  const context = { self: { addEventListener() {}, navigator: {}, location: { origin: "https://test.invalid" }, clients: { matchAll: async () => [] } }, indexedDB: globalThis.indexedDB, fetch: (...args) => globalThis.fetch(...args), Request, Response, Headers, URL, AbortController, DOMException, setTimeout, clearTimeout, Date, console };
  vm.createContext(context); vm.runInContext(read("public/moncahier-sw.js"), context);
  return { replay: () => vm.runInContext("replayAttendanceOutboxFromWorker()", context) };
}
const scope = { id: "class-a", institution_id: "csca", actor_profile_id: "phone" };

test("real 1A four-row queue: proof → alias mapping → student ACK → close; restart does not resurrect yesterday", async () => {
  const restore = installFakeIndexedDb(), before = globalThis.fetch;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  try {
    const api = offlineApi(), f = fixture();
    const queue = async (operationId, type, reference, time) => api.offlineMutateJson(type === "attendance" ? "/api/teacher/attendance/bulk" : "/api/class/sessions/end", {
      method: type === "attendance" ? "POST" : "PATCH",
      body: type === "attendance" ? { session_id: reference, captured_at_device: capture, marks: localMarks() } : { session_id: reference, actual_end_at: capture },
    }, { operationId, queueOnly: true, createdAt: Date.parse(time), meta: { operationType: type, classId: "class-a", institutionId: "csca", clientSessionId: reference } });
    await queue("mvf5ns69_mocuckc4m8o", "session-end", id, "2026-10-19T11:12:42Z");
    await queue("mvfcuheg_gxid7kcdeu6", "attendance", `client:${id}`, "2026-10-19T14:33:52Z");
    globalThis.fetch = async () => Response.json({ error: "attendance_operation_ambiguous" }, { status: 409 });
    await api.flushOutbox({ includeOperationTypes: ["attendance"] });
    await queue("mvgc9i1l_qcfjyzbky5n", "attendance", `client:${id}`, "2026-10-20T07:05:20Z");
    await queue("mvgc9i2e_y4j6tk2j7tt", "session-end", `client:${id}`, "2026-10-20T07:05:20.001Z");
    assert.equal((await api.listOfflineOutboxEntries()).length, 4);
    const lifecycle = load("src/lib/teacher-session-lifecycle-delivery.ts", { "@/lib/offline": api, "@/lib/local-relay": {}, "@/lib/teacher-session-lifecycle-protocol": {} });
    assert.equal(await lifecycle.isTeacherSessionLocallyFinalized("csca", id), true);
    const requests = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init?.body || "{}"); requests.push(String(url));
      if (String(url).includes("my-classes")) return Response.json({ items: [scope] });
      if (String(url).includes("reconcile-v2")) return f.reconcile(body.operations);
      if (String(url).endsWith("/sessions/end")) { assert.equal(body.session_id, id); return f.close(body, new Headers(init.headers).get("x-mon-cahier-operation-id")); }
      throw new Error(`Unexpected write: ${url}`);
    };
    const repair = load("src/lib/class-device-sync-reconcile-v2.ts", {
      "@/lib/offline": api,
      "@/lib/attendance-network": { fetchAttendanceBackground: (...args) => globalThis.fetch(...args) },
      "@/lib/class-device-sync-state": load("src/lib/class-device-sync-state.ts"),
      "@/lib/teacher-attendance-delivery": { listTeacherAttendanceOperations: async () => [], markTeacherAttendanceSyncedInCloud: async () => {} },
      "@/lib/teacher-session-delivery": { listTeacherSessionOpenOperations: async () => [], markTeacherSessionOpenedInCloud: async () => {} },
      "@/lib/teacher-session-lifecycle-delivery": { listTeacherSessionLifecycleOperations: async () => [], markTeacherSessionClosedInCloud: async () => {} },
    });
    const summary = await repair.repairClassDeviceSyncV2({ force: true, scope });
    assert.equal(summary.after, 0); assert.equal((await api.listOfflineOutboxEntries()).length, 0);
    assert.equal(f.tables.teacher_sessions[0].ended_at, capture);
    assert.equal(f.tables.teacher_sessions[0].status, "submitted");
    assert.deepEqual(f.tables.attendance_marks, [marks[0]], "absence and reason preserved");
    assert.equal(f.writes.length, 1, "one close, no attendance reapplication");
    const receipt = await api.cacheGet("attendance:cloud-receipt:v1:mvfcuheg_gxid7kcdeu6");
    assert.equal(receipt.receipt_operation_id, "mvf5ns5p_392q106gmol");
    assert.equal(receipt.session_id, id);
    assert.equal(requests.filter((url) => url.endsWith("/sessions/end")).length, 2, "two requests, one idempotent close write");
  } finally { globalThis.fetch = before; restore(); if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete globalThis.navigator; }
});
for (const runner of ["page", "worker"]) {
  test(`${runner}: old ambiguous 409 gets one exact receipt retry; other conflicts stay blocked and next course syncs`, async () => {
    const restore = installFakeIndexedDb(), before = globalThis.fetch;
    try {
      const api = offlineApi();
      await api.offlineMutateJson("/api/teacher/attendance/bulk", { method: "POST", body: { session_id: id, captured_at_device: capture, marks: localMarks() } }, { operationId: "ambiguous-old", queueOnly: true, meta: { operationType: "attendance", clientSessionId: id } });
      globalThis.fetch = async () => Response.json({ error: "attendance_operation_ambiguous" }, { status: 409 });
      await api.flushOutbox();
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({ error: "attendance_operation_ambiguous" }, { status: 409 }); };
      const replay = runner === "page" ? () => api.flushOutbox() : workerApi().replay;
      await replay(); await replay();
      assert.equal(calls, 1, "unproved collision stays blocked without an infinite retry loop");
      await api.offlineMutateJson("/api/class/sessions/end", { method: "PATCH", body: { session_id: "next-course", actual_end_at: capture } }, { operationId: "next-course-close", queueOnly: true, meta: { operationType: "session-end", clientSessionId: "next-course" } });
      globalThis.fetch = async (_, init) => Response.json({ operation_id: new Headers(init?.headers || (_ instanceof Request ? _.headers : {})).get("x-mon-cahier-operation-id"), item: { id: "next-course" } });
      await replay();
      assert.deepEqual((await api.listOfflineOutboxEntries()).map((row) => row.operationId), ["ambiguous-old"]);
    } finally { globalThis.fetch = before; restore(); }
  });
}

test("fingerprint matches Postgres jsonb and SQL ambiguity guard stays intact (isolated database)", async () => {
  const db = new PGlite();
  try {
    const result = await db.query("select md5($1::jsonb::text) as fingerprint", [JSON.stringify(marks.map((mark) => ({ ...mark, comment: mark.comment || null })))]);
    assert.equal(proof.attendancePayloadFingerprint(marks), result.rows[0].fingerprint);
    const special = [{ ...marks[0], comment: 'Élève "malade"\nligne' }, marks[1]];
    const r = await db.query("select md5($1::jsonb::text) as fingerprint", [JSON.stringify(special)]);
    assert.equal(proof.attendancePayloadFingerprint(special), r.rows[0].fingerprint);
    await db.exec(`create type attendance_status as enum ('present','absent','late');
      create table teacher_sessions(id uuid primary key,institution_id uuid,expected_minutes integer,ended_at timestamptz,actual_call_at timestamptz);
      create table relay_attendance_session_causality(institution_id uuid,session_id uuid,last_captured_at_device timestamptz,last_operation_id text,last_payload_fingerprint text,updated_at timestamptz,primary key(institution_id,session_id));
      create table attendance_marks(session_id uuid,student_id uuid,status attendance_status,minutes_late integer,hours_absent numeric,reason text,primary key(session_id,student_id));`);
    const sql = read("supabase/migrations/20260814145815_fix_relay_attendance_status_enum.sql");
    const definition = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.apply_relay_attendance_call_v2("), sql.indexOf("\n$$;", sql.indexOf("CREATE OR REPLACE FUNCTION public.apply_relay_attendance_call_v2(")) + "\n$$;".length);
    await db.exec(definition);
    const school = "11111111-1111-4111-8111-111111111111";
    await db.query("insert into teacher_sessions values ($1,$2,55,null,null)", [id, school]);
    const apply = (op, values = marks) => db.query("select * from apply_relay_attendance_call_v2($1,$2,$3,$4,$5::jsonb)", [school, id, op, capture, JSON.stringify(values)]);
    assert.equal((await apply("mvf5ns5p_392q106gmol")).rows[0].status, "applied");
    assert.equal((await apply("different-operation")).rows[0].status, "attendance_operation_ambiguous");
    assert.equal((await apply("mvf5ns5p_392q106gmol", [{ ...marks[0], status: "present" }, marks[1]])).rows[0].status, "attendance_operation_payload_conflict");
    assert.equal((await db.query("select count(*)::int as n from attendance_marks")).rows[0].n, 1);
  } finally { await db.close(); }
});

function journalRecovery({ storageFailure = false } = {}) {
  const f = fixture(), batches = [], receipts = new Map();
  const journals = Array.from({ length: 105 }, (_, n) => ({
    operation_id: `duplicate-batch-${String(n).padStart(3, "0")}`, state: "blocked",
    institution_id: "csca", class_id: "class-a", session_reference: id, session_id: id,
    captured_at_device: capture, marks, created_at: "2026-10-19T11:12:00Z",
  }));
  const api = load("src/lib/class-device-sync-reconcile-v2.ts", {
    "@/lib/offline": {
      cacheGet: async () => null, cacheSet: async (key, receipt) => { if (storageFailure) throw new Error("storage_full"); receipts.set(key, receipt); },
      listOfflineOutboxEntries: async () => [], flushOutbox: async () => ({ flushed: 0, acknowledged: [] }),
    },
    "@/lib/attendance-network": { fetchAttendanceBackground: async (url, init) => {
      if (url.includes("my-classes")) return Response.json({ items: [scope] });
      const body = JSON.parse(init.body); batches.push(body.operations.length);
      return f.reconcile(body.operations);
    } },
    "@/lib/class-device-sync-state": load("src/lib/class-device-sync-state.ts"),
    "@/lib/teacher-attendance-delivery": {
      listTeacherAttendanceOperations: async () => journals,
      markTeacherAttendanceSyncedInCloud: async ({ operationId }) => { journals.find((r) => r.operation_id === operationId).state = "cloud_synced"; },
    },
    "@/lib/teacher-session-delivery": { listTeacherSessionOpenOperations: async () => [] },
    "@/lib/teacher-session-lifecycle-delivery": { listTeacherSessionLifecycleOperations: async () => [] },
  });
  return { api, journals, batches, receipts };
}
for (const storageFailure of [false, true]) {
  test(storageFailure ? "receipt storage failure keeps every unconfirmed journal payload" : "105 old operations recover in bounded batches rather than being stuck on HTTP 400", async () => {
    const old = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
    try {
      const f = journalRecovery({ storageFailure });
      if (storageFailure) {
        await assert.rejects(f.api.repairClassDeviceSyncV2({ force: true, scope }), /storage_full/);
        assert.ok(f.journals.every((r) => r.state === "blocked" && r.marks === marks));
      } else {
        assert.equal((await f.api.repairClassDeviceSyncV2({ force: true, scope })).after, 0);
        assert.deepEqual(f.batches, [100, 5]); assert.equal(f.receipts.size, 105);
      }
    } finally { if (old) Object.defineProperty(globalThis, "navigator", old); else delete globalThis.navigator; }
  });
}
test("administrative matrix never renders an unreceived call as a red OFF or a proven absence", () => {
  const file = "src/app/admin/absences/appels-matrice/page.tsx";
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && ["statusHint", "cellColorClasses"].includes(node.name?.text)).map((node) => node.getText(ast)).join("\n");
  const monitor = load("src/lib/admin-attendance-monitor.ts");
  const helpers = new Function("unconfirmedAttendanceMessage", `${compile(functions)}; return { statusHint, cellColorClasses };`)(monitor.unconfirmedAttendanceMessage);
  assert.match(helpers.statusHint("missing"), /non reçu.*n’est pas confirmé/);
  assert.doesNotMatch(helpers.cellColorClasses("missing"), /red/);
  assert.doesNotMatch(read(file), /\? "OFF"|aucun appel commencé/);
  assert.match(helpers.statusHint("started"), /Appel commencé/);
});

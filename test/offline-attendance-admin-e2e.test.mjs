import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function evaluate(file, imports) {
  const exports = {};
  new Function("exports", "require", compile(read(file)))(exports, (name) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency in ${file}: ${name}`);
    return imports[name];
  });
  return exports;
}

const fakeSource = ts.createSourceFile(
  "offline-outbox-ordering.test.ts",
  read("test/offline-outbox-ordering.test.ts"),
  ts.ScriptTarget.Latest,
  true,
);
const fakeFunction = fakeSource.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "installFakeIndexedDb"
);
const installFakeIndexedDb = new Function(
  `${compile(fakeFunction.getText(fakeSource))}; return installFakeIndexedDb;`,
)();

function makeQuery(rows) {
  let filtered = [...rows];
  return {
    select() { return this; },
    eq(field, value) { filtered = filtered.filter((row) => row[field] === value); return this; },
    gte(field, value) { filtered = filtered.filter((row) => row[field] >= value); return this; },
    lte(field, value) { filtered = filtered.filter((row) => row[field] <= value); return this; },
    lt(field, value) { filtered = filtered.filter((row) => row[field] < value); return this; },
    in(field, values) { filtered = filtered.filter((row) => values.includes(row[field])); return this; },
    order() { return this; },
    range(from, to) {
      return Promise.resolve({ data: filtered.slice(from, to + 1), count: filtered.length, error: null });
    },
    maybeSingle() {
      return Promise.resolve({ data: filtered[0] || null, error: null });
    },
  };
}

function makeCloud() {
  const institutionId = "csca-test";
  const teacherId = "teacher-eps";
  const clientSessionId = "class-5e2_eps_2026-09-21T09:05:00.000Z";
  const tables = {
    profiles: [
      { id: "admin-1", institution_id: institutionId, display_name: "Admin" },
      { id: teacherId, institution_id: institutionId, display_name: "Prof EPS" },
    ],
    user_roles: [{ profile_id: "admin-1", institution_id: institutionId, role: "admin" }],
    institution_periods: [{
      id: "period-0905", institution_id: institutionId, weekday: 1,
      label: "09:05–10:00", start_time: "09:05:00", end_time: "10:00:00",
    }],
    teacher_timetables: [{
      id: "tt-eps", institution_id: institutionId, class_id: "class-5e2",
      subject_id: "subject-eps", teacher_id: teacherId, weekday: 1,
      period_id: "period-0905",
    }],
    classes: [{
      id: "class-5e2", institution_id: institutionId, label: "5e2",
      level: "5e", education_type: "general_secondary",
    }],
    institution_subjects: [{
      id: "subject-eps", institution_id: institutionId,
      custom_name: "EPS", subjects: { id: "base-eps", name: "EPS" },
    }],
    teacher_sessions: [],
    teacher_absence_requests: [],
    relay_attendance_session_causality: [],
  };
  const applied = new Set();
  const calls = [];
  let connected = false;
  let startUnavailable = true;
  let loseAttendanceReceipt = true;

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) },
    from(table) {
      if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
      return makeQuery(tables[table]);
    },
  };

  async function fetchCloud(url, init) {
    if (!connected) throw new TypeError("offline");
    const operationId = new Headers(init?.headers).get("X-Mon-Cahier-Operation-Id");
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push({ url: String(url), operationId, body });
    const sessionId = "server-session-eps";
    if (String(url).endsWith("/sessions/start")) {
      if (startUnavailable) {
        startUnavailable = false;
        return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
      }
      if (!applied.has(operationId)) {
        tables.teacher_sessions.push({
          id: sessionId, institution_id: institutionId,
          class_id: body.class_id, subject_id: body.subject_id, teacher_id: teacherId,
          started_at: body.started_at, actual_call_at: body.actual_call_at,
          ended_at: null, origin: "teacher",
        });
        applied.add(operationId);
      }
      return Response.json({ operation_id: operationId, item: { id: sessionId } });
    }
    if (String(url).endsWith("/attendance/bulk")) {
      assert.equal(body.session_id, sessionId);
      if (!applied.has(operationId)) {
        tables.relay_attendance_session_causality.push({
          institution_id: institutionId, session_id: sessionId,
          updated_at: "2026-09-23T10:00:00.000Z",
        });
        applied.add(operationId);
      }
      if (loseAttendanceReceipt) {
        loseAttendanceReceipt = false;
        throw new TypeError("attendance ACK lost after server commit");
      }
      return Response.json({ operation_id: operationId, session_id: sessionId });
    }
    if (String(url).endsWith("/sessions/end")) {
      assert.equal(body.session_id, sessionId);
      tables.teacher_sessions[0].ended_at = body.actual_end_at;
      applied.add(operationId);
      return Response.json({ operation_id: operationId, item: { id: sessionId } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }

  return {
    institutionId, clientSessionId, tables, applied, calls, supabase, fetchCloud,
    connect() { connected = true; },
  };
}

function loadMonitorRoute(cloud) {
  const educationOrganization = evaluate("src/lib/education-organization.ts", {});
  const educationScope = evaluate("src/lib/education-scope.ts", {
    "@/lib/education-organization": educationOrganization,
  });
  const surveillance = evaluate("src/lib/attendance-surveillance.ts", {});
  return evaluate("src/app/api/admin/attendance/monitor/route.ts", {
    "next/server": { NextResponse: { json: (value, options) => Response.json(value, options) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => cloud.supabase },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => cloud.supabase },
    "@/lib/education-organization": educationOrganization,
    "@/lib/education-scope": educationScope,
    "@/lib/attendance-surveillance": surveillance,
  });
}

test("appel 5e2 EPS hors ligne → ACK Cloud idempotent → visible et reçu en surveillance admin", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = globalThis;
  const cloud = makeCloud();
  globalThis.fetch = cloud.fetchCloud;
  const contract = evaluate("src/lib/attendance-cache-contract.ts", {});
  const offline = evaluate("src/lib/offline.ts", {
    "@/lib/attendance-cache-contract": contract,
    "@/lib/attendance-cache-identity": {
      attendanceCacheActor: async () => "teacher-eps",
      attendanceAuthGeneration: () => 1,
      knownScheduleRevision: () => 1,
      observeScheduleRevision() {},
    },
    "@/lib/offline-release": { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1 },
    "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
  });
  const route = loadMonitorRoute(cloud);
  const monitor = async () => {
    const response = await route.GET({
      url: "https://example.test/api/admin/attendance/monitor?from=2026-09-21&to=2026-09-21",
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  try {
    const initial = await monitor();
    assert.equal(initial.rows[0].status, "missing");
    assert.equal(initial.rows[0].attendance_received_at, null);

    const meta = {
      clientSessionId: cloud.clientSessionId, institutionId: cloud.institutionId,
      classId: "class-5e2",
    };
    await offline.offlineMutateJson("/api/teacher/sessions/start", {
      method: "POST",
      body: {
        client_session_id: cloud.clientSessionId, class_id: "class-5e2",
        subject_id: "subject-eps", started_at: "2026-09-21T09:05:00.000Z",
        actual_call_at: "2026-09-21T09:08:00.000Z",
      },
    }, {
      operationId: "open-eps", queueOnly: true,
      meta: { ...meta, operationType: "session-start" },
    });
    await offline.offlineMutateJson("/api/teacher/attendance/bulk", {
      method: "POST",
      body: {
        session_id: `client:${cloud.clientSessionId}`,
        captured_at_device: "2026-09-21T09:14:00.000Z",
        marks: [
          { student_id: "student-a", status: "present", reason: null, observed_at: null },
          { student_id: "student-b", status: "absent", reason: "Malade", observed_at: null },
          { student_id: "student-c", status: "late", reason: "Transport", observed_at: "2026-09-21T09:12:00.000Z" },
        ],
      },
    }, {
      operationId: "call-eps", queueOnly: true,
      meta: { ...meta, operationType: "attendance" },
    });
    await offline.offlineMutateJson("/api/teacher/sessions/end", {
      method: "PATCH",
      body: { client_session_id: cloud.clientSessionId, actual_end_at: "2026-09-21T10:00:00.000Z" },
    }, {
      operationId: "close-eps", queueOnly: true,
      meta: { ...meta, operationType: "session-end" },
    });
    assert.equal((await offline.outboxStats()).total, 3);
    assert.equal((await offline.flushOutbox()).flushed, 0);
    assert.equal((await offline.outboxStats()).total, 3);
    assert.equal((await monitor()).rows[0].status, "missing");

    cloud.connect();
    const unavailable = await offline.flushOutbox({ releaseNetworkBackoff: true });
    assert.equal(unavailable.flushed, 0);
    assert.equal(unavailable.retryableFailure, true);
    assert.equal(unavailable.remaining, 3);
    assert.equal((await monitor()).rows[0].status, "missing");
    assert.equal((await offline.flushOutbox({ releaseNetworkBackoff: true })).flushed, 0);
    await new Promise((resolve) => setTimeout(resolve, 4_100));

    const first = await offline.flushOutbox({ releaseNetworkBackoff: true });
    assert.equal(first.flushed, 1);
    assert.equal(first.remaining, 2);
    assert.equal(cloud.applied.size, 2);
    assert.deepEqual(cloud.calls.map((call) => call.operationId), ["open-eps", "open-eps", "call-eps"]);
    assert.equal((await monitor()).rows[0].attendance_received_at, "2026-09-23T10:00:00.000Z");

    const replay = await offline.flushOutbox({ releaseNetworkBackoff: true });
    assert.equal(replay.flushed, 2);
    assert.equal(replay.remaining, 0);
    assert.deepEqual(cloud.calls.map((call) => call.operationId), [
      "open-eps", "open-eps", "call-eps", "call-eps", "close-eps",
    ]);
    assert.equal(cloud.tables.relay_attendance_session_causality.length, 1);
    assert.equal(cloud.tables.teacher_sessions.length, 1);
    assert.equal(cloud.calls[2].body.captured_at_device, "2026-09-21T09:14:00.000Z");
    assert.deepEqual(cloud.calls[2].body.marks, cloud.calls[3].body.marks);
    assert.deepEqual(cloud.calls[2].body.marks.map((mark) => mark.status), ["present", "absent", "late"]);

    const visible = await monitor();
    assert.equal(visible.rows.length, 1);
    assert.equal(visible.rows[0].status, "ok");
    assert.equal(visible.rows[0].session_id, "server-session-eps");
    assert.equal(visible.rows[0].class_label, "5e2");
    assert.equal(visible.rows[0].subject_name, "EPS");
    assert.equal(visible.rows[0].attendance_received_at, "2026-09-23T10:00:00.000Z");
    assert.equal(visible.rows[0].ended_at, "2026-09-21T10:00:00.000Z");
    assert.match(
      evaluate("src/lib/attendance-surveillance.ts", {}).attendanceReceiptLabel(visible.rows[0]),
      /Appel élèves reçu · séance clôturée/,
    );
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});

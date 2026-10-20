import * as crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
function evaluate(file, imports) {
  const exports = {};
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", code)(exports, (name) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency in ${file}: ${name}`);
    return imports[name];
  });
  return exports;
}

function query(rows) {
  let matches = [...rows];
  const result = () => ({ data: matches, count: matches.length, error: null });
  return {
    select() { return this; },
    eq(field, value) { matches = matches.filter((row) => row[field] === value); return this; },
    is(field, value) { matches = matches.filter((row) => row[field] === value); return this; },
    in(field, values) { matches = matches.filter((row) => values.includes(row[field])); return this; },
    gte(field, value) { matches = matches.filter((row) => row[field] >= value); return this; },
    lte(field, value) { matches = matches.filter((row) => row[field] <= value); return this; },
    lt(field, value) { matches = matches.filter((row) => row[field] < value); return this; },
    order() { return this; },
    range(from, to) {
      return Promise.resolve({ data: matches.slice(from, to + 1), count: matches.length, error: null });
    },
    maybeSingle() { return Promise.resolve({ data: matches[0] || null, error: null }); },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
  };
}

function fixture({ classDeviceAllowed = false } = {}) {
  const institutionId = "csca-test";
  const teacherId = "teacher-eps";
  const sessionId = "session-eps";
  const capturedAt = "2026-09-21T09:14:00.000Z";
  const studentIds = ["student-a", "student-b", "student-c"];
  const tables = {
    profiles: [
      { id: "admin-1", institution_id: institutionId, display_name: "Admin" },
      { id: teacherId, institution_id: institutionId, display_name: "Prof EPS" },
    ],
    user_roles: [{ profile_id: "admin-1", institution_id: institutionId, role: "admin" }],
    teacher_sessions: [{
      id: sessionId, institution_id: institutionId, class_id: "class-5e2",
      subject_id: "subject-eps", teacher_id: teacherId, expected_minutes: 55,
      started_at: "2026-09-21T09:05:00.000Z", actual_call_at: "2026-09-23T10:00:00.000Z",
      ended_at: null, origin: "teacher", presence_verified: false, presence_method: null,
    }],
    classes: [{
      id: "class-5e2", institution_id: institutionId, label: "5e2", level: "5e",
      education_type: "general_secondary",
    }],
    class_enrollments: studentIds.map((studentId) => ({
      student_id: studentId, class_id: "class-5e2", end_date: null,
    })),
    institution_attendance_policies: [{ institution_id: institutionId, enabled: false, teacher_accounts_only: true }],
    institutions: [{ id: institutionId, tz: "Africa/Abidjan", auto_lateness: true, default_session_minutes: 55 }],
    institution_periods: [{
      id: "period-0905", institution_id: institutionId, weekday: 1, period_no: 1,
      label: "09:05–10:00", start_time: "09:05:00", end_time: "10:00:00", duration_min: 55,
    }],
    teacher_timetables: [{
      id: "tt-eps", institution_id: institutionId, class_id: "class-5e2",
      subject_id: "subject-eps", teacher_id: teacherId, weekday: 1,
      period_id: "period-0905",
    }],
    institution_subjects: [{
      id: "subject-eps", institution_id: institutionId,
      custom_name: "EPS", subjects: { id: "base-eps", name: "EPS" },
    }],
    teacher_absence_requests: [],
    relay_attendance_session_causality: [],
    attendance_marks: [],
  };
  let currentUserId = teacherId;
  const rpcCalls = [];
  const notifications = [];
  const service = {
    from(table) {
      if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
      return query(tables[table]);
    },
    async rpc(name, input) {
      assert.equal(name, "apply_relay_attendance_call_v2");
      rpcCalls.push(structuredClone(input));
      const previous = tables.relay_attendance_session_causality.find((row) =>
        row.session_id === input.p_session_id && row.institution_id === input.p_institution_id
      );
      if (previous) {
        if (
          previous.last_operation_id === input.p_operation_id &&
          previous.last_captured_at_device === input.p_captured_at_device &&
          JSON.stringify(previous.marks) === JSON.stringify(input.p_marks)
        ) {
          return { data: { status: "already_applied", changed: false, upserted: 0, deleted: 0 }, error: null };
        }
        return { data: { status: "attendance_operation_payload_conflict" }, error: null };
      }
      tables.relay_attendance_session_causality.push({
        institution_id: input.p_institution_id, session_id: input.p_session_id,
        last_operation_id: input.p_operation_id,
        last_captured_at_device: input.p_captured_at_device,
        updated_at: "2026-09-23T11:00:00.000Z", marks: structuredClone(input.p_marks),
      });
      tables.attendance_marks.push(...input.p_marks.filter((mark) => mark.status !== "present"));
      tables.teacher_sessions[0].actual_call_at = input.p_captured_at_device;
      return { data: { status: "applied", changed: true, upserted: 2, deleted: 0 }, error: null };
    },
  };
  const authenticated = {
    auth: { getUser: async () => ({ data: { user: { id: currentUserId } }, error: null }) },
    from: service.from,
  };
  const common = {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => authenticated },
    "@/lib/server/attendance-receipt-proof": evaluate("src/lib/server/attendance-receipt-proof.ts", { "node:crypto": crypto }),
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
  };
  const bulk = evaluate("src/app/api/teacher/attendance/bulk/route.ts", {
    ...common,
    "@/lib/push-dispatch": { triggerPushDispatch: async () => { notifications.push("push"); } },
    "@/lib/sms-dispatch": { triggerSmsDispatch: async () => { notifications.push("sms"); } },
    "@/lib/class-device-identity": { classDeviceMayAccessClass: async () => classDeviceAllowed },
  });
  const organization = evaluate("src/lib/education-organization.ts", {});
  const scope = evaluate("src/lib/education-scope.ts", {
    "@/lib/education-organization": organization,
  });
  const surveillance = evaluate("src/lib/attendance-surveillance.ts", {});
  const monitor = evaluate("src/app/api/admin/attendance/monitor/route.ts", {
    ...common,
    "@/lib/education-organization": organization,
    "@/lib/education-scope": scope,
    "@/lib/attendance-surveillance": surveillance,
  });
  return {
    bulk, monitor, tables, rpcCalls, notifications, service, surveillance, institutionId,
    sessionId, capturedAt,
    asAdmin() { currentUserId = "admin-1"; },
    asClass() { currentUserId = "class-phone"; },
  };
}

function attendanceRequest(input, body) {
  return new Request("https://example.test/api/teacher/attendance/bulk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mon-Cahier-Operation-Id": input,
    },
    body: JSON.stringify(body),
  });
}

test("vraie route : appel offline accepté, RPC atomique idempotent, reçu visible en surveillance admin", async () => {
  const scenario = fixture();
  const body = {
    session_id: scenario.sessionId,
    captured_at_device: scenario.capturedAt,
    marks: [
      { student_id: "student-a", status: "present" },
      { student_id: "student-b", status: "absent", reason: "Malade" },
      { student_id: "student-c", status: "late", reason: "Transport", observed_at: "2026-09-21T09:12:00.000Z" },
    ],
  };
  const operationId = "offline-eps-operation-1";

  const first = await scenario.bulk.POST(attendanceRequest(operationId, body));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    ok: true, operation_id: operationId, session_id: scenario.sessionId,
    captured_at_device: scenario.capturedAt, idempotent: false,
    upserted: 2, deleted: 0,
  });
  assert.equal(scenario.rpcCalls.length, 1);
  assert.deepEqual(scenario.rpcCalls[0].p_marks, [
    { student_id: "student-a", status: "present", late_minutes: 0, comment: null },
    { student_id: "student-b", status: "absent", late_minutes: 0, comment: "Malade" },
    { student_id: "student-c", status: "late", late_minutes: 7, comment: "Transport" },
  ]);
  assert.equal(scenario.tables.teacher_sessions[0].actual_call_at, scenario.capturedAt);
  assert.equal(scenario.tables.attendance_marks.length, 2);
  assert.deepEqual(scenario.notifications.sort(), ["push", "sms"]);

  const retry = await scenario.bulk.POST(attendanceRequest(operationId, body));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).idempotent, true);
  assert.equal(scenario.tables.attendance_marks.length, 2);
  assert.equal(scenario.tables.relay_attendance_session_causality.length, 1);
  assert.equal(scenario.notifications.length, 2);

  scenario.asAdmin();
  const response = await scenario.monitor.GET({
    url: "https://example.test/api/admin/attendance/monitor?from=2026-09-21&to=2026-09-21",
  });
  assert.equal(response.status, 200);
  const admin = await response.json();
  assert.equal(admin.rows.length, 1);
  assert.equal(admin.rows[0].session_id, scenario.sessionId);
  assert.equal(admin.rows[0].class_label, "5e2");
  assert.equal(admin.rows[0].subject_name, "EPS");
  assert.equal(admin.rows[0].status, "ok");
  assert.equal(admin.rows[0].actual_call_at, scenario.capturedAt);
  assert.equal(admin.rows[0].attendance_received_at, "2026-09-23T11:00:00.000Z");
  assert.match(scenario.surveillance.attendanceReceiptLabel(admin.rows[0]), /Appel élèves reçu/);
});

for (const classDeviceAllowed of [false, true]) {
  test(`bulk ${classDeviceAllowed ? "class device" : "teacher"}: ambiguous retry requires exact full receipt, retains absence/lateness and sends no notifications`, async () => {
    const f = fixture({ classDeviceAllowed });
    if (classDeviceAllowed) f.asClass();
    const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
    f.tables.class_enrollments = ids.map((student_id) => ({ student_id, class_id: "class-5e2", end_date: null }));
    f.tables.teacher_sessions[0].actual_call_at = f.capturedAt;
    const atomic = ids.map((student_id, n) => ({ student_id, status: ["present", "absent", "late"][n], late_minutes: n === 2 ? 7 : 0, comment: n === 1 ? "Malade" : null }));
    const helper = evaluate("src/lib/server/attendance-receipt-proof.ts", { "node:crypto": crypto });
    f.tables.relay_attendance_session_causality.push({ institution_id: f.institutionId, session_id: f.sessionId, last_operation_id: "already-received-call", last_captured_at_device: f.capturedAt, last_payload_fingerprint: helper.attendancePayloadFingerprint(atomic) });
    f.tables.attendance_marks.push(atomic[1], atomic[2]);
    f.service.rpc = async () => ({ data: { status: "attendance_operation_ambiguous" }, error: null });
    const body = { session_id: f.sessionId, captured_at_device: f.capturedAt, marks: atomic.map(({ comment, late_minutes, ...mark }) => ({ ...mark, reason: comment, observed_at: mark.status === "late" ? "2026-09-21T09:12:00Z" : null })) };
    const res = await f.bulk.POST(attendanceRequest("different-retry-id", body));
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.operation_id, "different-retry-id");
    assert.equal(payload.receipt_operation_id, "already-received-call");
    assert.equal(payload.idempotent, true);
    assert.equal(payload.upserted, 0);
    assert.deepEqual(f.notifications, []);
    assert.deepEqual(f.tables.attendance_marks, [atomic[1], atomic[2]]);
    body.marks[1].reason = "Correction non confirmée";
    assert.equal((await f.bulk.POST(attendanceRequest("different-retry-id-2", body))).status, 409);
  });
}

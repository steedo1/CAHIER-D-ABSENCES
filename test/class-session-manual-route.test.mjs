import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const fakeIndexedDbSource = ts.createSourceFile(
  "offline-outbox-ordering.test.ts",
  read("test/offline-outbox-ordering.test.ts"),
  ts.ScriptTarget.Latest,
  true,
);
const fakeIndexedDbFunction = fakeIndexedDbSource.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "installFakeIndexedDb"
);
const installFakeIndexedDb = new Function(
  `${compile(fakeIndexedDbFunction.getText(fakeIndexedDbSource))}; return installFakeIndexedDb;`,
)();

function evaluate(file, imports) {
  const exports = {};
  new Function("exports", "require", compile(read(file)))(exports, (name) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency in ${file}: ${name}`);
    return imports[name];
  });
  return exports;
}

const cloudIds = evaluate("src/lib/class-device-cloud-session.ts", {
  "node:crypto": { createHash },
});

function recentMonday() {
  const monday = new Date();
  monday.setUTCHours(9, 12, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  if (monday.getTime() > Date.now()) monday.setUTCDate(monday.getUTCDate() - 7);
  return monday;
}

const monday = recentMonday();
function at(hour, minute = 0) {
  const value = new Date(monday);
  value.setUTCHours(hour, minute, 0, 0);
  return value.toISOString();
}

function makeCloud(overrides = {}) {
  const tables = {
    classes: [{
      id: "class-5e2", label: "5e2", level: "5e", institution_id: "csca",
      education_type: "general_secondary",
    }],
    institution_subjects: [
      { id: "inst-eps", institution_id: "csca", subject_id: "canonical-eps", is_active: true, custom_name: "EPS", subjects: { name: "EPS" } },
      { id: "inst-info", institution_id: "csca", subject_id: "canonical-info", is_active: true, custom_name: "Informatique", subjects: { name: "Informatique" } },
      { id: "foreign-info", institution_id: "other-school", subject_id: "canonical-info", is_active: true, custom_name: "Informatique", subjects: { name: "Informatique" } },
    ],
    institutions: [{ id: "csca", tz: "Africa/Abidjan", default_session_minutes: 55, settings_json: null }],
    institution_periods: [{ id: "period-0905", institution_id: "csca", weekday: 1, period_no: 1, label: "09:05–10:00", start_time: "09:05:00", end_time: "10:00:00", duration_min: 55 }],
    teacher_timetables: [{ institution_id: "csca", class_id: "class-5e2", subject_id: "inst-eps", period_id: "period-0905", teacher_id: "teacher-eps" }],
    class_teachers: [{ institution_id: "csca", class_id: "class-5e2", subject_id: "canonical-info", teacher_id: "teacher-info", start_date: null, end_date: null }],
    teacher_sessions: [],
    institution_level_subjects: [],
  };
  for (const [key, rows] of Object.entries(overrides)) tables[key] = rows;

  function query(table) {
    if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
    let mode = "select";
    let payload = null;
    let filtered = [...tables[table]];
    let maximum = Infinity;
    const queryBuilder = {
      select() { return this; },
      eq(field, value) { filtered = filtered.filter((row) => row[field] === value); return this; },
      neq(field, value) { filtered = filtered.filter((row) => row[field] !== value); return this; },
      is(field, value) { filtered = filtered.filter((row) => row[field] === value); return this; },
      in(field, values) { filtered = filtered.filter((row) => values.includes(row[field])); return this; },
      order() { return this; },
      limit(value) { maximum = value; return this; },
      insert(value) { mode = "insert"; payload = value; return this; },
      update(value) { mode = "update"; payload = value; return this; },
      maybeSingle() {
        const result = this.run();
        return Promise.resolve({ ...result, data: result.data?.[0] ?? null });
      },
      then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); },
      run() {
        if (mode === "insert") {
          if (tables[table].some((row) => row.id === payload.id)) {
            return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          }
          const row = { ...payload, ended_at: null };
          tables[table].push(row);
          return { data: [row], error: null };
        }
        if (mode === "update") {
          const changed = filtered.map((row) => Object.assign(row, payload));
          return { data: changed.slice(0, maximum), error: null };
        }
        return { data: filtered.slice(0, maximum), error: null };
      },
    };
    return queryBuilder;
  }

  const service = { from: query };
  const auth = { auth: { getUser: async () => ({ data: { user: { id: "class-device-5e2", phone: "+22500000000" } } }) } };
  const route = evaluate("src/app/api/class/sessions/start/route.ts", {
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/lib/supabase-server": { getSupabaseServerClient: async () => auth },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/education-attendance": {
      attendanceClassContextIsComplete: () => true,
      resolveAttendanceEducationContext: () => ({ education_type: "general_secondary" }),
    },
    "@/lib/class-device-cloud-session": cloudIds,
    "@/lib/class-device-identity": { classDeviceMayAccessClass: async () => true },
  });

  async function start(body, operationId = "operation-info-001") {
    const response = await route.POST(new Request("http://local/api/class/sessions/start", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mon-cahier-operation-id": operationId },
      body: JSON.stringify({ class_id: "class-5e2", subject_id: "inst-info", ...body }),
    }));
    return { status: response.status, body: await response.json() };
  }

  return { tables, start };
}

test("Autre cours dans un créneau garde la matière et l'enseignant affecté, pas l'EDT EPS", async () => {
  const cloud = makeCloud();
  const result = await cloud.start({ manual_course: true, actual_call_at: at(9, 12), period_id: "period-0905" });
  assert.equal(result.status, 200);
  assert.equal(result.body.item.hors_edt, true);
  assert.equal(result.body.item.period_id, "period-0905");
  assert.equal(result.body.item.subject_name, "Informatique");
  assert.equal(result.body.item.actual_call_at, at(9, 12));
  assert.deepEqual(cloud.tables.teacher_sessions.map((session) => ({
    teacher_id: session.teacher_id,
    subject_id: session.subject_id,
    started_at: session.started_at,
    actual_call_at: session.actual_call_at,
    origin: session.origin,
  })), [{
    teacher_id: "teacher-info", subject_id: "inst-info",
    started_at: at(9, 12), actual_call_at: at(9, 12), origin: "class_device",
  }]);
});

test("deux disciplines prévues : le Cloud rattache l'appel à l'enseignant choisi", async () => {
  const cloud = makeCloud({ teacher_timetables: [
    { institution_id: "csca", class_id: "class-5e2", subject_id: "inst-eps", period_id: "period-0905", teacher_id: "teacher-eps" },
    { institution_id: "csca", class_id: "class-5e2", subject_id: "inst-info", period_id: "period-0905", teacher_id: "teacher-info" },
  ] });
  const result = await cloud.start({
    manual_course: false,
    subject_id: "inst-info",
    actual_call_at: at(9, 12),
    period_id: "period-0905",
  }, "operation-selected-info");
  assert.equal(result.status, 200);
  assert.equal(result.body.item.period_id, "period-0905");
  assert.equal(cloud.tables.teacher_sessions.length, 1);
  assert.equal(cloud.tables.teacher_sessions[0].subject_id, "inst-info");
  assert.equal(cloud.tables.teacher_sessions[0].teacher_id, "teacher-info");
});

test("Autre cours démarre hors créneau tandis que le cours automatique y est refusé", async () => {
  const cloud = makeCloud();
  const automatic = await cloud.start({ manual_course: false, actual_call_at: at(7) }, "operation-auto-001");
  assert.equal(automatic.status, 409);
  assert.equal(automatic.body.error, "attendance_outside_slot");
  assert.equal(cloud.tables.teacher_sessions.length, 0);

  const manual = await cloud.start({ manual_course: true, actual_call_at: at(7) }, "operation-manual-001");
  assert.equal(manual.status, 200);
  assert.equal(manual.body.item.period_id, null);
  assert.equal(manual.body.item.hors_edt, true);
  assert.equal(manual.body.item.actual_call_at, at(7));
  assert.equal(cloud.tables.teacher_sessions[0].teacher_id, "teacher-info");
});

test("Autre cours refuse une matière sans affectation ou affectée à plusieurs enseignants", async () => {
  const missing = makeCloud({ class_teachers: [] });
  const noTeacher = await missing.start({ manual_course: true, actual_call_at: at(9, 12) });
  assert.equal(noTeacher.status, 403);
  assert.equal(noTeacher.body.error, "class_subject_not_assigned_to_teacher");
  assert.equal(missing.tables.teacher_sessions.length, 0);

  const ambiguous = makeCloud({ class_teachers: [
    { institution_id: "csca", class_id: "class-5e2", subject_id: "canonical-info", teacher_id: "teacher-info" },
    { institution_id: "csca", class_id: "class-5e2", subject_id: "inst-info", teacher_id: "teacher-second" },
  ] });
  const manyTeachers = await ambiguous.start({ manual_course: true, actual_call_at: at(9, 12) });
  assert.equal(manyTeachers.status, 409);
  assert.equal(manyTeachers.body.error, "ambiguous_class_subject_teacher");
  assert.equal(ambiguous.tables.teacher_sessions.length, 0);
});

test("Autre cours refuse d'ouvrir une seconde séance sur la même classe", async () => {
  const cloud = makeCloud({ teacher_sessions: [{
    id: "previous-session", institution_id: "csca", class_id: "class-5e2",
    teacher_id: "teacher-eps", subject_id: "inst-eps", status: "open", ended_at: null,
  }] });
  const result = await cloud.start({ manual_course: true, actual_call_at: at(9, 12) });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "class_session_already_open");
  assert.equal(cloud.tables.teacher_sessions.length, 1);
});

test("rejeu hors ligne de la même opération conserve séance, matière et heure de l'appel", async () => {
  const cloud = makeCloud();
  const payload = { manual_course: true, subject_id: "canonical-info", actual_call_at: at(7), period_id: null };
  const first = await cloud.start(payload, "offline-replay-001");
  const retry = await cloud.start(payload, "offline-replay-001");
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(first.body.item.id, retry.body.item.id);
  assert.equal(retry.body.item.idempotent, true);
  assert.equal(retry.body.item.actual_call_at, at(7));
  assert.equal(cloud.tables.teacher_sessions.length, 1);
  assert.equal(cloud.tables.teacher_sessions[0].subject_id, "inst-info");
  assert.equal(cloud.tables.teacher_sessions[0].actual_call_at, at(7));
  assert.equal(first.body.item.clock_anomaly?.action, "device_time_preserved_for_offline_sync");
});

test("une opération rejouée avec une autre matière ne change pas la séance d'origine", async () => {
  const cloud = makeCloud({ class_teachers: [
    { institution_id: "csca", class_id: "class-5e2", subject_id: "canonical-info", teacher_id: "teacher-info" },
    { institution_id: "csca", class_id: "class-5e2", subject_id: "canonical-eps", teacher_id: "teacher-eps" },
  ] });
  const first = await cloud.start({ manual_course: true, actual_call_at: at(7) }, "offline-replay-002");
  assert.equal(first.status, 200);
  const changed = await cloud.start({ manual_course: true, actual_call_at: at(7), subject_id: "inst-eps" }, "offline-replay-002");
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, "session_slot_already_bound_to_other_subject");
  assert.equal(cloud.tables.teacher_sessions.length, 1);
  assert.equal(cloud.tables.teacher_sessions[0].subject_id, "inst-info");
});

test("une matière institutionnelle d'un autre établissement ne peut pas démarrer Autre cours", async () => {
  const cloud = makeCloud();
  const foreign = await cloud.start({ manual_course: true, actual_call_at: at(7), subject_id: "foreign-info" }, "operation-foreign-001");
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error, "invalid_subject_for_institution");
  assert.equal(cloud.tables.teacher_sessions.length, 0);
  const local = await cloud.start({ manual_course: true, actual_call_at: at(7), subject_id: "inst-info" }, "operation-local-001");
  assert.equal(local.status, 200);
  assert.equal(cloud.tables.teacher_sessions[0].subject_id, "inst-info");
});

test("un appel hors ligne utilise l'affectation valable au jour de l'appel", async () => {
  const callDate = at(7).slice(0, 10);
  const dayBefore = new Date(`${callDate}T00:00:00.000Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const expiredDate = dayBefore.toISOString().slice(0, 10);
  const valid = makeCloud({ class_teachers: [{
    institution_id: "csca", class_id: "class-5e2", subject_id: "canonical-info",
    teacher_id: "teacher-info", start_date: expiredDate, end_date: callDate,
  }] });
  const replay = await valid.start({ manual_course: true, actual_call_at: at(7) }, "operation-dated-001");
  assert.equal(replay.status, 200);
  assert.equal(valid.tables.teacher_sessions[0].teacher_id, "teacher-info");

  const expired = makeCloud({ class_teachers: [{
    institution_id: "csca", class_id: "class-5e2", subject_id: "canonical-info",
    teacher_id: "teacher-info", start_date: null, end_date: expiredDate,
  }] });
  const refused = await expired.start({ manual_course: true, actual_call_at: at(7) }, "operation-dated-002");
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "class_subject_not_assigned_to_teacher");
  assert.equal(expired.tables.teacher_sessions.length, 0);
});

test("un appel Autre cours ancien se synchronise après désactivation de la matière locale", async () => {
  const inactiveSubjects = [
    { id: "inst-info", institution_id: "csca", subject_id: "canonical-info", is_active: false },
  ];
  const historical = makeCloud({ institution_subjects: inactiveSubjects });
  const replay = await historical.start({ manual_course: true, actual_call_at: at(7) }, "operation-inactive-replay-001");
  assert.equal(replay.status, 200);
  assert.equal(replay.body.item.actual_call_at, at(7));
  assert.equal(historical.tables.teacher_sessions[0].subject_id, "inst-info");
  assert.equal(historical.tables.teacher_sessions[0].teacher_id, "teacher-info");

  const newCanonicalChoice = makeCloud({ institution_subjects: inactiveSubjects });
  const refused = await newCanonicalChoice.start({
    manual_course: true,
    actual_call_at: at(7),
    subject_id: "canonical-info",
  }, "operation-inactive-canonical-001");
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "invalid_subject_for_institution");
  assert.equal(newCanonicalChoice.tables.teacher_sessions.length, 0);
});

test("Autre cours mis hors ligne est rejoué par la file locale avec la même matière et une seule séance", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const cloud = makeCloud();
  const operationId = "offline-manual-info-001";
  const payload = {
    class_id: "class-5e2", subject_id: "inst-info", manual_course: true,
    actual_call_at: at(7), period_id: null,
  };
  globalThis.window = globalThis;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "/api/class/sessions/start");
    const body = JSON.parse(init.body);
    const sentOperationId = new Headers(init.headers).get("X-Mon-Cahier-Operation-Id");
    const result = await cloud.start(body, sentOperationId);
    return Response.json(result.body, { status: result.status });
  };
  const contract = evaluate("src/lib/attendance-cache-contract.ts", {});
  const offline = evaluate("src/lib/offline.ts", {
    "@/lib/attendance-cache-contract": contract,
    "@/lib/attendance-cache-identity": {
      attendanceCacheActor: async () => "class-device-5e2",
      attendanceAuthGeneration: () => 1,
      knownScheduleRevision: () => 1,
      observeScheduleRevision() {},
    },
    "@/lib/offline-release": { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1 },
    "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
  });
  try {
    await offline.offlineMutateJson("/api/class/sessions/start", {
      method: "POST", body: payload,
    }, {
      operationId, queueOnly: true,
      meta: { operationType: "session-start", clientSessionId: "client:manual-info" },
    });
    assert.equal((await offline.outboxStats()).total, 1);
    assert.equal(cloud.tables.teacher_sessions.length, 0);
    const replay = await offline.flushOutbox({ releaseNetworkBackoff: true });
    assert.equal(replay.flushed, 1);
    assert.equal(replay.remaining, 0);
    assert.equal(cloud.tables.teacher_sessions.length, 1);
    assert.equal(cloud.tables.teacher_sessions[0].subject_id, "inst-info");
    assert.equal(cloud.tables.teacher_sessions[0].actual_call_at, at(7));
    const repeated = await cloud.start(payload, operationId);
    assert.equal(repeated.body.item.idempotent, true);
    assert.equal(cloud.tables.teacher_sessions.length, 1);
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});

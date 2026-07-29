import assert from "node:assert/strict";
import { test } from "node:test";
import { syncRelayOnce } from "../src/cloud-sync.mjs";
import type { RelayConfig } from "../src/config.mjs";
import { openRelayDatabase } from "../src/db.mjs";
import { RelayStore } from "../src/store.mjs";
import { SYNC_PROTOCOL_VERSION } from "../src/types.mjs";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = `${DEVICE_ID}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

function config(): RelayConfig {
  return {
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "admin-token",
    institutions: [{
      code: "SCH-000001",
      name: "École test",
      cloud_sync: {
        enabled: true,
        endpoint: "https://mon-cahier.com/api/relay/sync/push",
        device_id: DEVICE_ID,
        token: TOKEN,
      },
    }],
    institutionCodes: ["SCH-000001"],
    cloudSyncBatchSize: 25,
    cloudSyncTimeoutMs: 20_000,
    cloudSyncIntervalMs: 15_000,
  };
}

function setup() {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.ensureInstitution("inst-1", "École test", "2026-07-28T08:00:00.000Z");
  db.prepare("UPDATE institutions SET code = 'SCH-000001' WHERE id = 'inst-1'").run();
  return { db, store };
}

function enqueue(store: RelayStore, operationId: string, entityId: string) {
  store.enqueue({
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: operationId,
    institution_id: "inst-1",
    device_id: "teacher:teacher-1",
    actor_profile_id: "teacher-1",
    entity_type: "teacher_session",
    entity_id: entityId,
    action: "upsert",
    base_server_version: 0,
    occurred_at: "2026-07-28T08:00:00.000Z",
    payload: {
      operation_type: "teacher_session.open",
      id: entityId,
      class_id: "class-1",
      subject_id: "subject-1",
      teacher_id: "teacher-1",
      timetable_id: "timetable-1",
      started_at: "2026-07-28T08:00:00.000Z",
      actual_call_at: "2026-07-28T08:01:00.000Z",
    },
  });
}

function enqueueAttendanceCall(
  db: ReturnType<typeof openRelayDatabase>,
  operationId: string,
  localSessionId: string,
) {
  const occurredAt = "2026-07-28T08:06:00.000Z";
  const payload = {
    operation_type: "attendance.call.submit",
    session_id: localSessionId,
    class_id: "class-1",
    period_id: "period-1",
    teacher_profile_id: "teacher-1",
    accepted_at: occurredAt,
    marks: [{
      student_id: "student-1",
      status: "present",
      late_minutes: null,
      comment: null,
    }],
  };
  db.prepare(`
    INSERT INTO sync_outbox(
      operation_id, institution_id, device_id, actor_profile_id, entity_type,
      entity_id, action, base_server_version, payload_json, occurred_at,
      protocol_version, payload_fingerprint
    ) VALUES (?, 'inst-1', 'teacher:teacher-1', 'teacher-1', 'attendance_call',
              ?, 'upsert', 0, ?, ?, ?, ?)
  `).run(
    operationId,
    localSessionId,
    JSON.stringify(payload),
    occurredAt,
    SYNC_PROTOCOL_VERSION,
    "b".repeat(64),
  );
}

test("la synchronisation acquitte et retire seulement les opérations confirmées", async () => {
  const { db, store } = setup();
  enqueue(store, "op-1", "session-1");
  enqueue(store, "op-2", "session-2");
  const calls: unknown[] = [];
  const result = await syncRelayOnce(config(), store, {
    now: () => new Date("2026-07-28T08:05:00.000Z"),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push(body);
      return new Response(JSON.stringify({
        protocol_version: 1,
        institution_id: "inst-1",
        device_id: DEVICE_ID,
        server_time: "2026-07-28T08:05:01.000Z",
        acknowledgements: [
          { operation_id: "op-1", status: "acknowledged", http_status: 200 },
          { operation_id: "op-2", status: "retryable", http_status: 503, error: "temporary" },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.acknowledged_operations, 1);
  assert.equal(result.retryable_operations, 1);
  assert.equal(store.status().pending_operations, 1);
  const remaining = db.prepare("SELECT operation_id,state,next_attempt_at FROM sync_outbox").all() as any[];
  assert.deepEqual(remaining.map((row) => [row.operation_id, row.state]), [["op-2", "pending"]]);
  assert.ok(remaining[0]?.next_attempt_at);
  db.close();
});

test("une panne réseau remet le lot en attente avec backoff", async () => {
  const { db, store } = setup();
  enqueue(store, "op-network", "session-network");
  const result = await syncRelayOnce(config(), store, {
    now: () => new Date("2026-07-28T08:05:00.000Z"),
    fetchImpl: async () => { throw new Error("network_down"); },
  });
  assert.equal(result.retryable_operations, 1);
  const row = db.prepare(`
    SELECT state,attempts,last_error,next_attempt_at FROM sync_outbox
    WHERE operation_id = 'op-network'
  `).get() as any;
  assert.equal(row.state, "pending");
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, "network_down");
  assert.ok(Date.parse(row.next_attempt_at) > Date.parse("2026-07-28T08:05:00.000Z"));
  db.close();
});

test("une dépendance empêche l'envoi de l'enfant jusqu'à l'acquittement du parent", async () => {
  const { db, store } = setup();
  enqueue(store, "parent", "session-1");
  enqueue(store, "child", "session-1");
  db.prepare(`
    INSERT INTO sync_outbox_dependencies(
      institution_id,operation_id,depends_on_operation_id,created_at
    ) VALUES ('inst-1','child','parent','2026-07-28T08:00:00.000Z')
  `).run();
  const batches: string[][] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const ids = body.operations.map((operation: any) => operation.operation_id);
    batches.push(ids);
    return new Response(JSON.stringify({
      protocol_version: 1,
      institution_id: "inst-1",
      device_id: DEVICE_ID,
      server_time: "2026-07-28T08:05:01.000Z",
      acknowledgements: ids.map((operationId: string) => ({
        operation_id: operationId,
        status: "acknowledged",
        http_status: 200,
      })),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await syncRelayOnce(config(), store, {
    now: () => new Date("2026-07-28T08:05:00.000Z"),
    fetchImpl,
  });
  await syncRelayOnce(config(), store, {
    now: () => new Date("2026-07-28T08:06:00.000Z"),
    fetchImpl,
  });
  assert.deepEqual(batches, [["parent"], ["child"]]);
  assert.equal(store.status().pending_operations, 0);
  db.close();
});

test("une erreur d'authentification conserve les opérations pour reprise après correction", async () => {
  const { db, store } = setup();
  enqueue(store, "op-auth", "session-auth");
  const result = await syncRelayOnce(config(), store, {
    now: () => new Date("2026-07-28T08:05:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  });
  assert.equal(result.retryable_operations, 1);
  const row = db.prepare("SELECT state,last_status,last_error,next_attempt_at FROM sync_outbox").get() as any;
  assert.equal(row.state, "pending");
  assert.equal(row.last_status, 401);
  assert.equal(row.last_error, "unauthorized");
  assert.ok(row.next_attempt_at);
  db.close();
});


function seedLocalSessionOpenReceipt(db: ReturnType<typeof openRelayDatabase>) {
  const at = "2026-07-28T08:00:00.000Z";
  db.prepare(`
    INSERT INTO profiles(id,institution_id,display_name,updated_at)
    VALUES ('teacher-1','inst-1','Enseignant test',?)
  `).run(at);
  db.prepare(`
    INSERT INTO classes(id,institution_id,academic_year,label,updated_at)
    VALUES ('class-1','inst-1','2026-2027','6e A',?)
  `).run(at);
  db.prepare(`
    INSERT INTO subjects(id,institution_id,name,updated_at)
    VALUES ('subject-1','inst-1','Mathématiques',?)
  `).run(at);
  db.prepare(`
    INSERT INTO institution_periods(
      id,institution_id,weekday,label,start_time,end_time,updated_at
    ) VALUES ('period-1','inst-1',2,'P1','08:00','09:00',?)
  `).run(at);
  db.prepare(`
    INSERT INTO teacher_timetables(
      id,institution_id,academic_year,class_id,subject_id,teacher_id,
      period_id,weekday,updated_at
    ) VALUES (
      'timetable-1','inst-1','2026-2027','class-1','subject-1','teacher-1',
      'period-1',2,?
    )
  `).run(at);
  db.prepare(`
    INSERT INTO teacher_sessions(
      id,institution_id,client_session_id,class_id,subject_id,teacher_id,
      period_id,started_at,actual_call_at,origin,updated_at,
      session_date,scheduled_start_at,requested_start_at,actual_started_at,
      scheduled_end_at,grace_expires_at,local_lifecycle_managed
    ) VALUES (
      'session-local','inst-1','session-local','class-1','subject-1','teacher-1',
      'period-1',?,?, 'teacher',?,
      '2026-07-28',?,?,?,
      '2026-07-28T09:00:00.000Z','2026-07-28T09:10:00.000Z',1
    )
  `).run(at, '2026-07-28T08:01:00.000Z', at, at, at, '2026-07-28T08:01:00.000Z');
  db.prepare(`
    INSERT INTO teacher_session_open_operations(
      operation_id,institution_id,protocol_version,operation_type,
      teacher_profile_id,class_id,period_id,timetable_id,subject_id,
      local_session_id,remote_session_id,payload_fingerprint,payload_json,
      created_locally,state,accepted_at,updated_at
    ) VALUES (
      'op-open','inst-1',1,'attendance.session.open',
      'teacher-1','class-1','period-1','timetable-1','subject-1',
      'session-local',NULL,?, '{}',1,'opened_on_relay',?,?
    )
  `).run('a'.repeat(64), at, at);
}

test("l'identifiant Cloud acquitté est réutilisé pour l'appel suivant", async () => {
  const { db, store } = setup();
  seedLocalSessionOpenReceipt(db);
  enqueue(store, "op-open", "session-local");
  const sent: any[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    sent.push(body.operations[0]);
    const operation = body.operations[0];
    return new Response(JSON.stringify({
      protocol_version: 1,
      institution_id: "inst-1",
      device_id: DEVICE_ID,
      server_time: "2026-07-28T08:05:01.000Z",
      acknowledgements: [{
        operation_id: operation.operation_id,
        status: "acknowledged",
        http_status: 200,
        cloud_entity_id: operation.operation_id === "op-open"
          ? "session-cloud"
          : operation.entity_id,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await syncRelayOnce(config(), store, {
    now: () => new Date("2026-07-28T08:05:00.000Z"),
    fetchImpl,
  });
  const mapping = db.prepare(`
    SELECT remote_session_id,state FROM teacher_session_open_operations
    WHERE institution_id='inst-1' AND operation_id='op-open'
  `).get() as any;
  assert.deepEqual(mapping, {
    remote_session_id: "session-cloud",
    state: "synced_with_cloud",
  });

  enqueueAttendanceCall(db, "op-attendance", "session-local");
  await syncRelayOnce(config(), store, {
    now: () => new Date("2026-07-28T08:06:05.000Z"),
    fetchImpl,
  });
  assert.equal(sent[1]?.entity_id, "session-cloud");
  assert.equal(sent[1]?.payload?.session_id, "session-cloud");
  assert.notEqual(sent[1]?.payload_fingerprint, sent[0]?.payload_fingerprint);
  db.close();
});


test("une réponse Cloud avec un statut inconnu n'est jamais considérée comme acquittée", async () => {
  const { db, store } = setup();
  enqueue(store, "op-invalid-response", "session-invalid-response");
  const result = await syncRelayOnce(config(), store, {
    now: () => new Date("2026-07-28T08:05:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({
      protocol_version: 1,
      institution_id: "inst-1",
      device_id: DEVICE_ID,
      server_time: "2026-07-28T08:05:01.000Z",
      acknowledgements: [{
        operation_id: "op-invalid-response",
        status: "unknown_status",
        http_status: 200,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  assert.equal(result.acknowledged_operations, 0);
  assert.equal(result.retryable_operations, 1);
  const row = db.prepare(`
    SELECT state,last_error,next_attempt_at FROM sync_outbox
    WHERE operation_id = 'op-invalid-response'
  `).get() as any;
  assert.equal(row.state, "pending");
  assert.equal(row.last_error, "cloud_response_invalid");
  assert.ok(row.next_attempt_at);
  db.close();
});

test("un parent bloqué bloque explicitement tous ses descendants", async () => {
  const { db, store } = setup();
  enqueue(store, "parent-blocked", "session-1");
  enqueue(store, "child-blocked", "session-1");
  enqueue(store, "grandchild-blocked", "session-1");
  db.prepare(`
    INSERT INTO sync_outbox_dependencies(
      institution_id,operation_id,depends_on_operation_id,created_at
    ) VALUES
      ('inst-1','child-blocked','parent-blocked','2026-07-28T08:00:00.000Z'),
      ('inst-1','grandchild-blocked','child-blocked','2026-07-28T08:00:00.000Z')
  `).run();
  const result = await syncRelayOnce(config(), store, {
    now: () => new Date("2026-07-28T08:05:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({
      protocol_version: 1,
      institution_id: "inst-1",
      device_id: DEVICE_ID,
      server_time: "2026-07-28T08:05:01.000Z",
      acknowledgements: [{
        operation_id: "parent-blocked",
        status: "blocked",
        http_status: 422,
        error: "timetable_not_found",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  assert.equal(result.blocked_operations, 3);
  const rows = db.prepare(`
    SELECT operation_id,state,last_status,last_error
    FROM sync_outbox ORDER BY operation_id
  `).all() as any[];
  assert.deepEqual(rows.map((row) => [row.operation_id, row.state, row.last_status]), [
    ["child-blocked", "blocked", 424],
    ["grandchild-blocked", "blocked", 424],
    ["parent-blocked", "blocked", 422],
  ]);
  assert.match(rows[0]?.last_error || "", /dependency_blocked:parent-blocked/);
  assert.match(rows[1]?.last_error || "", /dependency_blocked:parent-blocked/);
  db.close();
});

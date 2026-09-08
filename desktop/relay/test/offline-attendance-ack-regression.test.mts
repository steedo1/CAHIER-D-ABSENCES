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

function setupAttendanceOutbox() {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.ensureInstitution("inst-1", "École test", "2026-09-08T10:00:00.000Z");
  db.prepare("UPDATE institutions SET code = 'SCH-000001' WHERE id = 'inst-1'").run();

  const payload = {
    operation_type: "attendance.call.submit",
    session_id: "session-offline",
    class_id: "class-1",
    period_id: "period-1",
    teacher_profile_id: "teacher-1",
    accepted_at: "2026-09-08T10:05:00.000Z",
    marks: [
      { student_id: "student-present", status: "present", late_minutes: null, comment: null },
      { student_id: "student-absent", status: "absent", late_minutes: null, comment: null },
      { student_id: "student-late", status: "late", late_minutes: 7, comment: "Arrivé après le début" },
    ],
  };

  db.prepare(`
    INSERT INTO sync_outbox(
      operation_id, institution_id, device_id, actor_profile_id, entity_type,
      entity_id, action, base_server_version, payload_json, occurred_at,
      protocol_version, payload_fingerprint
    ) VALUES (
      'op-offline-attendance', 'inst-1', 'teacher:teacher-1', 'teacher-1',
      'attendance_call', 'session-offline', 'upsert', 0, ?,
      '2026-09-08T10:05:00.000Z', ?, ?
    )
  `).run(JSON.stringify(payload), SYNC_PROTOCOL_VERSION, "b".repeat(64));

  return { db, store, payload };
}

test("un appel hors réseau reste durable tant que le Cloud ne renvoie pas son ACK", async () => {
  const { db, store, payload } = setupAttendanceOutbox();
  try {
    const result = await syncRelayOnce(config(), store, {
      now: () => new Date("2026-09-08T10:10:00.000Z"),
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body || "{}"));
        assert.equal(body.operations.length, 1);
        assert.equal(body.operations[0].operation_id, "op-offline-attendance");
        assert.deepEqual(body.operations[0].payload.marks, payload.marks);

        // Simule une connexion intermittente : le serveur répond, mais l'ACK
        // de cette opération n'arrive pas. L'opération ne doit jamais être perdue.
        return new Response(JSON.stringify({
          protocol_version: 1,
          institution_id: "inst-1",
          device_id: DEVICE_ID,
          server_time: "2026-09-08T10:10:01.000Z",
          acknowledgements: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    assert.equal(result.acknowledged_operations, 0);
    assert.equal(result.retryable_operations, 1);

    const pending = db.prepare(`
      SELECT state, attempts, payload_json, next_attempt_at
      FROM sync_outbox
      WHERE institution_id = 'inst-1' AND operation_id = 'op-offline-attendance'
    `).get() as {
      state: string;
      attempts: number;
      payload_json: string;
      next_attempt_at: string | null;
    } | undefined;

    assert.ok(pending, "l'opération doit rester dans l'outbox sans ACK Cloud");
    assert.equal(pending.state, "pending");
    assert.equal(pending.attempts, 1);
    assert.ok(pending.next_attempt_at, "une nouvelle tentative doit être planifiée");
    assert.deepEqual(JSON.parse(pending.payload_json).marks, payload.marks);
  } finally {
    db.close();
  }
});

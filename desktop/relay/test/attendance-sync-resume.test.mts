import assert from "node:assert/strict";
import { test } from "node:test";
import {
  releaseNetworkRetryBackoffAfterConnectivity,
} from "../src/cloud-sync-grade-v4-safe.mjs";
import { openRelayDatabase } from "../src/db.mjs";
import { RelayStore } from "../src/store.mjs";
import { SYNC_PROTOCOL_VERSION } from "../src/types.mjs";

function setup() {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.ensureInstitution("inst-1", "École test", "2026-09-08T16:00:00.000Z");
  db.prepare("UPDATE institutions SET code = 'SCH-1' WHERE id = 'inst-1'").run();
  return { db, store };
}

function enqueuePending(
  store: RelayStore,
  operationId: string,
  options: { lastStatus: number | null; lastError: string; nextAttemptAt: string },
) {
  store.enqueue({
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: operationId,
    institution_id: "inst-1",
    device_id: "teacher:teacher-1",
    actor_profile_id: "teacher-1",
    entity_type: "teacher_session",
    entity_id: `session-${operationId}`,
    action: "upsert",
    base_server_version: 0,
    occurred_at: "2026-09-08T16:00:00.000Z",
    payload: { operation_type: "teacher_session.open" },
  });
  store.db.prepare(`
    UPDATE sync_outbox
    SET state = 'pending', next_attempt_at = ?, last_status = ?, last_error = ?
    WHERE institution_id = 'inst-1' AND operation_id = ?
  `).run(
    options.nextAttemptAt,
    options.lastStatus,
    options.lastError,
    operationId,
  );
}

test("le retour Cloud libère immédiatement seulement le backoff causé par le réseau", () => {
  const { db, store } = setup();
  enqueuePending(store, "network", {
    lastStatus: null,
    lastError: "network_down",
    nextAttemptAt: "2026-09-08T17:00:00.000Z",
  });
  enqueuePending(store, "server", {
    lastStatus: 503,
    lastError: "temporary",
    nextAttemptAt: "2026-09-08T17:00:00.000Z",
  });
  enqueuePending(store, "auth", {
    lastStatus: 401,
    lastError: "unauthorized",
    nextAttemptAt: "2026-09-08T17:00:00.000Z",
  });

  const released = releaseNetworkRetryBackoffAfterConnectivity(
    store,
    new Date("2026-09-08T16:05:00.000Z"),
  );
  assert.equal(released, 1);

  const rows = db.prepare(`
    SELECT operation_id, next_attempt_at, last_status, last_error
    FROM sync_outbox ORDER BY operation_id
  `).all() as Array<{
    operation_id: string;
    next_attempt_at: string;
    last_status: number | null;
    last_error: string;
  }>;
  const byId = new Map(rows.map((row) => [row.operation_id, row]));
  assert.equal(byId.get("network")?.next_attempt_at, "2026-09-08T16:05:00.000Z");
  assert.equal(byId.get("network")?.last_error, "network_down");
  assert.equal(byId.get("server")?.next_attempt_at, "2026-09-08T17:00:00.000Z");
  assert.equal(byId.get("auth")?.next_attempt_at, "2026-09-08T17:00:00.000Z");
  db.close();
});

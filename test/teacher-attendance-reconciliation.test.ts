import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileTeacherAttendanceUnknownOperationsWithDependencies,
  type TeacherAttendanceDeliveryDependencies,
  type TeacherAttendanceDeliveryRecord,
  type TeacherAttendanceOperationStore,
} from "../src/lib/teacher-attendance-delivery";

class MemoryStore implements TeacherAttendanceOperationStore {
  constructor(private rows: TeacherAttendanceDeliveryRecord[]) {}
  async list(institutionId: string) {
    return structuredClone(this.rows.filter((row) => row.institution_id === institutionId));
  }
  async put(record: TeacherAttendanceDeliveryRecord) {
    const index = this.rows.findIndex((row) => row.operation_id === record.operation_id);
    if (index >= 0) this.rows[index] = structuredClone(record);
    else this.rows.push(structuredClone(record));
  }
}

function record(): TeacherAttendanceDeliveryRecord {
  return {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: "operation-unknown-a",
    session_reference: "session-a",
    session_id: "session-a",
    class_id: "class-a",
    period_id: "period-a",
    marks: [{ student_id: "student-a", status: "absent", comment: null, observed_at: null }],
    content_key: "content-a",
    state: "delivery_unknown",
    channel: "cloud",
    created_at: "2026-08-08T08:00:00.000Z",
    updated_at: "2026-08-08T08:00:00.000Z",
    cloud_attempted_at: "2026-08-08T08:00:00.000Z",
    relay_attempted_at: null,
    last_status: 0,
    last_error: "cloud_delivery_unknown",
    requires_authentication: false,
  };
}

function dependencies(input: {
  lookup: TeacherAttendanceDeliveryDependencies["lookupCloudOperation"];
  post?: TeacherAttendanceDeliveryDependencies["postCloud"];
}) {
  const store = new MemoryStore([record()]);
  const posts: string[] = [];
  const deps: TeacherAttendanceDeliveryDependencies = {
    store,
    now: () => new Date("2026-08-08T08:10:00.000Z"),
    createOperationId: () => "must-not-change",
    cloudManifestAvailable: async () => true,
    lookupCloudOperation: input.lookup,
    postCloud: input.post || (async ({ operationId }) => {
      posts.push(operationId);
      return { ok: true, status: 200, body: { ok: true, operation_id: operationId } };
    }),
    requestPresenceProof: async () => ({ proof: "proof", expires_at: "2026-08-08T08:20:00.000Z" }),
    postRelay: async () => ({ ok: false, status: 503, body: { error: "not_used" } }),
  };
  return { deps, store, posts };
}

test("reçu acknowledged : l'opération devient cloud_synced sans renvoi", async () => {
  const { deps, store, posts } = dependencies({
    lookup: async ({ operationId }) => ({
      ok: true,
      status: 200,
      body: { operation_id: operationId, state: "acknowledged" },
    }),
  });
  const summary = await reconcileTeacherAttendanceUnknownOperationsWithDependencies("school-a", deps);
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.retried, 0);
  assert.deepEqual(posts, []);
  assert.equal((await store.list("school-a"))[0].state, "cloud_synced");
});

test("reçu absent : renvoi unique avec le même operation_id", async () => {
  const { deps, store, posts } = dependencies({
    lookup: async ({ operationId }) => ({
      ok: false,
      status: 404,
      body: { operation_id: operationId, state: "not_received" },
    }),
  });
  const summary = await reconcileTeacherAttendanceUnknownOperationsWithDependencies("school-a", deps);
  assert.equal(summary.retried, 1);
  assert.deepEqual(posts, ["operation-unknown-a"]);
  assert.equal((await store.list("school-a"))[0].state, "cloud_synced");
});

test("reçu processing : aucun renvoi aveugle", async () => {
  const { deps, store, posts } = dependencies({
    lookup: async ({ operationId }) => ({
      ok: true,
      status: 200,
      body: { operation_id: operationId, state: "processing" },
    }),
  });
  const summary = await reconcileTeacherAttendanceUnknownOperationsWithDependencies("school-a", deps);
  assert.equal(summary.still_unknown, 1);
  assert.deepEqual(posts, []);
  assert.equal((await store.list("school-a"))[0].state, "delivery_unknown");
});

test("reçu retryable : reprise avec le même identifiant", async () => {
  const { deps, posts } = dependencies({
    lookup: async ({ operationId }) => ({
      ok: true,
      status: 200,
      body: { operation_id: operationId, state: "retryable" },
    }),
  });
  const summary = await reconcileTeacherAttendanceUnknownOperationsWithDependencies("school-a", deps);
  assert.equal(summary.retried, 1);
  assert.deepEqual(posts, ["operation-unknown-a"]);
});

test("réconciliation inaccessible : l'état reste incertain", async () => {
  const { deps, store, posts } = dependencies({
    lookup: async () => { throw new Error("network"); },
  });
  const summary = await reconcileTeacherAttendanceUnknownOperationsWithDependencies("school-a", deps);
  assert.equal(summary.still_unknown, 1);
  assert.deepEqual(posts, []);
  assert.equal((await store.list("school-a"))[0].last_error, "cloud_reconciliation_unreachable");
});

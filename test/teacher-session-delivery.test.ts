import assert from "node:assert/strict";
import { test } from "node:test";
import {
  openTeacherAttendanceSessionWithDependencies,
  teacherSessionDeliveryMessage,
  type TeacherSessionDeliveryDependencies,
  type TeacherSessionDeliveryRecord,
  type TeacherSessionOperationStore,
} from "../src/lib/teacher-session-delivery";

class TestStore implements TeacherSessionOperationStore {
  records: TeacherSessionDeliveryRecord[] = [];

  async list(institutionId: string) {
    return this.records.filter((record) => record.institution_id === institutionId);
  }

  async put(record: TeacherSessionDeliveryRecord) {
    const index = this.records.findIndex((candidate) =>
      candidate.institution_id === record.institution_id &&
      candidate.operation_id === record.operation_id,
    );
    if (index >= 0) this.records[index] = structuredClone(record);
    else this.records.push(structuredClone(record));
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    institutionId: "school-a",
    classId: "class-a",
    periodId: "period-a",
    relayBaseUrl: "http://192.168.1.2:4317",
    relayAccessToken: "signed-teacher-token-never-persisted",
    ...overrides,
  } as any;
}

function success(operationId: string) {
  return {
    ok: true,
    status: 201,
    body: {
      ok: true,
      operation_id: operationId,
      state: "opened_on_relay",
      idempotent: false,
      session: {
        id: "relay-session-a",
        client_session_id: "relay-session-a",
        class_id: "class-a",
        subject_id: "subject-from-timetable",
        period_id: "period-a",
        started_at: "2026-07-22T09:00:00.000Z",
        actual_call_at: "2026-07-22T09:15:00.000Z",
      },
      presence_proof: "presence-proof-never-persisted",
      proof_expires_at: "2026-07-22T09:18:00.000Z",
      relay_time: "2026-07-22T09:15:00.000Z",
    },
  };
}

function scenario(
  store: TestStore,
  overrides: Partial<TeacherSessionDeliveryDependencies> = {},
): TeacherSessionDeliveryDependencies {
  return {
    store,
    now: () => new Date("2026-07-22T09:15:00.000Z"),
    createOperationId: () => "stable-session-open-operation",
    postRelay: async ({ payload }) => success(payload.operation_id),
    ...overrides,
  };
}

test("ouverture locale confirmée : identité dérivée conservée sans jeton ni preuve", async () => {
  const store = new TestStore();
  let sentPayload: unknown = null;
  const record = await openTeacherAttendanceSessionWithDependencies(input(), scenario(store, {
    postRelay: async ({ payload }) => {
      sentPayload = payload;
      return success(payload.operation_id);
    },
  }));
  assert.equal(record.state, "relay_opened");
  assert.equal(record.session_id, "relay-session-a");
  assert.equal(record.subject_id, "subject-from-timetable");
  assert.equal(record.operation_id, "stable-session-open-operation");
  assert.equal(teacherSessionDeliveryMessage(record), "Séance ouverte et sécurisée sur le relais local.");
  assert.deepEqual(sentPayload, {
    protocol_version: 1,
    operation_id: "stable-session-open-operation",
    operation_type: "attendance.session.open",
    class_id: "class-a",
    period_id: "period-a",
  });
  const persisted = JSON.stringify(store.records);
  assert.equal(persisted.includes("signed-teacher-token-never-persisted"), false);
  assert.equal(persisted.includes("presence-proof-never-persisted"), false);
});

test("ancien relais 404 : opération IndexedDB conservée en device_pending", async (t) => {
  for (const body of [{}, { error: "not_found" }, { message: "Cannot POST route" }]) {
    await t.test(JSON.stringify(body), async () => {
      const store = new TestStore();
      const record = await openTeacherAttendanceSessionWithDependencies(input(), scenario(store, {
        postRelay: async () => ({ ok: false, status: 404, body }),
      }));
      assert.equal(record.state, "device_pending");
      assert.equal(record.operation_id, "stable-session-open-operation");
      assert.equal(record.last_error, "relay_session_open_route_unavailable");
      assert.equal(store.records.length, 1);
      assert.equal(store.records[0]?.operation_id, record.operation_id);
      assert.doesNotMatch(teacherSessionDeliveryMessage(record), /ouverte et sécurisée/);
    });
  }
});

test("feature flag désactivé et relais inaccessible restent device_pending", async () => {
  const disabledStore = new TestStore();
  const disabled = await openTeacherAttendanceSessionWithDependencies(input(), scenario(disabledStore, {
    postRelay: async () => ({
      ok: false,
      status: 503,
      body: { error: "teacher_attendance_writes_disabled" },
    }),
  }));
  assert.equal(disabled.state, "device_pending");
  assert.equal(disabled.last_error, "teacher_attendance_writes_disabled");

  const unreachableStore = new TestStore();
  const unreachable = await openTeacherAttendanceSessionWithDependencies(input(), scenario(
    unreachableStore,
    { postRelay: async () => { throw new Error("network lost"); } },
  ));
  assert.equal(unreachable.state, "device_pending");
  assert.equal(unreachable.last_error, "relay_unreachable");
});

test("diagnostics métier explicites sans prétendre que la séance est ouverte", async (t) => {
  for (const error of [
    "attendance_outside_slot",
    "teacher_not_scheduled_for_slot",
    "teacher_timetable_ambiguous",
    "concurrent_session_open",
  ]) {
    await t.test(error, async () => {
      const store = new TestStore();
      const record = await openTeacherAttendanceSessionWithDependencies(input(), scenario(store, {
        postRelay: async () => ({ ok: false, status: 409, body: { error } }),
      }));
      assert.equal(record.state, "blocked");
      assert.equal(record.session_id, null);
      assert.equal(record.last_error, error);
      assert.doesNotMatch(teacherSessionDeliveryMessage(record), /ouverte et sécurisée/);
    });
  }
});

test("réponse perdue puis nouveau clic : même operation_id et même séance", async () => {
  const store = new TestStore();
  let attempts = 0;
  const seenOperationIds: string[] = [];
  const deps = scenario(store, {
    postRelay: async ({ payload }) => {
      attempts += 1;
      seenOperationIds.push(payload.operation_id);
      if (attempts === 1) throw new Error("response lost after commit");
      return { ...success(payload.operation_id), status: 200 };
    },
  });
  const uncertain = await openTeacherAttendanceSessionWithDependencies(input(), deps);
  const retry = await openTeacherAttendanceSessionWithDependencies(input(), deps);
  assert.equal(uncertain.state, "device_pending");
  assert.equal(retry.state, "relay_opened");
  assert.deepEqual(seenOperationIds, [
    "stable-session-open-operation",
    "stable-session-open-operation",
  ]);
  assert.equal(retry.operation_id, uncertain.operation_id);
  assert.equal(store.records.length, 1);
});

test("clics rapides : un seul POST local", async () => {
  const store = new TestStore();
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const deps = scenario(store, {
    postRelay: async ({ payload }) => {
      posts += 1;
      await gate;
      return success(payload.operation_id);
    },
  });
  const first = openTeacherAttendanceSessionWithDependencies(input(), deps);
  const second = openTeacherAttendanceSessionWithDependencies(input(), deps);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(posts, 1);
  assert.equal(left.operation_id, right.operation_id);
  assert.equal(left.session_id, right.session_id);
});

test("deux établissements isolent le même operation_id", async () => {
  const store = new TestStore();
  const deps = scenario(store);
  const first = await openTeacherAttendanceSessionWithDependencies(input(), deps);
  const second = await openTeacherAttendanceSessionWithDependencies(input({
    institutionId: "school-b",
    classId: "class-a",
    periodId: "period-a",
  }), deps);
  assert.equal(first.operation_id, second.operation_id);
  assert.equal((await store.list("school-a")).length, 1);
  assert.equal((await store.list("school-b")).length, 1);
});

test("deux occurrences datées du même cours reçoivent deux operation_id locaux", async () => {
  const store = new TestStore();
  let sequence = 0;
  const deps = scenario(store, {
    createOperationId: () => `session-occurrence-${++sequence}`,
    postRelay: async ({ payload }) => {
      const response = success(payload.operation_id);
      response.body.session.id = `relay-${payload.operation_id}`;
      response.body.session.client_session_id = response.body.session.id;
      return response;
    },
  });
  const first = await openTeacherAttendanceSessionWithDependencies(input({
    attemptKey: "class-a_subject-a_2026-07-22T09:00:00.000Z",
  }), deps);
  const nextWeek = await openTeacherAttendanceSessionWithDependencies(input({
    attemptKey: "class-a_subject-a_2026-07-29T09:00:00.000Z",
  }), deps);
  assert.notEqual(first.operation_id, nextWeek.operation_id);
  assert.notEqual(first.session_id, nextWeek.session_id);
  assert.equal(store.records.length, 2);
});

test("un refus métier est retenté seulement sur un nouveau clic avec le même operation_id", async () => {
  const store = new TestStore();
  let attempts = 0;
  const deps = scenario(store, {
    postRelay: async ({ payload }) => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false, status: 409, body: { error: "attendance_outside_slot" } };
      }
      return success(payload.operation_id);
    },
  });
  const refused = await openTeacherAttendanceSessionWithDependencies(input(), deps);
  const retried = await openTeacherAttendanceSessionWithDependencies(input(), deps);
  assert.equal(refused.state, "blocked");
  assert.equal(retried.state, "relay_opened");
  assert.equal(retried.operation_id, refused.operation_id);
  assert.equal(attempts, 2);
});

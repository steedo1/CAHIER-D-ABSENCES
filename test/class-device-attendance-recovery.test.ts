import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countClassDeviceAttendanceRecoveryWithDependencies,
  recoverClassDeviceAttendanceWithDependencies,
  type ClassDeviceAttendanceRecoveryDependencies,
} from "../src/lib/class-device-attendance-recovery";
import {
  stageTeacherAttendanceSessionCloseWithDependencies,
  type TeacherSessionLifecycleDependencies,
  type TeacherSessionLifecycleDeliveryRecord,
  type TeacherSessionLifecycleStore,
} from "../src/lib/teacher-session-lifecycle-delivery";
import type { TeacherAttendanceDeliveryRecord } from "../src/lib/teacher-attendance-delivery";
import type { TeacherSessionDeliveryRecord } from "../src/lib/teacher-session-delivery";

function attendance(
  overrides: Partial<TeacherAttendanceDeliveryRecord> = {},
): TeacherAttendanceDeliveryRecord {
  return {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: "attendance-a",
    session_reference: "session-a",
    session_id: "session-a",
    class_id: "class-a",
    period_id: "period-a",
    marks: [
      {
        student_id: "student-a",
        status: "absent",
        comment: null,
        observed_at: null,
      },
    ],
    content_key: "content-a",
    state: "device_pending",
    channel: "relay",
    created_at: "2026-07-30T12:57:00.000Z",
    updated_at: "2026-07-30T13:00:00.000Z",
    cloud_attempted_at: null,
    relay_attempted_at: "2026-07-30T13:00:00.000Z",
    last_status: 0,
    last_error: "relay_unreachable",
    requires_authentication: false,
    ...overrides,
  };
}

function close(
  overrides: Partial<TeacherSessionLifecycleDeliveryRecord> = {},
): TeacherSessionLifecycleDeliveryRecord {
  return {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: "close-a",
    kind: "close",
    content_key: JSON.stringify({ session_id: "session-a" }),
    session_id: "session-a",
    class_id: "class-a",
    period_id: null,
    attendance_operation_id: "attendance-a",
    attempt_key: "session-a",
    state: "device_pending",
    device_requested_at: "2026-07-30T13:00:00.000Z",
    relay_requested_at: null,
    new_session: null,
    previous_session: null,
    created_at: "2026-07-30T13:00:00.000Z",
    updated_at: "2026-07-30T13:00:00.000Z",
    relay_attempted_at: null,
    last_status: null,
    last_error: null,
    last_details: null,
    requires_authentication: false,
    ...overrides,
  };
}

function context() {
  return {
    institutionId: "school-a",
    classId: "class-a",
    actorProfileId: "device-a",
    relayBaseUrl: "http://192.168.1.2:4317",
    relayAccessToken: "signed-class-device-token",
  };
}

function recoveryScenario(input?: {
  attendance?: TeacherAttendanceDeliveryRecord[];
  lifecycle?: TeacherSessionLifecycleDeliveryRecord[];
  keepAttendancePending?: boolean;
}) {
  let attendanceRows = structuredClone(
    input?.attendance || [attendance()],
  );
  let lifecycleRows = structuredClone(input?.lifecycle || [close()]);
  const order: string[] = [];
  const replaceAttendance = (record: TeacherAttendanceDeliveryRecord) => {
    attendanceRows = attendanceRows.map((candidate) =>
      candidate.operation_id === record.operation_id ? record : candidate,
    );
  };
  const replaceLifecycle = (
    record: TeacherSessionLifecycleDeliveryRecord,
  ) => {
    lifecycleRows = lifecycleRows.map((candidate) =>
      candidate.operation_id === record.operation_id ? record : candidate,
    );
  };
  const deps: ClassDeviceAttendanceRecoveryDependencies = {
    async listAttendance(institutionId) {
      return structuredClone(
        attendanceRows.filter(
          (record) => record.institution_id === institutionId,
        ),
      );
    },
    async retryAttendance(record) {
      order.push(`attendance:${record.operation_id}`);
      const next = {
        ...record,
        state: input?.keepAttendancePending
          ? "device_pending" as const
          : "relay_secured" as const,
        last_status: input?.keepAttendancePending ? 0 : 202,
        last_error: input?.keepAttendancePending
          ? "relay_unreachable"
          : null,
      };
      replaceAttendance(next);
      return structuredClone(next);
    },
    async listLifecycle(institutionId) {
      return structuredClone(
        lifecycleRows.filter(
          (record) => record.institution_id === institutionId,
        ),
      );
    },
    async retryClose(record) {
      order.push(`close:${record.operation_id}`);
      const next = {
        ...record,
        state: "relay_confirmed" as const,
        last_status: 202,
        last_error: null,
      };
      replaceLifecycle(next);
      return structuredClone(next);
    },
  };
  return {
    deps,
    order,
    attendanceRows: () => attendanceRows,
    lifecycleRows: () => lifecycleRows,
  };
}

test("la reprise envoie les marques avant la fermeture", async () => {
  const scenario = recoveryScenario();
  const result = await recoverClassDeviceAttendanceWithDependencies(
    context(),
    scenario.deps,
  );
  assert.deepEqual(scenario.order, [
    "attendance:attendance-a",
    "close:close-a",
  ]);
  assert.equal(result.attendance_secured, 1);
  assert.equal(result.closes_confirmed, 1);
  assert.equal(result.pending_before, 2);
  assert.equal(result.pending_after, 0);
});

test("la fermeture n'est jamais envoyée si les marques restent sur l'appareil", async () => {
  const scenario = recoveryScenario({ keepAttendancePending: true });
  const result = await recoverClassDeviceAttendanceWithDependencies(
    context(),
    scenario.deps,
  );
  assert.deepEqual(scenario.order, ["attendance:attendance-a"]);
  assert.equal(result.closes_retried, 0);
  assert.equal(result.closes_waiting_for_attendance, 1);
  assert.equal(result.pending_after, 2);
});

test("les files restent cloisonnées par classe", async () => {
  const scenario = recoveryScenario({
    attendance: [
      attendance(),
      attendance({
        operation_id: "attendance-b",
        session_reference: "session-b",
        session_id: "session-b",
        class_id: "class-b",
      }),
    ],
    lifecycle: [
      close(),
      close({
        operation_id: "close-b",
        content_key: JSON.stringify({ session_id: "session-b" }),
        session_id: "session-b",
        class_id: "class-b",
        attendance_operation_id: "attendance-b",
        attempt_key: "session-b",
      }),
    ],
  });
  await recoverClassDeviceAttendanceWithDependencies(
    context(),
    scenario.deps,
  );
  assert.deepEqual(scenario.order, [
    "attendance:attendance-a",
    "close:close-a",
  ]);
  assert.equal(
    scenario.attendanceRows().find(
      (record) => record.operation_id === "attendance-b",
    )?.state,
    "device_pending",
  );
});

test("le compteur inclut l'appel et la fermeture encore locaux", async () => {
  const scenario = recoveryScenario();
  assert.equal(
    await countClassDeviceAttendanceRecoveryWithDependencies(
      context(),
      scenario.deps,
    ),
    2,
  );
});

test("la fermeture peut être mise en file sans aucun POST réseau", async () => {
  class LifecycleStore implements TeacherSessionLifecycleStore {
    records: TeacherSessionLifecycleDeliveryRecord[] = [];

    async list(institutionId: string) {
      return structuredClone(
        this.records.filter(
          (record) => record.institution_id === institutionId,
        ),
      );
    }

    async put(record: TeacherSessionLifecycleDeliveryRecord) {
      const index = this.records.findIndex(
        (candidate) =>
          candidate.institution_id === record.institution_id &&
          candidate.operation_id === record.operation_id,
      );
      if (index >= 0) this.records[index] = structuredClone(record);
      else this.records.push(structuredClone(record));
    }
  }

  const store = new LifecycleStore();
  let posts = 0;
  const deps: TeacherSessionLifecycleDependencies = {
    store,
    now: () => new Date("2026-07-30T13:00:00.000Z"),
    createOperationId: () => "stable-close-operation",
    async postClose() {
      posts += 1;
      throw new Error("network must not be used while staging");
    },
    async postTransition() {
      throw new Error("not used");
    },
  };
  const record = await stageTeacherAttendanceSessionCloseWithDependencies(
    {
      institutionId: "school-a",
      sessionId: "session-a",
      classId: "class-a",
      attendanceOperationId: "attendance-a",
    },
    deps,
  );
  assert.equal(posts, 0);
  assert.equal(record.state, "device_pending");
  assert.equal(record.class_id, "class-a");
  assert.equal(record.attendance_operation_id, "attendance-a");
  assert.equal(record.operation_id, "stable-close-operation");
  assert.equal(store.records.length, 1);
});

test("le retour du relais seul rejoue ouverture puis marques puis fermeture avec les mêmes identifiants", async () => {
  let opens: TeacherSessionDeliveryRecord[] = [{
    schema_version: 1,
    institution_id: "school-a",
    operation_id: "stable-open-operation",
    class_id: "class-a",
    period_id: "period-a",
    attempt_key: "class-a:period-a:2026-08-01",
    content_key: "open-content",
    state: "device_pending",
    session_id: null,
    subject_id: null,
    started_at: null,
    actual_call_at: null,
    scheduled_end_at: null,
    grace_expires_at: null,
    relay_time: null,
    session_state: null,
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-01T08:00:00.000Z",
    relay_attempted_at: "2026-08-01T08:00:00.000Z",
    last_status: 0,
    last_error: "relay_unreachable",
    requires_authentication: false,
    last_details: null,
  }];
  const scenario = recoveryScenario();
  const order = scenario.order;
  const deps: ClassDeviceAttendanceRecoveryDependencies = {
    ...scenario.deps,
    async listOpen() {
      return structuredClone(opens);
    },
    async retryOpen(record) {
      order.push(`open:${record.operation_id}`);
      const next = {
        ...record,
        state: "relay_opened" as const,
        session_id: "relay-session-a",
        subject_id: "subject-a",
      };
      opens = [next];
      return structuredClone(next);
    },
    async afterOpenRecovered(record) {
      order.push(`mapped:${record.operation_id}:${record.session_id}`);
    },
  };

  const result = await recoverClassDeviceAttendanceWithDependencies(
    context(),
    deps,
  );
  assert.deepEqual(order, [
    "open:stable-open-operation",
    "mapped:stable-open-operation:relay-session-a",
    "attendance:attendance-a",
    "close:close-a",
  ]);
  assert.equal(result.opens_retried, 1);
  assert.equal(result.opens_confirmed, 1);
  assert.equal(result.recovered_sessions[0]?.operation_id, "stable-open-operation");
  assert.equal(result.recovered_sessions[0]?.session_id, "relay-session-a");
});

test("une migration interrompue apres l'ouverture relais reprend au cycle suivant", async () => {
  const opened: TeacherSessionDeliveryRecord = {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: "stable-open-operation",
    class_id: "class-a",
    period_id: "period-a",
    attempt_key: "class-a:period-a:2026-08-01",
    content_key: "open-content",
    state: "relay_opened",
    session_id: "relay-session-a",
    subject_id: "subject-a",
    started_at: "2026-08-01T08:00:00.000Z",
    actual_call_at: "2026-08-01T08:01:00.000Z",
    scheduled_end_at: "2026-08-01T09:00:00.000Z",
    grace_expires_at: "2026-08-01T09:10:00.000Z",
    relay_time: "2026-08-01T08:01:00.000Z",
    session_state: "open",
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-01T08:01:00.000Z",
    relay_attempted_at: "2026-08-01T08:01:00.000Z",
    last_status: 201,
    last_error: null,
    requires_authentication: false,
    last_details: null,
  };
  let migrations = 0;
  const deps: ClassDeviceAttendanceRecoveryDependencies = {
    async listOpen() { return [structuredClone(opened)]; },
    async retryOpen() { throw new Error("already_opened_must_not_retry"); },
    async afterOpenRecovered() {
      migrations += 1;
      if (migrations === 1) throw new Error("indexeddb_interrupted");
    },
    async listAttendance() { return []; },
    async retryAttendance(record) { return record; },
    async listLifecycle() { return []; },
    async retryClose(record) { return record; },
  };

  await assert.rejects(
    recoverClassDeviceAttendanceWithDependencies(context(), deps),
    /indexeddb_interrupted/,
  );
  const result = await recoverClassDeviceAttendanceWithDependencies(
    context(),
    deps,
  );
  assert.equal(migrations, 2);
  assert.equal(result.opens_retried, 0);
  assert.equal(result.recovered_sessions[0]?.session_id, "relay-session-a");
});

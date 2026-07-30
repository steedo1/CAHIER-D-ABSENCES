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

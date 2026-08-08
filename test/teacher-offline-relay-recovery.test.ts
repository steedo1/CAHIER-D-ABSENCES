import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recoverTeacherOfflineOperationsToRelayWithDependencies,
  type TeacherOfflineRelayRecoveryDependencies,
} from "../src/lib/teacher-offline-relay-recovery";
import type { TeacherAttendanceDeliveryRecord } from "../src/lib/teacher-attendance-delivery";
import type { TeacherSessionLifecycleDeliveryRecord } from "../src/lib/teacher-session-lifecycle-delivery";
import type { TeacherSessionDeliveryRecord } from "../src/lib/teacher-session-delivery";

function openRecord(
  overrides: Partial<TeacherSessionDeliveryRecord> = {},
): TeacherSessionDeliveryRecord {
  return {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: "open-a",
    class_id: "class-a",
    period_id: "period-a",
    attempt_key: "attempt-a",
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
    created_at: "2026-08-08T08:00:00.000Z",
    updated_at: "2026-08-08T08:00:00.000Z",
    relay_attempted_at: null,
    last_status: null,
    last_error: "relay_unreachable",
    last_details: null,
    requires_authentication: false,
    ...overrides,
  };
}

function attendanceRecord(
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
    content_key: "attendance-content",
    state: "device_pending",
    channel: "relay",
    created_at: "2026-08-08T08:01:00.000Z",
    updated_at: "2026-08-08T08:01:00.000Z",
    cloud_attempted_at: null,
    relay_attempted_at: null,
    last_status: 0,
    last_error: "relay_unreachable",
    requires_authentication: false,
    ...overrides,
  };
}

function lifecycleRecord(
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
    device_requested_at: "2026-08-08T08:02:00.000Z",
    relay_requested_at: null,
    new_session: null,
    previous_session: null,
    created_at: "2026-08-08T08:02:00.000Z",
    updated_at: "2026-08-08T08:02:00.000Z",
    relay_attempted_at: null,
    last_status: null,
    last_error: null,
    last_details: null,
    requires_authentication: false,
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    institutionId: "school-a",
    actorProfileId: "teacher-a",
    relayBaseUrl: "http://192.168.1.2:4317",
    relayAccessToken: "teacher-token",
    activeLocalSessionIds: [] as string[],
    ...overrides,
  };
}

function scenario(input?: {
  opens?: TeacherSessionDeliveryRecord[];
  attendance?: TeacherAttendanceDeliveryRecord[];
  lifecycle?: TeacherSessionLifecycleDeliveryRecord[];
  attendanceStaysPending?: boolean;
  relayUnavailable?: boolean;
}) {
  let opens = structuredClone(input?.opens || []);
  let attendance = structuredClone(input?.attendance || []);
  let lifecycle = structuredClone(input?.lifecycle || []);
  const order: string[] = [];
  const replaceOpen = (record: TeacherSessionDeliveryRecord) => {
    opens = opens.map((candidate) =>
      candidate.operation_id === record.operation_id ? record : candidate,
    );
  };
  const replaceAttendance = (record: TeacherAttendanceDeliveryRecord) => {
    attendance = attendance.map((candidate) =>
      candidate.operation_id === record.operation_id ? record : candidate,
    );
  };
  const replaceLifecycle = (record: TeacherSessionLifecycleDeliveryRecord) => {
    lifecycle = lifecycle.map((candidate) =>
      candidate.operation_id === record.operation_id ? record : candidate,
    );
  };
  const deps: TeacherOfflineRelayRecoveryDependencies = {
    async listOpen() {
      return structuredClone(opens);
    },
    async retryOpen(record) {
      order.push(`open:${record.operation_id}`);
      const next: TeacherSessionDeliveryRecord = input?.relayUnavailable
        ? { ...record, last_status: 0, last_error: "relay_unreachable" }
        : {
            ...record,
            state: "relay_opened",
            session_id: "relay-session-a",
            subject_id: "subject-a",
            started_at: "2026-08-08T08:00:00.000Z",
            actual_call_at: "2026-08-08T08:00:03.000Z",
            session_state: "open",
            last_status: 201,
            last_error: null,
          };
      replaceOpen(next);
      return structuredClone(next);
    },
    async afterOpenRecovered(record) {
      order.push(`map:${record.operation_id}`);
    },
    async listAttendance() {
      return structuredClone(attendance);
    },
    async retryAttendance(record) {
      order.push(`attendance:${record.operation_id}`);
      const next: TeacherAttendanceDeliveryRecord = input?.attendanceStaysPending
        ? { ...record, last_status: 0, last_error: "relay_unreachable" }
        : {
            ...record,
            state: "relay_secured",
            channel: "relay",
            last_status: 202,
            last_error: null,
          };
      replaceAttendance(next);
      return structuredClone(next);
    },
    async listLifecycle() {
      return structuredClone(lifecycle);
    },
    async retryLifecycle(record) {
      order.push(`${record.kind}:${record.operation_id}`);
      const next: TeacherSessionLifecycleDeliveryRecord = {
        ...record,
        state: "relay_confirmed",
        last_status: record.kind === "transition" ? 201 : 202,
        last_error: null,
        new_session:
          record.kind === "transition"
            ? {
                id: "next-session-a",
                class_id: record.class_id,
                period_id: record.period_id,
                started_at: "2026-08-08T09:00:00.000Z",
              }
            : null,
      };
      replaceLifecycle(next);
      return structuredClone(next);
    },
  };
  return { deps, order };
}

test("1 - sans Internet, les marques sont sécurisées avant la fermeture", async () => {
  const s = scenario({
    attendance: [attendanceRecord()],
    lifecycle: [lifecycleRecord()],
  });
  const result = await recoverTeacherOfflineOperationsToRelayWithDependencies(
    context(),
    s.deps,
  );
  assert.deepEqual(s.order, ["attendance:attendance-a", "close:close-a"]);
  assert.equal(result.attendance_secured, 1);
  assert.equal(result.lifecycle_confirmed, 1);
  assert.equal(result.pending_after, 0);
});

test("2 - la fermeture attend tant que les marques restent sur le téléphone", async () => {
  const s = scenario({
    attendance: [attendanceRecord()],
    lifecycle: [lifecycleRecord()],
    attendanceStaysPending: true,
  });
  const result = await recoverTeacherOfflineOperationsToRelayWithDependencies(
    context(),
    s.deps,
  );
  assert.deepEqual(s.order, ["attendance:attendance-a"]);
  assert.equal(result.closes_waiting_for_attendance, 1);
  assert.equal(result.pending_after, 2);
  assert.equal(result.relay_unreachable, true);
});

test("3 - une transition est rejouée après les appels de sa classe", async () => {
  const transition = lifecycleRecord({
    operation_id: "transition-a",
    kind: "transition",
    content_key: "transition-content",
    session_id: null,
    period_id: "period-b",
    attendance_operation_id: null,
    attempt_key: "transition-attempt",
  });
  const s = scenario({
    attendance: [attendanceRecord()],
    lifecycle: [transition],
  });
  const result = await recoverTeacherOfflineOperationsToRelayWithDependencies(
    context(),
    s.deps,
  );
  assert.deepEqual(s.order, [
    "attendance:attendance-a",
    "transition:transition-a",
  ]);
  assert.equal(result.recovered_sessions[0]?.source, "transition");
  assert.equal(result.recovered_sessions[0]?.session.id, "next-session-a");
});

test("4 - une ouverture n'est rejouée que si sa séance locale est encore active", async () => {
  const s = scenario({ opens: [openRecord()] });
  const waiting = await recoverTeacherOfflineOperationsToRelayWithDependencies(
    context(),
    s.deps,
  );
  assert.deepEqual(s.order, []);
  assert.equal(waiting.opens_waiting_for_user, 1);

  const active = await recoverTeacherOfflineOperationsToRelayWithDependencies(
    context({ activeLocalSessionIds: ["client:attempt-a"] }),
    s.deps,
  );
  assert.deepEqual(s.order, ["open:open-a", "map:open-a"]);
  assert.equal(active.opens_confirmed, 1);
  assert.equal(active.recovered_sessions[0]?.session.id, "relay-session-a");
});

test("5 - une séance déjà terminée rejoue son ouverture avant ses données dépendantes", async () => {
  const open = openRecord({ operation_id: "open-completed" });
  const attendance = attendanceRecord({
    session_reference: "client:open-completed",
    session_id: "client:open-completed",
  });
  const close = lifecycleRecord({
    content_key: JSON.stringify({ session_id: "client:open-completed" }),
    session_id: "client:open-completed",
  });
  const s = scenario({ opens: [open], attendance: [attendance], lifecycle: [close] });
  const result = await recoverTeacherOfflineOperationsToRelayWithDependencies(
    context(),
    s.deps,
  );
  assert.deepEqual(s.order, [
    "open:open-completed",
    "map:open-completed",
    "attendance:attendance-a",
    "close:close-a",
  ]);
  assert.equal(result.opens_confirmed, 1);
  assert.equal(result.attendance_secured, 1);
  assert.equal(result.lifecycle_confirmed, 1);
});

test("6 - une livraison Cloud incertaine n'est jamais renvoyée vers le relais", async () => {
  const uncertain = attendanceRecord({
    state: "delivery_unknown",
    channel: "cloud",
    cloud_attempted_at: "2026-08-08T08:01:30.000Z",
    last_error: "cloud_delivery_unknown",
  });
  const s = scenario({ attendance: [uncertain] });
  const result = await recoverTeacherOfflineOperationsToRelayWithDependencies(
    context(),
    s.deps,
  );
  assert.deepEqual(s.order, []);
  assert.equal(result.requires_attention, 1);
  assert.equal(result.pending_after, 1);
});

test("7 - sans configuration relais, aucune donnée n'est supprimée", async () => {
  const s = scenario({ attendance: [attendanceRecord()] });
  const result = await recoverTeacherOfflineOperationsToRelayWithDependencies(
    context({ relayBaseUrl: null, relayAccessToken: null }),
    s.deps,
  );
  assert.deepEqual(s.order, []);
  assert.equal(result.pending_before, 1);
  assert.equal(result.pending_after, 1);
  assert.equal(result.relay_unreachable, true);
});

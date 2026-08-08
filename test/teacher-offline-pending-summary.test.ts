import assert from "node:assert/strict";
import test from "node:test";
import {
  getTeacherOfflinePendingSummaryWithDependencies,
  summarizeTeacherOfflinePending,
  type TeacherOfflinePendingDependencies,
} from "../src/lib/teacher-offline-pending";
import type { TeacherAttendanceDeliveryRecord } from "../src/lib/teacher-attendance-delivery";
import type { TeacherSessionDeliveryRecord } from "../src/lib/teacher-session-delivery";
import type { TeacherSessionLifecycleDeliveryRecord } from "../src/lib/teacher-session-lifecycle-delivery";

function sessionOpen(
  state: TeacherSessionDeliveryRecord["state"],
  operationId: string,
): TeacherSessionDeliveryRecord {
  return {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: operationId,
    class_id: "class-a",
    period_id: "period-a",
    attempt_key: operationId,
    content_key: operationId,
    state,
    session_id: null,
    subject_id: null,
    started_at: null,
    actual_call_at: null,
    scheduled_end_at: null,
    grace_expires_at: null,
    relay_time: null,
    session_state: null,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
    relay_attempted_at: null,
    last_status: null,
    last_error: null,
    last_details: null,
    requires_authentication: false,
  };
}

function attendance(
  state: TeacherAttendanceDeliveryRecord["state"],
  operationId: string,
  requiresAuthentication = false,
): TeacherAttendanceDeliveryRecord {
  return {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: operationId,
    session_reference: "session-a",
    session_id: "session-a",
    class_id: "class-a",
    period_id: "period-a",
    marks: [],
    content_key: operationId,
    state,
    channel: null,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
    cloud_attempted_at: null,
    relay_attempted_at: null,
    last_status: null,
    last_error: null,
    requires_authentication: requiresAuthentication,
  };
}

function lifecycle(
  state: TeacherSessionLifecycleDeliveryRecord["state"],
  operationId: string,
): TeacherSessionLifecycleDeliveryRecord {
  return {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: operationId,
    kind: "close",
    content_key: operationId,
    session_id: "session-a",
    class_id: "class-a",
    period_id: "period-a",
    attendance_operation_id: null,
    attempt_key: operationId,
    state,
    device_requested_at: "2026-08-08T00:00:00.000Z",
    relay_requested_at: null,
    new_session: null,
    previous_session: null,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
    relay_attempted_at: null,
    last_status: null,
    last_error: null,
    last_details: null,
    requires_authentication: false,
  };
}

test("le compteur agrège outbox, ouverture, appel, fermeture et transition", () => {
  const summary = summarizeTeacherOfflinePending({
    institutionId: "school-a",
    outbox: { total: 3, pending: 2, blocked: 1 },
    sessionOpen: [
      sessionOpen("device_pending", "open-local"),
      sessionOpen("relay_opened", "open-relay"),
      sessionOpen("cloud_opened", "open-cloud"),
    ],
    attendance: [
      attendance("device_pending", "attendance-local"),
      attendance("relay_secured", "attendance-relay"),
      attendance("delivery_unknown", "attendance-unknown"),
      attendance("conflict", "attendance-conflict"),
      attendance("cloud_synced", "attendance-cloud"),
    ],
    lifecycle: [
      lifecycle("device_pending", "close-local"),
      lifecycle("relay_confirmed", "close-relay"),
      lifecycle("blocked", "transition-blocked"),
    ],
  });

  assert.equal(summary.device_pending, 5);
  assert.equal(summary.relay_secured, 3);
  assert.equal(summary.delivery_unknown, 1);
  assert.equal(summary.blocked, 3);
  assert.equal(summary.total, 12);
  assert.equal(summary.at_risk, 9);
  assert.equal(summary.breakdown.outbox.total, 3);
  assert.equal(summary.breakdown.session_open.total, 2);
  assert.equal(summary.breakdown.attendance.total, 4);
  assert.equal(summary.breakdown.lifecycle.total, 3);
});

test("les opérations Cloud terminées sont exclues du total", () => {
  const summary = summarizeTeacherOfflinePending({
    institutionId: "school-a",
    outbox: { total: 0, pending: 0, blocked: 0 },
    sessionOpen: [sessionOpen("cloud_opened", "open-cloud")],
    attendance: [attendance("cloud_synced", "attendance-cloud")],
    lifecycle: [],
  });

  assert.equal(summary.total, 0);
  assert.equal(summary.at_risk, 0);
});

test("une opération sécurisée sur le relais est suivie mais ne risque plus d'être perdue à la déconnexion", () => {
  const summary = summarizeTeacherOfflinePending({
    institutionId: "school-a",
    outbox: { total: 0, pending: 0, blocked: 0 },
    sessionOpen: [sessionOpen("relay_opened", "open-relay")],
    attendance: [attendance("relay_secured", "attendance-relay")],
    lifecycle: [lifecycle("relay_confirmed", "close-relay")],
  });

  assert.equal(summary.total, 3);
  assert.equal(summary.relay_secured, 3);
  assert.equal(summary.at_risk, 0);
});

test("l'agrégateur utilise l'établissement connu et compte l'authentification requise", async () => {
  const calls: string[] = [];
  const deps: TeacherOfflinePendingDependencies = {
    async getCachedInstitutionId() {
      return "school-cache";
    },
    async getOutboxStats() {
      return { total: 1, pending: 1, blocked: 0 };
    },
    async listSessionOpen(institutionId) {
      calls.push(`open:${institutionId}`);
      return [sessionOpen("device_pending", "open-local")];
    },
    async listAttendance(institutionId) {
      calls.push(`attendance:${institutionId}`);
      return [attendance("device_pending", "attendance-local", true)];
    },
    async listLifecycle(institutionId) {
      calls.push(`lifecycle:${institutionId}`);
      return [lifecycle("device_pending", "close-local")];
    },
  };

  const summary = await getTeacherOfflinePendingSummaryWithDependencies(
    "school-current",
    deps,
  );

  assert.deepEqual(calls.sort(), [
    "attendance:school-current",
    "lifecycle:school-current",
    "open:school-current",
  ]);
  assert.equal(summary.institution_id, "school-current");
  assert.equal(summary.total, 4);
  assert.equal(summary.requires_authentication, 1);
});

test("sans établissement, l'outbox générique reste comptée sans lire les files professeur", async () => {
  let specializedReads = 0;
  const deps: TeacherOfflinePendingDependencies = {
    async getCachedInstitutionId() {
      return null;
    },
    async getOutboxStats() {
      return { total: 2, pending: 1, blocked: 1 };
    },
    async listSessionOpen() {
      specializedReads += 1;
      return [];
    },
    async listAttendance() {
      specializedReads += 1;
      return [];
    },
    async listLifecycle() {
      specializedReads += 1;
      return [];
    },
  };

  const summary = await getTeacherOfflinePendingSummaryWithDependencies(null, deps);

  assert.equal(specializedReads, 0);
  assert.equal(summary.total, 2);
  assert.equal(summary.at_risk, 2);
});

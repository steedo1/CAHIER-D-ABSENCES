import assert from "node:assert/strict";
import test from "node:test";
import {
  teacherSessionLifecycleCountsAsFinalized,
  type TeacherSessionLifecycleDeliveryRecord,
} from "../src/lib/teacher-session-lifecycle-delivery";

function record(
  state: TeacherSessionLifecycleDeliveryRecord["state"],
  kind: TeacherSessionLifecycleDeliveryRecord["kind"] = "close",
): TeacherSessionLifecycleDeliveryRecord {
  return {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: "operation-a",
    kind,
    content_key: "content-a",
    session_id: "session-a",
    class_id: "class-a",
    period_id: null,
    attendance_operation_id: "attendance-a",
    attempt_key: "session-a",
    state,
    device_requested_at: "2026-08-08T02:00:00.000Z",
    relay_requested_at: null,
    new_session: null,
    previous_session: null,
    created_at: "2026-08-08T02:00:00.000Z",
    updated_at: "2026-08-08T02:00:00.000Z",
    relay_attempted_at: null,
    last_status: null,
    last_error: null,
    last_details: null,
    requires_authentication: false,
  };
}

test("une fermeture conservée sur le téléphone masque la séance distante encore ouverte", () => {
  assert.equal(
    teacherSessionLifecycleCountsAsFinalized(record("device_pending")),
    true,
  );
});

test("une fermeture confirmée par le relais reste finalisée", () => {
  assert.equal(
    teacherSessionLifecycleCountsAsFinalized(record("relay_confirmed")),
    true,
  );
});

test("une fermeture bloquée reste visible pour correction", () => {
  assert.equal(
    teacherSessionLifecycleCountsAsFinalized(record("blocked")),
    false,
  );
});

test("une transition n'est jamais confondue avec une fermeture", () => {
  assert.equal(
    teacherSessionLifecycleCountsAsFinalized(record("device_pending", "transition")),
    false,
  );
});

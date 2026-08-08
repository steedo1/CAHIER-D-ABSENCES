import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTeacherSessionOpenRelayPayload } from "../src/lib/teacher-session-protocol";
import { buildTeacherSessionCloseRelayPayload } from "../src/lib/teacher-session-lifecycle-protocol";

const replay = {
  eventAt: "2026-08-07T08:04:00.000Z",
  queuedAt: "2026-08-07T08:05:00.000Z",
  clientSessionId: "client:open-operation-123456",
  scheduleRevision: 12,
  timezone: "Africa/Abidjan",
  scheduledStartAt: "2026-08-07T08:00:00.000Z",
};

test("le protocole v1 reste inchangé pour une ouverture en direct", () => {
  assert.deepEqual(buildTeacherSessionOpenRelayPayload({
    operationId: "open-operation-123456",
    classId: "class-a",
    periodId: "period-a",
  }), {
    protocol_version: 1,
    operation_id: "open-operation-123456",
    operation_type: "attendance.session.open",
    class_id: "class-a",
    period_id: "period-a",
  });
});

test("le protocole v2 transporte le contexte historique de l'ouverture", () => {
  const payload = buildTeacherSessionOpenRelayPayload({
    operationId: "open-operation-123456",
    classId: "class-a",
    periodId: "period-a",
    replay,
  });
  assert.equal(payload.protocol_version, 2);
  assert.equal(payload.event_at, replay.eventAt);
  assert.deepEqual(payload.replay_context, {
    mode: "offline_replay",
    queued_at: replay.queuedAt,
    client_session_id: replay.clientSessionId,
    schedule_revision: 12,
    timezone: "Africa/Abidjan",
    scheduled_start_at: replay.scheduledStartAt,
  });
});

test("la fermeture différée conserve aussi son heure historique", () => {
  const payload = buildTeacherSessionCloseRelayPayload({
    operationId: "close-operation-123456",
    sessionId: "relay-session-a",
    replay: {
      ...replay,
      eventAt: "2026-08-07T08:55:00.000Z",
    },
  });
  assert.equal(payload.protocol_version, 2);
  assert.equal(payload.event_at, "2026-08-07T08:55:00.000Z");
  assert.equal(payload.replay_context.client_session_id, replay.clientSessionId);
});

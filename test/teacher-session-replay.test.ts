import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertTeacherSessionReplayScheduledStart,
  TeacherSessionReplayError,
  validateTeacherSessionReplay,
} from "../src/lib/teacher-session-replay";

const operationId = "offline-open-123456";
const serverNow = new Date("2026-08-08T10:00:00.000Z");

function context(overrides: Record<string, unknown> = {}) {
  return {
    mode: "offline_replay",
    queued_at: "2026-08-07T08:05:00.000Z",
    client_session_id: `client:${operationId}`,
    schedule_revision: 12,
    timezone: "Africa/Abidjan",
    scheduled_start_at: "2026-08-07T08:00:00.000Z",
    ...overrides,
  };
}

test("un appel hors ligne peut être rejoué le lendemain avec son heure originale", () => {
  const replay = validateTeacherSessionReplay({
    rawContext: context(),
    eventAtRaw: "2026-08-07T08:04:00.000Z",
    operationId,
    serverNow,
    expectedTimezone: "Africa/Abidjan",
    currentScheduleRevision: 12,
    requireScheduledStart: true,
  });
  assert.ok(replay);
  assert.equal(replay.eventAt.toISOString(), "2026-08-07T08:04:00.000Z");
  assert.equal(replay.scheduleRevisionStale, false);
  assertTeacherSessionReplayScheduledStart(
    replay,
    new Date("2026-08-07T08:00:00.000Z"),
  );
});

test("un appel direct sans contexte reste un appel direct", () => {
  assert.equal(validateTeacherSessionReplay({
    rawContext: null,
    eventAtRaw: serverNow.toISOString(),
    operationId,
    serverNow,
    expectedTimezone: "Africa/Abidjan",
  }), null);
});

test("le rejeu refuse une identité locale qui ne correspond pas à l'opération", () => {
  assert.throws(
    () => validateTeacherSessionReplay({
      rawContext: context({ client_session_id: "client:another-operation" }),
      eventAtRaw: "2026-08-07T08:04:00.000Z",
      operationId,
      serverNow,
      expectedTimezone: "Africa/Abidjan",
    }),
    (error: unknown) =>
      error instanceof TeacherSessionReplayError &&
      error.code === "offline_replay_client_session_mismatch",
  );
});

test("le rejeu refuse une heure future ou trop ancienne", () => {
  for (const [eventAt, code] of [
    ["2026-08-08T10:06:00.000Z", "offline_replay_event_at_in_future"],
    ["2026-06-01T08:00:00.000Z", "offline_replay_too_old"],
  ] as const) {
    assert.throws(
      () => validateTeacherSessionReplay({
        rawContext: context({ queued_at: eventAt }),
        eventAtRaw: eventAt,
        operationId,
        serverNow,
        expectedTimezone: "Africa/Abidjan",
      }),
      (error: unknown) =>
        error instanceof TeacherSessionReplayError && error.code === code,
    );
  }
});

test("le rejeu refuse un début de créneau différent", () => {
  const replay = validateTeacherSessionReplay({
    rawContext: context(),
    eventAtRaw: "2026-08-07T08:04:00.000Z",
    operationId,
    serverNow,
    expectedTimezone: "Africa/Abidjan",
  });
  assert.throws(
    () => assertTeacherSessionReplayScheduledStart(
      replay,
      new Date("2026-08-07T09:00:00.000Z"),
    ),
    (error: unknown) =>
      error instanceof TeacherSessionReplayError &&
      error.code === "offline_replay_scheduled_start_mismatch",
  );
});

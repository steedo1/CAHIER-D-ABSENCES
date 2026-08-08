export const TEACHER_SESSION_OPEN_PROTOCOL_VERSION = 1 as const;
export const TEACHER_SESSION_OPEN_REPLAY_PROTOCOL_VERSION = 2 as const;
export const TEACHER_SESSION_OPEN_OPERATION_TYPE = "attendance.session.open" as const;

export type TeacherSessionOpenReplayContext = {
  mode: "offline_replay";
  queued_at: string;
  client_session_id: string;
  schedule_revision: number;
  timezone: string;
  scheduled_start_at: string;
};

export type TeacherSessionOpenRelayPayload =
  | {
      protocol_version: typeof TEACHER_SESSION_OPEN_PROTOCOL_VERSION;
      operation_id: string;
      operation_type: typeof TEACHER_SESSION_OPEN_OPERATION_TYPE;
      class_id: string;
      period_id: string;
    }
  | {
      protocol_version: typeof TEACHER_SESSION_OPEN_REPLAY_PROTOCOL_VERSION;
      operation_id: string;
      operation_type: typeof TEACHER_SESSION_OPEN_OPERATION_TYPE;
      class_id: string;
      period_id: string;
      event_at: string;
      replay_context: TeacherSessionOpenReplayContext;
    };

function requiredText(value: unknown, name: string, maxLength = 256) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name}_required`);
  if (normalized.length > maxLength) throw new Error(`${name}_too_long`);
  return normalized;
}

function requiredRevision(value: unknown) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("schedule_revision_invalid");
  }
  return revision;
}

export function buildTeacherSessionOpenRelayPayload(input: {
  operationId: string;
  classId: string;
  periodId: string;
  replay?: {
    eventAt: string;
    queuedAt: string;
    clientSessionId: string;
    scheduleRevision: number;
    timezone: string;
    scheduledStartAt: string;
  } | null;
}): TeacherSessionOpenRelayPayload {
  const operationId = requiredText(input.operationId, "operation_id", 128);
  const classId = requiredText(input.classId, "class_id");
  const periodId = requiredText(input.periodId, "period_id");
  if (!input.replay) {
    return {
      protocol_version: TEACHER_SESSION_OPEN_PROTOCOL_VERSION,
      operation_id: operationId,
      operation_type: TEACHER_SESSION_OPEN_OPERATION_TYPE,
      class_id: classId,
      period_id: periodId,
    };
  }

  return {
    protocol_version: TEACHER_SESSION_OPEN_REPLAY_PROTOCOL_VERSION,
    operation_id: operationId,
    operation_type: TEACHER_SESSION_OPEN_OPERATION_TYPE,
    class_id: classId,
    period_id: periodId,
    event_at: requiredText(input.replay.eventAt, "event_at", 64),
    replay_context: {
      mode: "offline_replay",
      queued_at: requiredText(input.replay.queuedAt, "queued_at", 64),
      client_session_id: requiredText(
        input.replay.clientSessionId,
        "client_session_id",
        192,
      ),
      schedule_revision: requiredRevision(input.replay.scheduleRevision),
      timezone: requiredText(input.replay.timezone, "timezone", 128),
      scheduled_start_at: requiredText(
        input.replay.scheduledStartAt,
        "scheduled_start_at",
        64,
      ),
    },
  };
}

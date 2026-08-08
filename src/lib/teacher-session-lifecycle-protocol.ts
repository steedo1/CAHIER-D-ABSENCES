export const TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION = 1 as const;
export const TEACHER_SESSION_CLOSE_REPLAY_PROTOCOL_VERSION = 2 as const;
export const TEACHER_SESSION_CLOSE_OPERATION_TYPE = "attendance.session.close" as const;
export const TEACHER_SESSION_TRANSITION_OPERATION_TYPE = "attendance.session.transition" as const;

export type TeacherSessionCloseReplayContext = {
  mode: "offline_replay";
  queued_at: string;
  client_session_id: string;
  schedule_revision: number;
  timezone: string;
  scheduled_start_at: string;
};

export type TeacherSessionCloseRelayPayload =
  | {
      protocol_version: typeof TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION;
      operation_id: string;
      operation_type: typeof TEACHER_SESSION_CLOSE_OPERATION_TYPE;
      session_id: string;
    }
  | {
      protocol_version: typeof TEACHER_SESSION_CLOSE_REPLAY_PROTOCOL_VERSION;
      operation_id: string;
      operation_type: typeof TEACHER_SESSION_CLOSE_OPERATION_TYPE;
      session_id: string;
      event_at: string;
      replay_context: TeacherSessionCloseReplayContext;
    };

export type TeacherSessionTransitionRelayPayload = {
  protocol_version: typeof TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION;
  operation_id: string;
  operation_type: typeof TEACHER_SESSION_TRANSITION_OPERATION_TYPE;
  class_id: string;
  period_id: string;
};

function requiredText(value: unknown, field: string, maxLength = 256) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field}_required`);
  if (normalized.length > maxLength) throw new Error(`${field}_too_long`);
  return normalized;
}

function requiredRevision(value: unknown) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("schedule_revision_invalid");
  }
  return revision;
}

export function buildTeacherSessionCloseRelayPayload(input: {
  operationId: string;
  sessionId: string;
  replay?: {
    eventAt: string;
    queuedAt: string;
    clientSessionId: string;
    scheduleRevision: number;
    timezone: string;
    scheduledStartAt: string;
  } | null;
}): TeacherSessionCloseRelayPayload {
  const operationId = requiredText(input.operationId, "operation_id", 128);
  const sessionId = requiredText(input.sessionId, "session_id");
  if (!input.replay) {
    return {
      protocol_version: TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION,
      operation_id: operationId,
      operation_type: TEACHER_SESSION_CLOSE_OPERATION_TYPE,
      session_id: sessionId,
    };
  }
  return {
    protocol_version: TEACHER_SESSION_CLOSE_REPLAY_PROTOCOL_VERSION,
    operation_id: operationId,
    operation_type: TEACHER_SESSION_CLOSE_OPERATION_TYPE,
    session_id: sessionId,
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

export function buildTeacherSessionTransitionRelayPayload(input: {
  operationId: string;
  classId: string;
  periodId: string;
}): TeacherSessionTransitionRelayPayload {
  return {
    protocol_version: TEACHER_SESSION_LIFECYCLE_PROTOCOL_VERSION,
    operation_id: requiredText(input.operationId, "operation_id", 128),
    operation_type: TEACHER_SESSION_TRANSITION_OPERATION_TYPE,
    class_id: requiredText(input.classId, "class_id"),
    period_id: requiredText(input.periodId, "period_id"),
  };
}

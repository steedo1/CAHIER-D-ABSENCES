export const TEACHER_SESSION_OFFLINE_REPLAY_MODE = "offline_replay" as const;

export const TEACHER_SESSION_REPLAY_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
export const TEACHER_SESSION_REPLAY_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export const TEACHER_SESSION_REPLAY_QUEUE_TOLERANCE_MS = 10 * 60 * 1000;

export type TeacherSessionReplayContext = {
  mode: typeof TEACHER_SESSION_OFFLINE_REPLAY_MODE;
  queued_at: string;
  client_session_id: string;
  schedule_revision: number;
  timezone: string;
  scheduled_start_at?: string | null;
};

export type ValidatedTeacherSessionReplay = {
  mode: typeof TEACHER_SESSION_OFFLINE_REPLAY_MODE;
  eventAt: Date;
  queuedAt: Date;
  clientSessionId: string;
  scheduleRevision: number;
  timezone: string;
  scheduledStartAt: Date | null;
  scheduleRevisionStale: boolean;
};

export class TeacherSessionReplayError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function date(value: unknown, code: string) {
  const parsed = new Date(String(value || "").trim());
  if (!Number.isFinite(parsed.getTime())) throw new TeacherSessionReplayError(code);
  return parsed;
}

function text(value: unknown, code: string, maxLength = 256) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TeacherSessionReplayError(code);
  if (normalized.length > maxLength) throw new TeacherSessionReplayError(`${code}_too_long`);
  return normalized;
}

function revision(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TeacherSessionReplayError("offline_replay_schedule_revision_invalid");
  }
  return parsed;
}

export function validateTeacherSessionReplay(input: {
  rawContext: unknown;
  eventAtRaw: unknown;
  operationId: string;
  clientSessionId?: string | null;
  serverNow: Date;
  expectedTimezone: string;
  currentScheduleRevision?: number | null;
  requireScheduledStart?: boolean;
  requireOperationBoundClientSession?: boolean;
}): ValidatedTeacherSessionReplay | null {
  if (input.rawContext == null) return null;
  const raw = object(input.rawContext);
  if (!raw) throw new TeacherSessionReplayError("offline_replay_context_invalid");
  if (raw.mode !== TEACHER_SESSION_OFFLINE_REPLAY_MODE) {
    throw new TeacherSessionReplayError("offline_replay_mode_invalid");
  }

  const operationId = text(input.operationId, "operation_id_required", 160);
  const eventAt = date(input.eventAtRaw, "offline_replay_event_at_invalid");
  const queuedAt = date(raw.queued_at, "offline_replay_queued_at_invalid");
  const clientSessionId = text(
    raw.client_session_id || input.clientSessionId,
    "offline_replay_client_session_id_required",
    192,
  );
  if (
    input.requireOperationBoundClientSession !== false &&
    clientSessionId !== `client:${operationId}`
  ) {
    throw new TeacherSessionReplayError("offline_replay_client_session_mismatch");
  }

  const expectedTimezone = text(
    input.expectedTimezone,
    "institution_timezone_invalid",
    128,
  );
  const timezone = text(raw.timezone, "offline_replay_timezone_required", 128);
  if (timezone !== expectedTimezone) {
    throw new TeacherSessionReplayError("offline_replay_timezone_mismatch");
  }

  const scheduleRevision = revision(raw.schedule_revision);
  const currentScheduleRevision =
    Number.isSafeInteger(Number(input.currentScheduleRevision)) &&
    Number(input.currentScheduleRevision) >= 0
      ? Number(input.currentScheduleRevision)
      : null;
  if (
    currentScheduleRevision !== null &&
    scheduleRevision > currentScheduleRevision
  ) {
    throw new TeacherSessionReplayError("offline_replay_schedule_revision_from_future");
  }

  const serverMs = input.serverNow.getTime();
  const eventMs = eventAt.getTime();
  const queuedMs = queuedAt.getTime();
  if (eventMs > serverMs + TEACHER_SESSION_REPLAY_FUTURE_TOLERANCE_MS) {
    throw new TeacherSessionReplayError("offline_replay_event_at_in_future");
  }
  if (serverMs - eventMs > TEACHER_SESSION_REPLAY_MAX_AGE_MS) {
    throw new TeacherSessionReplayError("offline_replay_too_old");
  }
  if (queuedMs < eventMs - TEACHER_SESSION_REPLAY_QUEUE_TOLERANCE_MS) {
    throw new TeacherSessionReplayError("offline_replay_queued_before_event");
  }
  if (queuedMs > serverMs + TEACHER_SESSION_REPLAY_FUTURE_TOLERANCE_MS) {
    throw new TeacherSessionReplayError("offline_replay_queued_at_in_future");
  }

  const scheduledStartRaw = String(raw.scheduled_start_at || "").trim();
  const scheduledStartAt = scheduledStartRaw
    ? date(scheduledStartRaw, "offline_replay_scheduled_start_invalid")
    : null;
  if (input.requireScheduledStart && !scheduledStartAt) {
    throw new TeacherSessionReplayError("offline_replay_scheduled_start_required");
  }

  return {
    mode: TEACHER_SESSION_OFFLINE_REPLAY_MODE,
    eventAt,
    queuedAt,
    clientSessionId,
    scheduleRevision,
    timezone,
    scheduledStartAt,
    scheduleRevisionStale:
      currentScheduleRevision !== null && scheduleRevision < currentScheduleRevision,
  };
}

export function assertTeacherSessionReplayScheduledStart(
  replay: ValidatedTeacherSessionReplay | null,
  expectedStart: Date,
) {
  if (!replay) return;
  if (!replay.scheduledStartAt) {
    throw new TeacherSessionReplayError("offline_replay_scheduled_start_required");
  }
  if (Math.abs(replay.scheduledStartAt.getTime() - expectedStart.getTime()) > 60_000) {
    throw new TeacherSessionReplayError("offline_replay_scheduled_start_mismatch");
  }
}

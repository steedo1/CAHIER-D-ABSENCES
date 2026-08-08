import { getInstitutionMeta, type RelayDatabase } from "./db.mjs";

export const RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION = 2 as const;
export const RELAY_OFFLINE_REPLAY_MODE = "offline_replay" as const;

const MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const QUEUE_TOLERANCE_MS = 10 * 60 * 1000;

export type RelayOfflineReplayContext = {
  mode: typeof RELAY_OFFLINE_REPLAY_MODE;
  queued_at: string;
  client_session_id: string;
  schedule_revision: number;
  timezone: string;
  scheduled_start_at: string;
};

export type ValidatedRelayOfflineReplay = {
  eventAt: Date;
  queuedAt: Date;
  clientSessionId: string;
  scheduleRevision: number;
  timezone: string;
  scheduledStartAt: Date;
  scheduleRevisionStale: boolean;
};

export class RelayOfflineReplayError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RelayOfflineReplayError("offline_replay_context_invalid");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, code: string, maxLength = 256) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new RelayOfflineReplayError(code);
  if (normalized.length > maxLength) {
    throw new RelayOfflineReplayError(`${code}_too_long`);
  }
  return normalized;
}

function date(value: unknown, code: string) {
  const parsed = new Date(String(value || "").trim());
  if (!Number.isFinite(parsed.getTime())) throw new RelayOfflineReplayError(code);
  return parsed;
}

function revision(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RelayOfflineReplayError("offline_replay_schedule_revision_invalid");
  }
  return parsed;
}

export function validateRelayOfflineReplay(input: {
  db: RelayDatabase;
  institutionId: string;
  operationId: string;
  eventAtRaw: unknown;
  rawContext: unknown;
  now: Date;
  requireOperationBoundClientSession: boolean;
}) {
  const raw = record(input.rawContext);
  const accepted = new Set([
    "mode",
    "queued_at",
    "client_session_id",
    "schedule_revision",
    "timezone",
    "scheduled_start_at",
  ]);
  if (Object.keys(raw).some((key) => !accepted.has(key))) {
    throw new RelayOfflineReplayError("offline_replay_context_field_not_supported");
  }
  if (raw.mode !== RELAY_OFFLINE_REPLAY_MODE) {
    throw new RelayOfflineReplayError("offline_replay_mode_invalid");
  }

  const eventAt = date(input.eventAtRaw, "offline_replay_event_at_invalid");
  const queuedAt = date(raw.queued_at, "offline_replay_queued_at_invalid");
  const clientSessionId = text(
    raw.client_session_id,
    "offline_replay_client_session_id_required",
    192,
  );
  if (
    input.requireOperationBoundClientSession &&
    clientSessionId !== `client:${input.operationId}`
  ) {
    throw new RelayOfflineReplayError("offline_replay_client_session_mismatch");
  }
  if (!clientSessionId.startsWith("client:")) {
    throw new RelayOfflineReplayError("offline_replay_client_session_invalid");
  }

  const institution = input.db.prepare(`
    SELECT timezone FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(input.institutionId) as { timezone: string } | undefined;
  if (!institution) throw new RelayOfflineReplayError("institution_not_initialized");
  const expectedTimezone = String(institution.timezone || "Africa/Abidjan");
  const timezone = text(raw.timezone, "offline_replay_timezone_required", 128);
  if (timezone !== expectedTimezone) {
    throw new RelayOfflineReplayError("offline_replay_timezone_mismatch");
  }

  const scheduleRevision = revision(raw.schedule_revision);
  const currentRaw = getInstitutionMeta(
    input.db,
    input.institutionId,
    "attendance_schedule_revision",
  );
  const currentParsed = Number(currentRaw);
  const currentRevision =
    Number.isSafeInteger(currentParsed) && currentParsed >= 0 ? currentParsed : 0;
  if (scheduleRevision > currentRevision) {
    throw new RelayOfflineReplayError("offline_replay_schedule_revision_from_future");
  }

  const serverMs = input.now.getTime();
  const eventMs = eventAt.getTime();
  const queuedMs = queuedAt.getTime();
  if (eventMs > serverMs + FUTURE_TOLERANCE_MS) {
    throw new RelayOfflineReplayError("offline_replay_event_at_in_future");
  }
  if (serverMs - eventMs > MAX_AGE_MS) {
    throw new RelayOfflineReplayError("offline_replay_too_old");
  }
  if (queuedMs < eventMs - QUEUE_TOLERANCE_MS) {
    throw new RelayOfflineReplayError("offline_replay_queued_before_event");
  }
  if (queuedMs > serverMs + FUTURE_TOLERANCE_MS) {
    throw new RelayOfflineReplayError("offline_replay_queued_at_in_future");
  }

  const scheduledStartAt = date(
    raw.scheduled_start_at,
    "offline_replay_scheduled_start_invalid",
  );
  return {
    eventAt,
    queuedAt,
    clientSessionId,
    scheduleRevision,
    timezone,
    scheduledStartAt,
    scheduleRevisionStale: scheduleRevision < currentRevision,
  } satisfies ValidatedRelayOfflineReplay;
}

export function assertRelayReplayScheduledStart(
  replay: ValidatedRelayOfflineReplay,
  expectedStartAt: string,
) {
  const expected = new Date(expectedStartAt);
  if (!Number.isFinite(expected.getTime())) {
    throw new RelayOfflineReplayError("session_schedule_missing");
  }
  if (Math.abs(replay.scheduledStartAt.getTime() - expected.getTime()) > 60_000) {
    throw new RelayOfflineReplayError("offline_replay_scheduled_start_mismatch");
  }
}

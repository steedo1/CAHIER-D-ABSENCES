import { createHash } from "node:crypto";
import type { RelayConfig, RelayInstitutionConfig } from "./config.mjs";
import { getInstitutionMeta, setInstitutionMeta, type RelayDatabase } from "./db.mjs";
import { canonicalJson, parseStoredJson } from "./json.mjs";
import type { RelayStore } from "./store.mjs";

const SYNC_PROTOCOL_VERSION = 1 as const;
const STALE_SENDING_AFTER_MS = 5 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;

type ClaimedOperation = {
  operation_id: string;
  institution_id: string;
  device_id: string;
  actor_profile_id: string | null;
  entity_type: string;
  entity_id: string;
  action: "upsert" | "delete";
  base_server_version: number;
  payload_json: string | null;
  occurred_at: string;
  protocol_version: number;
  payload_fingerprint: string | null;
  attempts: number;
};

type CloudAcknowledgement = {
  operation_id: string;
  status: "acknowledged" | "retryable" | "blocked" | "conflict";
  http_status?: number | null;
  error?: string | null;
  cloud_entity_id?: string | null;
};

type CloudPushResponse = {
  protocol_version: 1;
  institution_id: string;
  device_id: string;
  server_time: string;
  acknowledgements: CloudAcknowledgement[];
};

type CloudPullResponse =
  | {
      protocol_version: 1;
      status: "not_modified";
      institution_id: string;
      device_id: string;
      server_time: string;
      cloud_revision: number;
      schedule_revision: number;
      revision_updated_at?: string | null;
    }
  | {
      protocol_version: 1;
      status: "snapshot";
      institution_id: string;
      device_id: string;
      server_time: string;
      cloud_revision: number;
      schedule_revision: number;
      snapshot_scope: "academic" | "attendance_schedule";
      snapshot: Record<string, unknown>;
    };

export type RelayCloudSyncRunResult = {
  configured_institutions: number;
  attempted_institutions: number;
  claimed_operations: number;
  acknowledged_operations: number;
  retryable_operations: number;
  blocked_operations: number;
  conflict_operations: number;
  pull_attempted_institutions: number;
  pull_not_modified: number;
  pull_snapshots_applied: number;
  pull_retryable_institutions: number;
  skipped_institutions: Array<{ code: string; reason: string }>;
};

type SyncOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function safeError(value: unknown, fallback: string) {
  const normalized = String(value || fallback).trim() || fallback;
  return normalized.slice(0, MAX_ERROR_LENGTH);
}

function nextAttemptAt(now: Date, attempts: number) {
  const delaySeconds = Math.min(3600, 5 * (2 ** Math.max(0, Math.min(10, attempts - 1))));
  return new Date(now.getTime() + delaySeconds * 1000).toISOString();
}

function configuredCloudSync(institution: RelayInstitutionConfig) {
  const cloud = institution.cloud_sync;
  if (!cloud?.enabled) return null;
  const endpoint = String(cloud.endpoint || "").trim().replace(/\/+$/, "");
  const deviceId = String(cloud.device_id || "").trim();
  const token = String(cloud.token || "").trim();
  if (!endpoint || !deviceId || token.length < 32) return null;
  const pullEndpoint = String(cloud.pull_endpoint || "").trim().replace(/\/+$/, "") || null;
  return { endpoint, pullEndpoint, deviceId, token };
}

function institutionIdForCode(db: RelayDatabase, code: string) {
  const row = db.prepare(`
    SELECT id FROM institutions
    WHERE UPPER(COALESCE(code, '')) = UPPER(?) AND deleted_at IS NULL
    LIMIT 1
  `).get(code) as { id: string } | undefined;
  return row?.id || null;
}

function claimBatch(
  db: RelayDatabase,
  institutionId: string,
  limit: number,
  now: Date,
) {
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_SENDING_AFTER_MS).toISOString();
  return db.transaction(() => {
    db.prepare(`
      UPDATE sync_outbox
      SET state = 'pending', next_attempt_at = ?,
          last_error = 'stale_sending_recovered'
      WHERE institution_id = ? AND state = 'sending'
        AND (last_attempt_at IS NULL OR last_attempt_at <= ?)
    `).run(nowIso, institutionId, staleBefore);

    const rows = db.prepare(`
      SELECT child.operation_id, child.institution_id, child.device_id,
             child.actor_profile_id, child.entity_type, child.entity_id,
             child.action, child.base_server_version, child.payload_json,
             child.occurred_at, child.protocol_version,
             child.payload_fingerprint, child.attempts
      FROM sync_outbox child
      WHERE child.institution_id = ? AND child.state = 'pending'
        AND (child.next_attempt_at IS NULL OR child.next_attempt_at <= ?)
        AND NOT EXISTS (
          SELECT 1
          FROM sync_outbox_dependencies dependency
          JOIN sync_outbox parent
            ON parent.institution_id = dependency.institution_id
           AND parent.operation_id = dependency.depends_on_operation_id
          WHERE dependency.institution_id = child.institution_id
            AND dependency.operation_id = child.operation_id
        )
      ORDER BY child.occurred_at, child.operation_id
      LIMIT ?
    `).all(institutionId, nowIso, limit) as ClaimedOperation[];

    const markSending = db.prepare(`
      UPDATE sync_outbox
      SET state = 'sending', attempts = attempts + 1,
          last_attempt_at = ?, next_attempt_at = NULL,
          last_status = NULL, last_error = NULL
      WHERE institution_id = ? AND operation_id = ? AND state = 'pending'
    `);
    const claimed: ClaimedOperation[] = [];
    for (const row of rows) {
      const changed = markSending.run(nowIso, institutionId, row.operation_id);
      if (changed.changes === 1) claimed.push({ ...row, attempts: row.attempts + 1 });
    }
    return claimed;
  })();
}

function remoteSessionIdForLocal(
  db: RelayDatabase,
  institutionId: string,
  localSessionId: string,
) {
  const row = db.prepare(`
    SELECT remote_session_id
    FROM teacher_session_open_operations
    WHERE institution_id = ? AND local_session_id = ?
      AND state = 'synced_with_cloud' AND remote_session_id IS NOT NULL
    ORDER BY accepted_at, operation_id
    LIMIT 1
  `).get(institutionId, localSessionId) as { remote_session_id: string } | undefined;
  return String(row?.remote_session_id || "").trim() || localSessionId;
}

function wireOperation(db: RelayDatabase, row: ClaimedOperation) {
  const payload = parseStoredJson<Record<string, unknown>>(row.payload_json);
  let entityId = row.entity_id;
  let wirePayload = payload;
  if (row.entity_type === "attendance_call" || row.entity_type === "teacher_session") {
    const remoteSessionId = remoteSessionIdForLocal(db, row.institution_id, row.entity_id);
    if (remoteSessionId !== row.entity_id) {
      entityId = remoteSessionId;
      wirePayload = payload ? {
        ...payload,
        ...(Object.prototype.hasOwnProperty.call(payload, "id") ? { id: remoteSessionId } : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, "session_id")
          ? { session_id: remoteSessionId }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, "local_session_id")
          ? { remote_session_id: remoteSessionId }
          : {}),
      } : payload;
    }
  }
  const wire = {
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: row.operation_id,
    actor_profile_id: row.actor_profile_id,
    origin_device_id: row.device_id,
    entity_type: row.entity_type,
    entity_id: entityId,
    action: row.action,
    base_server_version: row.base_server_version,
    occurred_at: row.occurred_at,
    payload: wirePayload,
  };
  return {
    ...wire,
    payload_fingerprint: createHash("sha256").update(canonicalJson(wire)).digest("hex"),
  };
}

function retryOperations(
  db: RelayDatabase,
  institutionId: string,
  operations: ClaimedOperation[],
  now: Date,
  error: string,
  status: number | null,
) {
  const update = db.prepare(`
    UPDATE sync_outbox
    SET state = 'pending', next_attempt_at = ?, last_status = ?, last_error = ?
    WHERE institution_id = ? AND operation_id = ? AND state = 'sending'
  `);
  db.transaction(() => {
    for (const operation of operations) {
      update.run(
        nextAttemptAt(now, operation.attempts),
        status,
        safeError(error, "cloud_sync_failed"),
        institutionId,
        operation.operation_id,
      );
    }
    writePushError(db, institutionId, now, error);
  })();
}

function markDomainReceipt(
  db: RelayDatabase,
  institutionId: string,
  operationId: string,
  status: "acknowledged" | "blocked" | "conflict",
  error: string | null,
  cloudEntityId: string | null,
  nowIso: string,
) {
  const state = status === "acknowledged" ? "synced_with_cloud" : status;
  db.prepare(`
    UPDATE teacher_session_open_operations
    SET state = ?,
        remote_session_id = CASE
          WHEN ? IS NOT NULL AND TRIM(?) <> '' THEN ?
          ELSE remote_session_id
        END,
        updated_at = ?
    WHERE institution_id = ? AND operation_id = ?
  `).run(
    state,
    cloudEntityId,
    cloudEntityId,
    cloudEntityId,
    nowIso,
    institutionId,
    operationId,
  );
  db.prepare(`
    UPDATE teacher_attendance_operations
    SET state = ?, last_error = ?, updated_at = ?
    WHERE institution_id = ? AND operation_id = ?
  `).run(state, error, nowIso, institutionId, operationId);
}

function markTransitionFailure(
  db: RelayDatabase,
  institutionId: string,
  operationId: string,
  state: "blocked" | "conflict",
  nowIso: string,
) {
  db.prepare(`
    UPDATE teacher_session_transition_operations
    SET state = ?, updated_at = ?
    WHERE institution_id = ?
      AND (close_operation_id = ? OR open_operation_id = ?)
      AND state <> 'synced_with_cloud'
  `).run(state, nowIso, institutionId, operationId, operationId);
}

function blockDependentOperations(
  db: RelayDatabase,
  institutionId: string,
  parentOperationId: string,
  parentStatus: "blocked" | "conflict",
  parentError: string,
  nowIso: string,
) {
  const descendants = db.prepare(`
    WITH RECURSIVE descendants(operation_id) AS (
      SELECT dependency.operation_id
      FROM sync_outbox_dependencies dependency
      WHERE dependency.institution_id = ?
        AND dependency.depends_on_operation_id = ?
      UNION
      SELECT dependency.operation_id
      FROM sync_outbox_dependencies dependency
      JOIN descendants parent
        ON parent.operation_id = dependency.depends_on_operation_id
      WHERE dependency.institution_id = ?
    )
    SELECT operation_id FROM descendants ORDER BY operation_id
  `).all(
    institutionId,
    parentOperationId,
    institutionId,
  ) as Array<{ operation_id: string }>;
  const dependencyError = safeError(
    `dependency_${parentStatus}:${parentOperationId}:${parentError}`,
    `dependency_${parentStatus}`,
  );
  const update = db.prepare(`
    UPDATE sync_outbox
    SET state = 'blocked', next_attempt_at = NULL, last_status = 424, last_error = ?
    WHERE institution_id = ? AND operation_id = ?
      AND state IN ('pending', 'sending')
  `);
  let blocked = 0;
  for (const descendant of descendants) {
    const changed = update.run(dependencyError, institutionId, descendant.operation_id);
    if (changed.changes !== 1) continue;
    blocked += 1;
    markDomainReceipt(
      db,
      institutionId,
      descendant.operation_id,
      "blocked",
      dependencyError,
      null,
      nowIso,
    );
    markTransitionFailure(db, institutionId, descendant.operation_id, "blocked", nowIso);
  }
  return blocked;
}

function clearDirtyRecordsAfterAcknowledgement(
  db: RelayDatabase,
  operation: ClaimedOperation,
) {
  if (operation.entity_type === "attendance_call") {
    const payload = parseStoredJson<Record<string, unknown>>(operation.payload_json);
    const marks = Array.isArray(payload?.marks) ? payload.marks : [];
    for (const mark of marks) {
      const studentId = String((mark as Record<string, unknown>)?.student_id || "").trim();
      if (!studentId) continue;
      db.prepare(`
        UPDATE sync_records
        SET local_dirty = 0
        WHERE institution_id = ? AND entity_type = 'attendance_mark'
          AND entity_id IN (
            SELECT id FROM attendance_marks
            WHERE institution_id = ? AND session_id = ? AND student_id = ?
          )
          AND NOT EXISTS (
            SELECT 1
            FROM sync_outbox pending
            WHERE pending.institution_id = ?
              AND pending.operation_id <> ?
              AND pending.entity_type = 'attendance_call'
              AND pending.entity_id = ?
              AND pending.state IN ('pending', 'sending', 'blocked')
              AND EXISTS (
                SELECT 1
                FROM json_each(json_extract(pending.payload_json, '$.marks')) queued_mark
                WHERE json_extract(queued_mark.value, '$.student_id') = ?
              )
          )
      `).run(
        operation.institution_id,
        operation.institution_id,
        operation.entity_id,
        studentId,
        operation.institution_id,
        operation.operation_id,
        operation.entity_id,
        studentId,
      );
    }
  }

  const remaining = db.prepare(`
    SELECT 1 FROM sync_outbox
    WHERE institution_id = ? AND operation_id <> ?
      AND (
        (entity_type = ? AND entity_id = ?)
        OR (entity_type = 'attendance_call' AND entity_id = ?)
      )
    LIMIT 1
  `).get(
    operation.institution_id,
    operation.operation_id,
    operation.entity_type,
    operation.entity_id,
    operation.entity_id,
  );
  if (!remaining && (operation.entity_type === "teacher_session" || operation.entity_type === "attendance_call")) {
    db.prepare(`
      UPDATE sync_records SET local_dirty = 0
      WHERE institution_id = ? AND entity_type = 'teacher_session' AND entity_id = ?
    `).run(operation.institution_id, operation.entity_id);
  }
}

function updateTransitionReceipt(db: RelayDatabase, institutionId: string, operationId: string, nowIso: string) {
  db.prepare(`
    UPDATE teacher_session_transition_operations
    SET state = 'synced_with_cloud', updated_at = ?
    WHERE institution_id = ?
      AND (close_operation_id = ? OR open_operation_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM sync_outbox pending
        WHERE pending.institution_id = teacher_session_transition_operations.institution_id
          AND pending.operation_id IN (
            teacher_session_transition_operations.close_operation_id,
            teacher_session_transition_operations.open_operation_id
          )
      )
  `).run(nowIso, institutionId, operationId, operationId);
}

function applyAcknowledgements(
  db: RelayDatabase,
  institutionId: string,
  operations: ClaimedOperation[],
  acknowledgements: CloudAcknowledgement[],
  now: Date,
) {
  const nowIso = now.toISOString();
  const byId = new Map<string, CloudAcknowledgement>();
  for (const ack of acknowledgements) {
    if (!ack?.operation_id || byId.has(ack.operation_id)) continue;
    byId.set(ack.operation_id, ack);
  }
  const counters = { acknowledged: 0, retryable: 0, blocked: 0, conflict: 0 };

  db.transaction(() => {
    for (const operation of operations) {
      const ack = byId.get(operation.operation_id) || {
        operation_id: operation.operation_id,
        status: "retryable" as const,
        error: "cloud_ack_missing",
      };
      const error = safeError(ack.error, `cloud_${ack.status}`);
      const statusCode = Number.isInteger(ack.http_status) ? Number(ack.http_status) : null;
      if (ack.status === "acknowledged") {
        clearDirtyRecordsAfterAcknowledgement(db, operation);
        db.prepare(`
          DELETE FROM sync_outbox WHERE institution_id = ? AND operation_id = ?
        `).run(institutionId, operation.operation_id);
        markDomainReceipt(
          db,
          institutionId,
          operation.operation_id,
          "acknowledged",
          null,
          String(ack.cloud_entity_id || "").trim() || null,
          nowIso,
        );
        updateTransitionReceipt(db, institutionId, operation.operation_id, nowIso);
        db.prepare(`
          INSERT INTO audit_log(
            institution_id, actor_profile_id, device_id, event_type,
            entity_type, entity_id, details_json, occurred_at
          ) VALUES (?, ?, ?, 'sync.operation_acknowledged', ?, ?, ?, ?)
        `).run(
          institutionId,
          operation.actor_profile_id,
          operation.device_id,
          operation.entity_type,
          operation.entity_id,
          canonicalJson({ operation_id: operation.operation_id, cloud_entity_id: ack.cloud_entity_id || null }),
          nowIso,
        );
        counters.acknowledged += 1;
        continue;
      }
      if (ack.status === "retryable") {
        db.prepare(`
          UPDATE sync_outbox
          SET state = 'pending', next_attempt_at = ?, last_status = ?, last_error = ?
          WHERE institution_id = ? AND operation_id = ?
        `).run(
          nextAttemptAt(now, operation.attempts),
          statusCode,
          error,
          institutionId,
          operation.operation_id,
        );
        counters.retryable += 1;
        continue;
      }
      db.prepare(`
        UPDATE sync_outbox
        SET state = 'blocked', next_attempt_at = NULL, last_status = ?, last_error = ?
        WHERE institution_id = ? AND operation_id = ?
      `).run(statusCode, error, institutionId, operation.operation_id);
      markDomainReceipt(
        db,
        institutionId,
        operation.operation_id,
        ack.status,
        error,
        String(ack.cloud_entity_id || "").trim() || null,
        nowIso,
      );
      markTransitionFailure(db, institutionId, operation.operation_id, ack.status, nowIso);
      counters.blocked += blockDependentOperations(
        db,
        institutionId,
        operation.operation_id,
        ack.status,
        error,
        nowIso,
      );
      if (ack.status === "conflict") counters.conflict += 1;
      else counters.blocked += 1;
    }
  })();
  return counters;
}

function writePushSuccess(db: RelayDatabase, institutionId: string, now: Date) {
  const nowIso = now.toISOString();
  db.prepare(`
    INSERT INTO sync_cursors(institution_id, stream, cursor, last_success_at, last_error_at, last_error)
    VALUES (?, 'cloud_push', NULL, ?, NULL, NULL)
    ON CONFLICT(institution_id, stream) DO UPDATE SET
      last_success_at = excluded.last_success_at,
      last_error_at = NULL,
      last_error = NULL
  `).run(institutionId, nowIso);
  setInstitutionMeta(db, institutionId, "last_cloud_sync_at", nowIso);
}

function writePushError(db: RelayDatabase, institutionId: string, now: Date, error: unknown) {
  const nowIso = now.toISOString();
  db.prepare(`
    INSERT INTO sync_cursors(institution_id, stream, cursor, last_success_at, last_error_at, last_error)
    VALUES (?, 'cloud_push', NULL, NULL, ?, ?)
    ON CONFLICT(institution_id, stream) DO UPDATE SET
      last_error_at = excluded.last_error_at,
      last_error = excluded.last_error
  `).run(institutionId, nowIso, safeError(error, "cloud_sync_failed"));
}

function isCloudPushResponse(
  value: unknown,
  institutionId: string,
  deviceId: string,
): value is CloudPushResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const allowedStatuses = new Set(["acknowledged", "retryable", "blocked", "conflict"]);
  return row.protocol_version === SYNC_PROTOCOL_VERSION &&
    row.institution_id === institutionId &&
    row.device_id === deviceId &&
    Array.isArray(row.acknowledgements) &&
    row.acknowledgements.every((acknowledgement) => {
      if (!acknowledgement || typeof acknowledgement !== "object" || Array.isArray(acknowledgement)) {
        return false;
      }
      const ack = acknowledgement as Record<string, unknown>;
      const httpStatus = ack.http_status;
      return typeof ack.operation_id === "string" && ack.operation_id.trim().length > 0 &&
        typeof ack.status === "string" && allowedStatuses.has(ack.status) &&
        (httpStatus === undefined || httpStatus === null || Number.isInteger(httpStatus));
    }) &&
    Number.isFinite(Date.parse(String(row.server_time || "")));
}

function nonNegativeSafeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function storedAcademicRevision(db: RelayDatabase, institutionId: string) {
  const raw = getInstitutionMeta(db, institutionId, "academic_revision");
  return raw === null ? null : nonNegativeSafeInteger(raw);
}

function storedScheduleRevision(db: RelayDatabase, institutionId: string) {
  const raw = getInstitutionMeta(db, institutionId, "attendance_schedule_revision");
  return raw === null ? null : nonNegativeSafeInteger(raw);
}

function isCloudPullResponse(
  value: unknown,
  expectedDeviceId: string,
): value is CloudPullResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const revision = nonNegativeSafeInteger(row.cloud_revision);
  const scheduleRevision = nonNegativeSafeInteger(row.schedule_revision);
  if (
    row.protocol_version !== SYNC_PROTOCOL_VERSION ||
    row.device_id !== expectedDeviceId ||
    typeof row.institution_id !== "string" ||
    !row.institution_id.trim() ||
    revision === null || scheduleRevision === null ||
    !Number.isFinite(Date.parse(String(row.server_time || "")))
  ) {
    return false;
  }
  if (row.status === "not_modified") return true;
  if (row.status !== "snapshot") return false;
  if (!row.snapshot || typeof row.snapshot !== "object" || Array.isArray(row.snapshot)) {
    return false;
  }
  const snapshot = row.snapshot as Record<string, unknown>;
  if (snapshot.institution_id !== row.institution_id || snapshot.snapshot_completeness !== "complete") {
    return false;
  }
  return row.snapshot_scope === "academic"
    ? nonNegativeSafeInteger(snapshot.academic_revision) === revision
    : row.snapshot_scope === "attendance_schedule" &&
      nonNegativeSafeInteger(snapshot.snapshot_revision) === scheduleRevision &&
      snapshot.academic_manifest === undefined;
}

function writePullSuccess(
  db: RelayDatabase,
  institutionId: string,
  now: Date,
  revision: number,
) {
  const nowIso = now.toISOString();
  db.prepare(`
    INSERT INTO sync_cursors(institution_id, stream, cursor, last_success_at, last_error_at, last_error)
    VALUES (?, 'cloud_pull', ?, ?, NULL, NULL)
    ON CONFLICT(institution_id, stream) DO UPDATE SET
      cursor = excluded.cursor,
      last_success_at = excluded.last_success_at,
      last_error_at = NULL,
      last_error = NULL
  `).run(institutionId, String(revision), nowIso);
  setInstitutionMeta(db, institutionId, "last_cloud_pull_at", nowIso);
  setInstitutionMeta(db, institutionId, "last_cloud_pull_revision", String(revision));
}

function writePullError(
  db: RelayDatabase,
  institutionId: string,
  now: Date,
  error: unknown,
) {
  const nowIso = now.toISOString();
  db.prepare(`
    INSERT INTO sync_cursors(institution_id, stream, cursor, last_success_at, last_error_at, last_error)
    VALUES (?, 'cloud_pull', NULL, NULL, ?, ?)
    ON CONFLICT(institution_id, stream) DO UPDATE SET
      last_error_at = excluded.last_error_at,
      last_error = excluded.last_error
  `).run(institutionId, nowIso, safeError(error, "cloud_pull_failed"));
}

async function pullInstitutionSnapshot(
  config: RelayConfig,
  store: RelayStore,
  input: {
    institution: RelayInstitutionConfig;
    localInstitutionId: string | null;
    cloud: NonNullable<ReturnType<typeof configuredCloudSync>>;
    fetchImpl: typeof fetch;
    now: () => Date;
  },
) {
  const { institution, cloud, fetchImpl, now } = input;
  if (!cloud.pullEndpoint) {
    return { status: "skipped" as const, reason: "cloud_pull_endpoint_unavailable" };
  }

  const knownRevision = input.localInstitutionId
    ? storedAcademicRevision(store.db, input.localInstitutionId)
    : null;
  const knownScheduleRevision = input.localInstitutionId
    ? storedScheduleRevision(store.db, input.localInstitutionId)
    : null;
  const endpoint = new URL(cloud.pullEndpoint);
  if (knownRevision !== null) {
    endpoint.searchParams.set("known_revision", String(knownRevision));
  }
  if (knownScheduleRevision !== null) {
    endpoint.searchParams.set("known_schedule_revision", String(knownScheduleRevision));
  }

  const attemptAt = now();
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cloud.token}`,
        Accept: "application/json",
        "X-MonCahier-Relay-Device": cloud.deviceId,
      },
      signal: AbortSignal.timeout(config.cloudSyncTimeoutMs || 20_000),
    });
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const error = safeError(
        (body as Record<string, unknown> | null)?.error,
        `cloud_pull_http_${response.status}`,
      );
      if (input.localInstitutionId) {
        writePullError(store.db, input.localInstitutionId, attemptAt, error);
      }
      return { status: "retryable" as const, error };
    }
    if (!isCloudPullResponse(body, cloud.deviceId)) {
      if (input.localInstitutionId) {
        writePullError(store.db, input.localInstitutionId, attemptAt, "cloud_pull_response_invalid");
      }
      return { status: "retryable" as const, error: "cloud_pull_response_invalid" };
    }

    const institutionId = body.institution_id;
    if (
      input.localInstitutionId &&
      institutionId !== input.localInstitutionId
    ) {
      writePullError(store.db, input.localInstitutionId, attemptAt, "cloud_pull_institution_mismatch");
      return { status: "retryable" as const, error: "cloud_pull_institution_mismatch" };
    }

    if (body.status === "not_modified") {
      if (!input.localInstitutionId) {
        return { status: "retryable" as const, error: "cloud_pull_snapshot_required" };
      }
      writePullSuccess(store.db, institutionId, attemptAt, body.cloud_revision);
      return {
        status: "not_modified" as const,
        institution_id: institutionId,
        cloud_revision: body.cloud_revision,
      };
    }

    const snapshot = body.snapshot;
    const snapshotInstitution = snapshot.institution as Record<string, unknown> | undefined;
    const snapshotCode = String(snapshotInstitution?.code || "").trim().toUpperCase();
    if (
      snapshotCode &&
      snapshotCode !== String(institution.code || "").trim().toUpperCase()
    ) {
      if (input.localInstitutionId) {
        writePullError(store.db, input.localInstitutionId, attemptAt, "cloud_pull_institution_code_mismatch");
      }
      return { status: "retryable" as const, error: "cloud_pull_institution_code_mismatch" };
    }

    const bootstrapResult = store.bootstrap(snapshot);
    if (
      (bootstrapResult.status !== "applied" && bootstrapResult.status !== "duplicate") ||
      bootstrapResult.applied_snapshot_revision !== (
        body.snapshot_scope === "academic" ? body.cloud_revision : body.schedule_revision
      )
    ) {
      writePullError(store.db, institutionId, attemptAt, "cloud_pull_snapshot_not_acknowledged");
      return { status: "retryable" as const, error: "cloud_pull_snapshot_not_acknowledged" };
    }
    writePullSuccess(store.db, institutionId, attemptAt, body.cloud_revision);
    return {
      status: "applied" as const,
      institution_id: institutionId,
      cloud_revision: body.cloud_revision,
      bootstrap_status: bootstrapResult.status,
    };
  } catch (error) {
    if (input.localInstitutionId) {
      writePullError(store.db, input.localInstitutionId, attemptAt, error);
    }
    return {
      status: "retryable" as const,
      error: safeError(error instanceof Error ? error.message : error, "cloud_pull_network_failed"),
    };
  }
}



export type RequeueTimetableReplacementChainResult = {
  institution_id: string;
  institution_code: string;
  root_operation_id: string;
  previous_timetable_id: string;
  replacement_timetable_id: string;
  requeued_operation_ids: string[];
};

function isoWeekdayFromDateText(value: unknown) {
  const sessionDate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    throw new Error("session_date_invalid");
  }
  const parsed = new Date(`${sessionDate}T12:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== sessionDate
  ) {
    throw new Error("session_date_invalid");
  }
  const weekday = parsed.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function requeueTimetableReplacementChain(
  db: RelayDatabase,
  input: {
    institutionCode: string;
    rootOperationId: string;
    expectedError?: string;
    now?: Date;
  },
): RequeueTimetableReplacementChainResult {
  const institutionCode = String(input.institutionCode || "").trim().toUpperCase();
  const rootOperationId = String(input.rootOperationId || "").trim();
  const expectedError = String(input.expectedError || "timetable_not_found").trim();
  if (!institutionCode) throw new Error("institution_code_required");
  if (!rootOperationId) throw new Error("root_operation_id_required");
  if (expectedError !== "timetable_not_found") {
    throw new Error("expected_error_not_supported");
  }

  const institution = db.prepare(`
    SELECT id, code FROM institutions
    WHERE UPPER(COALESCE(code, '')) = ?
      AND deleted_at IS NULL
    LIMIT 1
  `).get(institutionCode) as { id: string; code: string } | undefined;
  if (!institution) throw new Error("institution_not_configured");

  const root = db.prepare(`
    SELECT operation_id, institution_id, entity_type, entity_id, state,
           last_status, last_error, payload_json
    FROM sync_outbox
    WHERE institution_id = ? AND operation_id = ?
  `).get(
    institution.id,
    rootOperationId,
  ) as {
    operation_id: string;
    institution_id: string;
    entity_type: string;
    entity_id: string;
    state: string;
    last_status: number | null;
    last_error: string | null;
    payload_json: string | null;
  } | undefined;
  if (!root) throw new Error("root_operation_not_found");
  if (
    root.entity_type !== "teacher_session" ||
    root.state !== "blocked" ||
    root.last_status !== 422 ||
    root.last_error !== expectedError
  ) {
    throw new Error("root_operation_not_requeueable");
  }

  const payload = parseStoredJson<Record<string, unknown>>(root.payload_json);
  if (String(payload?.operation_type || "").trim() !== "teacher_session.open") {
    throw new Error("root_operation_type_invalid");
  }
  const required = (key: string) => {
    const value = String(payload?.[key] || "").trim();
    if (!value) throw new Error(`${key}_required`);
    return value;
  };
  const previousTimetableId = required("timetable_id");
  const classId = required("class_id");
  const subjectId = required("subject_id");
  const teacherId = required("teacher_id");
  const periodId = required("period_id");
  const weekday = isoWeekdayFromDateText(payload?.session_date);

  const previous = db.prepare(`
    SELECT id, deleted_at
    FROM teacher_timetables
    WHERE institution_id = ? AND id = ?
  `).get(
    institution.id,
    previousTimetableId,
  ) as { id: string; deleted_at: string | null } | undefined;
  if (!previous || !previous.deleted_at) {
    throw new Error("previous_timetable_not_retired");
  }

  const candidates = db.prepare(`
    SELECT id
    FROM teacher_timetables
    WHERE institution_id = ?
      AND class_id = ?
      AND subject_id = ?
      AND teacher_id = ?
      AND period_id = ?
      AND weekday = ?
      AND deleted_at IS NULL
    ORDER BY id
    LIMIT 2
  `).all(
    institution.id,
    classId,
    subjectId,
    teacherId,
    periodId,
    weekday,
  ) as Array<{ id: string }>;
  if (candidates.length === 0) throw new Error("replacement_timetable_not_found");
  if (candidates.length > 1) throw new Error("replacement_timetable_ambiguous");
  const replacementTimetableId = candidates[0]!.id;
  if (replacementTimetableId === previousTimetableId) {
    throw new Error("replacement_timetable_invalid");
  }

  const descendants = db.prepare(`
    WITH RECURSIVE descendants(operation_id) AS (
      SELECT dependency.operation_id
      FROM sync_outbox_dependencies dependency
      WHERE dependency.institution_id = ?
        AND dependency.depends_on_operation_id = ?
      UNION
      SELECT dependency.operation_id
      FROM sync_outbox_dependencies dependency
      JOIN descendants parent
        ON parent.operation_id = dependency.depends_on_operation_id
      WHERE dependency.institution_id = ?
    )
    SELECT operation_id FROM descendants ORDER BY operation_id
  `).all(
    institution.id,
    rootOperationId,
    institution.id,
  ) as Array<{ operation_id: string }>;

  const operationIds = [
    rootOperationId,
    ...descendants.map((row) => row.operation_id),
  ];
  const placeholders = operationIds.map(() => "?").join(",");
  const chain = db.prepare(`
    SELECT operation_id, state, last_status, last_error
    FROM sync_outbox
    WHERE institution_id = ?
      AND operation_id IN (${placeholders})
    ORDER BY operation_id
  `).all(
    institution.id,
    ...operationIds,
  ) as Array<{
    operation_id: string;
    state: string;
    last_status: number | null;
    last_error: string | null;
  }>;
  if (chain.length !== operationIds.length) {
    throw new Error("blocked_chain_incomplete");
  }
  for (const row of chain) {
    if (row.operation_id === rootOperationId) continue;
    if (
      row.state !== "blocked" ||
      row.last_status !== 424 ||
      !String(row.last_error || "").startsWith(
        `dependency_blocked:${rootOperationId}:${expectedError}`,
      )
    ) {
      throw new Error(`dependent_operation_not_requeueable:${row.operation_id}`);
    }
  }

  const nowIso = (input.now || new Date()).toISOString();
  db.transaction(() => {
    const updateOutbox = db.prepare(`
      UPDATE sync_outbox
      SET state = 'pending',
          next_attempt_at = NULL,
          last_attempt_at = NULL,
          last_status = NULL,
          last_error = NULL
      WHERE institution_id = ? AND operation_id = ? AND state = 'blocked'
    `);
    for (const operationId of operationIds) {
      const changed = updateOutbox.run(institution.id, operationId);
      if (changed.changes !== 1) {
        throw new Error(`operation_requeue_failed:${operationId}`);
      }
    }

    db.prepare(`
      UPDATE teacher_session_open_operations
      SET state = 'opened_on_relay', updated_at = ?
      WHERE institution_id = ? AND operation_id IN (${placeholders})
        AND state = 'blocked'
    `).run(nowIso, institution.id, ...operationIds);

    db.prepare(`
      UPDATE teacher_attendance_operations
      SET state = 'secured_on_relay', last_error = NULL, updated_at = ?
      WHERE institution_id = ? AND operation_id IN (${placeholders})
        AND state = 'blocked'
    `).run(nowIso, institution.id, ...operationIds);

    db.prepare(`
      UPDATE teacher_session_transition_operations
      SET state = 'transitioned_on_relay', updated_at = ?
      WHERE institution_id = ?
        AND state = 'blocked'
        AND (
          close_operation_id IN (${placeholders})
          OR open_operation_id IN (${placeholders})
        )
    `).run(
      nowIso,
      institution.id,
      ...operationIds,
      ...operationIds,
    );

    db.prepare(`
      INSERT INTO audit_log(
        institution_id, actor_profile_id, device_id, event_type,
        entity_type, entity_id, details_json, occurred_at
      ) VALUES (?, NULL, 'relay-maintenance',
                'sync.blocked_chain_requeued',
                'teacher_session', ?, ?, ?)
    `).run(
      institution.id,
      root.entity_id,
      canonicalJson({
        root_operation_id: rootOperationId,
        previous_timetable_id: previousTimetableId,
        replacement_timetable_id: replacementTimetableId,
        operation_ids: operationIds,
        expected_error: expectedError,
      }),
      nowIso,
    );
  })();

  return {
    institution_id: institution.id,
    institution_code: institution.code,
    root_operation_id: rootOperationId,
    previous_timetable_id: previousTimetableId,
    replacement_timetable_id: replacementTimetableId,
    requeued_operation_ids: operationIds,
  };
}

export async function syncRelayOnce(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions = {},
): Promise<RelayCloudSyncRunResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => new Date());
  const result: RelayCloudSyncRunResult = {
    configured_institutions: 0,
    attempted_institutions: 0,
    claimed_operations: 0,
    acknowledged_operations: 0,
    retryable_operations: 0,
    blocked_operations: 0,
    conflict_operations: 0,
    pull_attempted_institutions: 0,
    pull_not_modified: 0,
    pull_snapshots_applied: 0,
    pull_retryable_institutions: 0,
    skipped_institutions: [],
  };

  for (const institution of config.institutions || []) {
    const cloud = configuredCloudSync(institution);
    if (!cloud) continue;
    result.configured_institutions += 1;

    let institutionId = institutionIdForCode(store.db, institution.code);
    if (institutionId) {
      const operations = claimBatch(
        store.db,
        institutionId,
        config.cloudSyncBatchSize || 25,
        now(),
      );
      if (operations.length) {
        result.attempted_institutions += 1;
        result.claimed_operations += operations.length;
        const attemptAt = now();
        try {
          const response = await fetchImpl(cloud.endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cloud.token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "X-MonCahier-Relay-Device": cloud.deviceId,
            },
            body: JSON.stringify({
              protocol_version: SYNC_PROTOCOL_VERSION,
              institution_id: institutionId,
              device_id: cloud.deviceId,
              sent_at: attemptAt.toISOString(),
              operations: operations.map((operation) => wireOperation(store.db, operation)),
            }),
            signal: AbortSignal.timeout(config.cloudSyncTimeoutMs || 20_000),
          });
          const body = await response.json().catch(() => null) as unknown;
          if (!response.ok) {
            const error = safeError(
              (body as Record<string, unknown> | null)?.error,
              `cloud_http_${response.status}`,
            );
            retryOperations(
              store.db,
              institutionId,
              operations,
              attemptAt,
              error,
              response.status,
            );
            result.retryable_operations += operations.length;
          } else if (!isCloudPushResponse(body, institutionId, cloud.deviceId)) {
            retryOperations(
              store.db,
              institutionId,
              operations,
              attemptAt,
              "cloud_response_invalid",
              response.status,
            );
            result.retryable_operations += operations.length;
          } else {
            const counters = applyAcknowledgements(
              store.db,
              institutionId,
              operations,
              body.acknowledgements,
              attemptAt,
            );
            result.acknowledged_operations += counters.acknowledged;
            result.retryable_operations += counters.retryable;
            result.blocked_operations += counters.blocked;
            result.conflict_operations += counters.conflict;
            writePushSuccess(store.db, institutionId, attemptAt);
          }
        } catch (error) {
          retryOperations(
            store.db,
            institutionId,
            operations,
            attemptAt,
            error instanceof Error ? error.message : "cloud_sync_network_failed",
            null,
          );
          result.retryable_operations += operations.length;
        }
      }
    }

    const pull = await pullInstitutionSnapshot(config, store, {
      institution,
      localInstitutionId: institutionId,
      cloud,
      fetchImpl,
      now,
    });
    if (pull.status === "skipped") {
      if (!institutionId) {
        result.skipped_institutions.push({
          code: institution.code,
          reason: pull.reason,
        });
      }
      continue;
    }

    result.pull_attempted_institutions += 1;
    if (pull.status === "retryable") {
      result.pull_retryable_institutions += 1;
      if (!institutionId) {
        result.skipped_institutions.push({
          code: institution.code,
          reason: pull.error,
        });
      }
      continue;
    }
    if (pull.status === "not_modified") {
      result.pull_not_modified += 1;
      continue;
    }

    result.pull_snapshots_applied += 1;
    institutionId = pull.institution_id;
  }
  return result;
}

export function createRelayCloudSyncAgent(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions = {},
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncRelayOnce(config, store, options);
    } catch {
      // Chaque opération reste dans SQLite et sera reprise au passage suivant.
    } finally {
      running = false;
    }
  };
  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), config.cloudSyncIntervalMs || 15_000);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    runOnce: tick,
  };
}

import { createHash, randomUUID } from "node:crypto";
import type { RelayConfig, RelayInstitutionConfig } from "./config.mjs";
import { canonicalJson, parseStoredJson } from "./json.mjs";
import type { RelayStore } from "./store.mjs";
import {
  syncRelayOnce as syncRelayOnceLegacy,
  type RelayCloudSyncRunResult,
} from "./cloud-sync.mjs";

const SYNC_PROTOCOL_VERSION = 1 as const;
const STALE_SENDING_AFTER_MS = 5 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;

type SyncOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type ClaimedGradeOperation = {
  operation_id: string;
  institution_id: string;
  device_id: string;
  actor_profile_id: string | null;
  entity_type: "student_grade";
  entity_id: string;
  action: "upsert" | "delete";
  base_server_version: number;
  payload_json: string | null;
  occurred_at: string;
  protocol_version: number;
  attempts: number;
};

type GradeConflictState = {
  server_version: number;
  action: "upsert" | "delete";
  payload: Record<string, unknown> | null;
};

type GradeAcknowledgement = {
  operation_id: string;
  status: "acknowledged" | "retryable" | "blocked" | "conflict";
  http_status?: number | null;
  error?: string | null;
  cloud_entity_id?: string | null;
  cloud_server_version?: number | null;
  conflict?: GradeConflictState | null;
};

type GradePushResponse = {
  protocol_version: 1;
  institution_id: string;
  device_id: string;
  server_time: string;
  acknowledgements: GradeAcknowledgement[];
};

type GradePushCounters = {
  attempted_institutions: number;
  claimed_operations: number;
  acknowledged_operations: number;
  retryable_operations: number;
  blocked_operations: number;
  conflict_operations: number;
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
  return { endpoint, deviceId, token };
}

function institutionIdForCode(store: RelayStore, code: string) {
  const row = store.db.prepare(`
    SELECT id FROM institutions
    WHERE UPPER(COALESCE(code, '')) = UPPER(?) AND deleted_at IS NULL
    LIMIT 1
  `).get(code) as { id: string } | undefined;
  return row?.id || null;
}

function claimGradeBatch(
  store: RelayStore,
  institutionId: string,
  limit: number,
  now: Date,
) {
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_SENDING_AFTER_MS).toISOString();
  return store.db.transaction(() => {
    store.db.prepare(`
      UPDATE sync_outbox
      SET state = 'pending', next_attempt_at = ?, last_error = 'stale_sending_recovered'
      WHERE institution_id = ? AND entity_type = 'student_grade' AND state = 'sending'
        AND (last_attempt_at IS NULL OR last_attempt_at <= ?)
    `).run(nowIso, institutionId, staleBefore);

    const rows = store.db.prepare(`
      SELECT child.operation_id, child.institution_id, child.device_id,
             child.actor_profile_id, child.entity_type, child.entity_id,
             child.action, child.base_server_version, child.payload_json,
             child.occurred_at, child.protocol_version, child.attempts
      FROM sync_outbox child
      WHERE child.institution_id = ?
        AND child.entity_type = 'student_grade'
        AND child.state = 'pending'
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
    `).all(institutionId, nowIso, limit) as ClaimedGradeOperation[];

    const markSending = store.db.prepare(`
      UPDATE sync_outbox
      SET state = 'sending', attempts = attempts + 1,
          last_attempt_at = ?, next_attempt_at = NULL,
          last_status = NULL, last_error = NULL
      WHERE institution_id = ? AND operation_id = ?
        AND entity_type = 'student_grade' AND state = 'pending'
    `);
    const claimed: ClaimedGradeOperation[] = [];
    for (const row of rows) {
      const changed = markSending.run(nowIso, institutionId, row.operation_id);
      if (changed.changes === 1) claimed.push({ ...row, attempts: row.attempts + 1 });
    }
    return claimed;
  })();
}

function wireGradeOperation(row: ClaimedGradeOperation) {
  const wire = {
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: row.operation_id,
    actor_profile_id: row.actor_profile_id,
    origin_device_id: row.device_id,
    entity_type: "student_grade" as const,
    entity_id: row.entity_id,
    action: row.action,
    base_server_version: row.base_server_version,
    occurred_at: row.occurred_at,
    payload: parseStoredJson<Record<string, unknown>>(row.payload_json),
  };
  return {
    ...wire,
    payload_fingerprint: createHash("sha256").update(canonicalJson(wire)).digest("hex"),
  };
}

function validVersion(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validConflict(value: unknown): value is GradeConflictState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const version = validVersion(row.server_version);
  const action = row.action;
  return version !== null &&
    (action === "upsert" || action === "delete") &&
    (row.payload === null || (
      typeof row.payload === "object" && !Array.isArray(row.payload)
    ));
}

function isGradePushResponse(
  value: unknown,
  institutionId: string,
  deviceId: string,
): value is GradePushResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const allowed = new Set(["acknowledged", "retryable", "blocked", "conflict"]);
  return row.protocol_version === SYNC_PROTOCOL_VERSION &&
    row.institution_id === institutionId &&
    row.device_id === deviceId &&
    Number.isFinite(Date.parse(String(row.server_time || ""))) &&
    Array.isArray(row.acknowledgements) &&
    row.acknowledgements.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const ack = item as Record<string, unknown>;
      return typeof ack.operation_id === "string" && ack.operation_id.trim().length > 0 &&
        typeof ack.status === "string" && allowed.has(ack.status);
    });
}

function retryGradeOperations(
  store: RelayStore,
  institutionId: string,
  operations: ClaimedGradeOperation[],
  now: Date,
  error: string,
  status: number | null,
) {
  const update = store.db.prepare(`
    UPDATE sync_outbox
    SET state = 'pending', next_attempt_at = ?, last_status = ?, last_error = ?
    WHERE institution_id = ? AND operation_id = ?
      AND entity_type = 'student_grade' AND state = 'sending'
  `);
  store.db.transaction(() => {
    for (const operation of operations) {
      update.run(
        nextAttemptAt(now, operation.attempts),
        status,
        safeError(error, "cloud_sync_failed"),
        institutionId,
        operation.operation_id,
      );
    }
  })();
}

function acknowledgeGrade(
  store: RelayStore,
  operation: ClaimedGradeOperation,
  acknowledgement: GradeAcknowledgement,
  nowIso: string,
) {
  const serverVersion = validVersion(acknowledgement.cloud_server_version);
  if (serverVersion === null || serverVersion <= operation.base_server_version) {
    store.db.prepare(`
      UPDATE sync_outbox
      SET state = 'pending', next_attempt_at = ?, last_status = 503,
          last_error = 'student_grade_ack_version_invalid'
      WHERE institution_id = ? AND operation_id = ? AND state = 'sending'
    `).run(
      new Date(Date.parse(nowIso) + 30_000).toISOString(),
      operation.institution_id,
      operation.operation_id,
    );
    return "retryable" as const;
  }

  store.db.transaction(() => {
    store.db.prepare(`
      UPDATE student_grades
      SET server_version = ?
      WHERE institution_id = ? AND id = ?
    `).run(serverVersion, operation.institution_id, operation.entity_id);
    store.db.prepare(`
      UPDATE sync_records
      SET server_version = ?, local_dirty = 0, updated_at = ?
      WHERE institution_id = ? AND entity_type = 'student_grade' AND entity_id = ?
    `).run(serverVersion, nowIso, operation.institution_id, operation.entity_id);
    store.db.prepare(`
      DELETE FROM sync_outbox
      WHERE institution_id = ? AND operation_id = ? AND entity_type = 'student_grade'
    `).run(operation.institution_id, operation.operation_id);
    store.db.prepare(`
      INSERT INTO audit_log(
        institution_id, actor_profile_id, device_id, event_type,
        entity_type, entity_id, details_json, occurred_at
      ) VALUES (?, ?, ?, 'sync.grade_operation_acknowledged', 'student_grade', ?, ?, ?)
    `).run(
      operation.institution_id,
      operation.actor_profile_id,
      operation.device_id,
      operation.entity_id,
      canonicalJson({
        operation_id: operation.operation_id,
        cloud_entity_id: acknowledgement.cloud_entity_id || operation.entity_id,
        cloud_server_version: serverVersion,
      }),
      nowIso,
    );
  })();
  return "acknowledged" as const;
}

function applyGradeConflict(
  store: RelayStore,
  operation: ClaimedGradeOperation,
  acknowledgement: GradeAcknowledgement,
  serverTime: string,
) {
  if (!validConflict(acknowledgement.conflict)) return null;
  const conflict = acknowledgement.conflict;
  if (conflict.server_version <= operation.base_server_version) return null;

  const result = store.applyRemote({
    protocol_version: SYNC_PROTOCOL_VERSION,
    event_id: `grade-cas:${operation.operation_id}:${conflict.server_version}`,
    institution_id: operation.institution_id,
    entity_type: "student_grade",
    entity_id: operation.entity_id,
    action: conflict.action,
    server_version: conflict.server_version,
    occurred_at: serverTime,
    caused_by_operation_id: null,
    payload: conflict.payload,
  });

  if (result.status === "conflict") {
    store.db.prepare(`
      UPDATE sync_outbox SET last_status = 409
      WHERE institution_id = ? AND operation_id = ?
    `).run(operation.institution_id, operation.operation_id);
    return "conflict" as const;
  }
  if (result.status === "applied" || result.status === "duplicate") {
    return "acknowledged" as const;
  }
  return null;
}

function applyGradeAcknowledgements(
  store: RelayStore,
  institutionId: string,
  operations: ClaimedGradeOperation[],
  body: GradePushResponse,
  now: Date,
) {
  const counters = { acknowledged: 0, retryable: 0, blocked: 0, conflict: 0 };
  const byId = new Map(body.acknowledgements.map((ack) => [ack.operation_id, ack]));
  const nowIso = now.toISOString();

  for (const operation of operations) {
    const ack = byId.get(operation.operation_id);
    if (!ack) {
      retryGradeOperations(store, institutionId, [operation], now, "cloud_ack_missing", null);
      counters.retryable += 1;
      continue;
    }
    if (ack.status === "acknowledged") {
      const outcome = acknowledgeGrade(store, operation, ack, nowIso);
      counters[outcome] += 1;
      continue;
    }
    if (ack.status === "retryable") {
      retryGradeOperations(
        store,
        institutionId,
        [operation],
        now,
        safeError(ack.error, "cloud_retryable"),
        Number.isInteger(ack.http_status) ? Number(ack.http_status) : null,
      );
      counters.retryable += 1;
      continue;
    }
    if (ack.status === "conflict") {
      const conflictOutcome = applyGradeConflict(store, operation, ack, body.server_time);
      if (conflictOutcome === "conflict") {
        counters.conflict += 1;
        continue;
      }
      if (conflictOutcome === "acknowledged") {
        counters.acknowledged += 1;
        continue;
      }
    }

    store.db.prepare(`
      UPDATE sync_outbox
      SET state = 'blocked', next_attempt_at = NULL, last_status = ?, last_error = ?
      WHERE institution_id = ? AND operation_id = ? AND entity_type = 'student_grade'
    `).run(
      Number.isInteger(ack.http_status) ? Number(ack.http_status) : null,
      safeError(
        ack.status === "conflict" && !validConflict(ack.conflict)
          ? "student_grade_conflict_details_missing"
          : ack.error,
        `cloud_${ack.status}`,
      ),
      institutionId,
      operation.operation_id,
    );
    if (ack.status === "conflict") counters.conflict += 1;
    else counters.blocked += 1;
  }
  return counters;
}

async function pushStudentGrades(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions,
): Promise<GradePushCounters> {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => new Date());
  const counters: GradePushCounters = {
    attempted_institutions: 0,
    claimed_operations: 0,
    acknowledged_operations: 0,
    retryable_operations: 0,
    blocked_operations: 0,
    conflict_operations: 0,
  };

  for (const institution of config.institutions || []) {
    const cloud = configuredCloudSync(institution);
    if (!cloud) continue;
    const institutionId = institutionIdForCode(store, institution.code);
    if (!institutionId) continue;

    let attemptedForInstitution = false;
    for (let batchIndex = 0; batchIndex < 20; batchIndex += 1) {
      const attemptAt = now();
      const operations = claimGradeBatch(
        store,
        institutionId,
        config.cloudSyncBatchSize || 25,
        attemptAt,
      );
      if (!operations.length) break;
      if (!attemptedForInstitution) {
        counters.attempted_institutions += 1;
        attemptedForInstitution = true;
      }
      counters.claimed_operations += operations.length;

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
            operations: operations.map(wireGradeOperation),
          }),
          signal: AbortSignal.timeout(config.cloudSyncTimeoutMs || 20_000),
        });
        const body = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          retryGradeOperations(
            store,
            institutionId,
            operations,
            attemptAt,
            safeError(
              (body as Record<string, unknown> | null)?.error,
              `cloud_http_${response.status}`,
            ),
            response.status,
          );
          counters.retryable_operations += operations.length;
          continue;
        }
        if (!isGradePushResponse(body, institutionId, cloud.deviceId)) {
          retryGradeOperations(
            store,
            institutionId,
            operations,
            attemptAt,
            "cloud_grade_response_invalid",
            response.status,
          );
          counters.retryable_operations += operations.length;
          continue;
        }
        const applied = applyGradeAcknowledgements(
          store,
          institutionId,
          operations,
          body,
          attemptAt,
        );
        counters.acknowledged_operations += applied.acknowledged;
        counters.retryable_operations += applied.retryable;
        counters.blocked_operations += applied.blocked;
        counters.conflict_operations += applied.conflict;
      } catch (error) {
        retryGradeOperations(
          store,
          institutionId,
          operations,
          attemptAt,
          error instanceof Error ? error.message : "cloud_grade_sync_network_failed",
          null,
        );
        counters.retryable_operations += operations.length;
      }
    }
  }
  return counters;
}

function mergeResults(
  legacy: RelayCloudSyncRunResult,
  grade: GradePushCounters,
): RelayCloudSyncRunResult {
  return {
    ...legacy,
    attempted_institutions: legacy.attempted_institutions + grade.attempted_institutions,
    claimed_operations: legacy.claimed_operations + grade.claimed_operations,
    acknowledged_operations: legacy.acknowledged_operations + grade.acknowledged_operations,
    retryable_operations: legacy.retryable_operations + grade.retryable_operations,
    blocked_operations: legacy.blocked_operations + grade.blocked_operations,
    conflict_operations: legacy.conflict_operations + grade.conflict_operations,
  };
}

export async function syncRelayOnce(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions = {},
): Promise<RelayCloudSyncRunResult> {
  const grade = await pushStudentGrades(config, store, options);
  const legacy = await syncRelayOnceLegacy(config, store, options);
  return mergeResults(legacy, grade);
}

export function createRelayCloudSyncAgent(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions = {},
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentRun: Promise<void> | null = null;
  const tick = () => {
    if (currentRun) return currentRun;
    const run = syncRelayOnce(config, store, options)
      .then(() => undefined)
      .catch(() => {
        // Les opérations restent dans SQLite et seront reprises au passage suivant.
      })
      .finally(() => {
        if (currentRun === run) currentRun = null;
      });
    currentRun = run;
    return run;
  };
  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), config.cloudSyncIntervalMs || 15_000);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await currentRun;
    },
    runOnce: tick,
  };
}

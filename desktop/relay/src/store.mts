import { randomUUID } from "node:crypto";
import { applyBootstrap, type BootstrapResult } from "./bootstrap.mjs";
import type { RelayDatabase } from "./db.mjs";
import {
  getInstitutionMeta,
  latestInstitutionMeta,
  schemaVersion,
  setInstitutionMeta,
} from "./db.mjs";
import { materializeTracked, retryMaterializationFailures } from "./entity-materializer.mjs";
import { canonicalJson, parseStoredJson } from "./json.mjs";
import type {
  ApplyRemoteResult,
  EnqueueResult,
  RelayStatus,
  RemoteEvent,
  SyncEntityType,
  SyncOperation,
} from "./types.mjs";
import { parseRemoteEvent, parseSyncOperation } from "./validation.mjs";

type OutboxComparable = {
  institution_id: string;
  device_id: string;
  actor_profile_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  base_server_version: number;
  payload_json: string | null;
  occurred_at: string;
};

export class RelayStore {
  constructor(readonly db: RelayDatabase) {}

  ensureInstitution(id: string, name: string, now = new Date().toISOString()) {
    const institutionId = id.trim();
    const institutionName = name.trim();
    if (!institutionId) throw new Error("institution_id_required");
    if (!institutionName) throw new Error("institution_name_required");
    this.db.prepare(`
      INSERT INTO institutions(id, name, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
    `).run(institutionId, institutionName, now);
  }

  getOrCreateRelayDevice(institutionId: string) {
    const existing = getInstitutionMeta(this.db, institutionId, "relay_device_id");
    if (existing) {
      const belongsToInstitution = this.db.prepare(`
        SELECT 1 FROM relay_devices WHERE institution_id = ? AND id = ?
      `).get(institutionId, existing);
      if (belongsToInstitution) return existing;
    }
    const deviceId = randomUUID();
    const now = new Date().toISOString();
    const create = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO relay_devices(id, institution_id, label, kind, paired_at, last_seen_at)
        VALUES (?, ?, 'Relais principal', 'relay', ?, ?)
      `).run(deviceId, institutionId, now, now);
      setInstitutionMeta(this.db, institutionId, "relay_device_id", deviceId);
    });
    create();
    return deviceId;
  }

  enqueue(raw: unknown): EnqueueResult {
    const operation = parseSyncOperation(raw);
    this.assertInstitution(operation.institution_id);
    const payloadJson = operation.payload === null ? null : canonicalJson(operation.payload);

    return this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM sync_outbox WHERE institution_id = ? AND operation_id = ?")
        .get(operation.institution_id, operation.operation_id) as OutboxComparable | undefined;
      if (existing) {
        if (!sameOperation(existing, operation, payloadJson)) {
          throw new Error("operation_id_reused_with_different_payload");
        }
        return { operation_id: operation.operation_id, inserted: false };
      }

      this.db.prepare(`
        INSERT INTO sync_outbox(
          operation_id, institution_id, device_id, actor_profile_id, entity_type,
          entity_id, action, base_server_version, payload_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        operation.operation_id,
        operation.institution_id,
        operation.device_id,
        operation.actor_profile_id ?? null,
        operation.entity_type,
        operation.entity_id,
        operation.action,
        operation.base_server_version,
        payloadJson,
        operation.occurred_at,
      );

      this.db.prepare(`
        INSERT INTO sync_records(
          institution_id, entity_type, entity_id, payload_json, server_version,
          local_dirty, deleted_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(institution_id, entity_type, entity_id) DO UPDATE SET
          payload_json = excluded.payload_json,
          local_dirty = 1,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
      `).run(
        operation.institution_id,
        operation.entity_type,
        operation.entity_id,
        payloadJson,
        operation.base_server_version,
        operation.action === "delete" ? operation.occurred_at : null,
        operation.occurred_at,
      );
      materializeTracked(this.db, {
        institutionId: operation.institution_id,
        entityType: operation.entity_type,
        entityId: operation.entity_id,
        action: operation.action,
        payload: operation.payload,
        serverVersion: operation.base_server_version,
        occurredAt: operation.occurred_at,
      });
      retryMaterializationFailures(this.db, operation.institution_id);
      this.audit(operation.institution_id, "sync.operation_enqueued", operation);
      return { operation_id: operation.operation_id, inserted: true };
    })();
  }

  applyRemote(raw: unknown): ApplyRemoteResult {
    const event = parseRemoteEvent(raw);
    this.assertInstitution(event.institution_id);

    return this.db.transaction(() => {
      const received = this.db
        .prepare("SELECT 1 FROM sync_inbox WHERE institution_id = ? AND event_id = ?")
        .get(event.institution_id, event.event_id);
      if (received) return { event_id: event.event_id, status: "duplicate" } as const;

      const pending = this.db.prepare(`
        SELECT operation_id, base_server_version, payload_json
        FROM sync_outbox
        WHERE institution_id = ? AND entity_type = ? AND entity_id = ?
          AND state IN ('pending', 'sending', 'blocked')
        ORDER BY occurred_at DESC
        LIMIT 1
      `).get(event.institution_id, event.entity_type, event.entity_id) as
        | { operation_id: string; base_server_version: number; payload_json: string | null }
        | undefined;

      const remotePayload = event.payload === null ? null : canonicalJson(event.payload);
      if (pending && event.server_version > pending.base_server_version) {
        // Réponse réseau perdue : si le serveur renvoie exactement l'état local,
        // l'événement constitue l'accusé de réception et non un conflit.
        const acknowledged =
          event.caused_by_operation_id === pending.operation_id ||
          pending.payload_json === remotePayload;
        if (acknowledged) {
          this.db.prepare(`
            DELETE FROM sync_outbox
            WHERE institution_id = ? AND entity_type = ? AND entity_id = ?
          `).run(event.institution_id, event.entity_type, event.entity_id);
        } else {
          const conflictId = randomUUID();
          this.db.prepare(`
            INSERT INTO sync_conflicts(
              id, institution_id, event_id, operation_id, entity_type, entity_id,
              remote_action, local_payload_json, remote_payload_json, local_base_version,
              remote_server_version, reason, detected_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remote_changed_while_local_pending', ?)
          `).run(
            conflictId,
            event.institution_id,
            event.event_id,
            pending.operation_id,
            event.entity_type,
            event.entity_id,
            event.action,
            pending.payload_json,
            remotePayload,
            pending.base_server_version,
            event.server_version,
            new Date().toISOString(),
          );
          this.db.prepare(
            `UPDATE sync_outbox SET state = 'blocked', last_error = ?
             WHERE institution_id = ? AND operation_id = ?`,
          ).run(`sync_conflict:${conflictId}`, event.institution_id, pending.operation_id);
          this.recordInbox(event, remotePayload);
          this.audit(event.institution_id, "sync.conflict_detected", event, conflictId);
          return { event_id: event.event_id, status: "conflict", conflict_id: conflictId } as const;
        }
      }

      const current = this.db.prepare(`
        SELECT server_version FROM sync_records
        WHERE institution_id = ? AND entity_type = ? AND entity_id = ?
      `).get(event.institution_id, event.entity_type, event.entity_id) as
        | { server_version: number }
        | undefined;

      if (!current || event.server_version >= current.server_version) {
        this.db.prepare(`
          INSERT INTO sync_records(
            institution_id, entity_type, entity_id, payload_json, server_version,
            local_dirty, deleted_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(institution_id, entity_type, entity_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            server_version = excluded.server_version,
            local_dirty = 0,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).run(
          event.institution_id,
          event.entity_type,
          event.entity_id,
          remotePayload,
          event.server_version,
          event.action === "delete" ? event.occurred_at : null,
          event.occurred_at,
        );
        materializeTracked(this.db, {
          institutionId: event.institution_id,
          entityType: event.entity_type,
          entityId: event.entity_id,
          action: event.action,
          payload: event.payload,
          serverVersion: event.server_version,
          occurredAt: event.occurred_at,
        });
      }

      retryMaterializationFailures(this.db, event.institution_id);
      this.recordInbox(event, remotePayload);
      this.audit(event.institution_id, "sync.remote_event_applied", event);
      return { event_id: event.event_id, status: "applied" } as const;
    })();
  }

  resolveConflict(
    institutionId: string,
    conflictId: string,
    resolution: "accept_remote" | "keep_local",
    resolvedBy: string,
  ) {
    return this.db.transaction(() => {
      const conflict = this.db.prepare(`
        SELECT * FROM sync_conflicts
        WHERE institution_id = ? AND id = ? AND resolved_at IS NULL
      `).get(institutionId, conflictId) as
        | {
            institution_id: string;
            operation_id: string | null;
            entity_type: string;
            entity_id: string;
            remote_action: "upsert" | "delete";
            remote_payload_json: string | null;
            remote_server_version: number;
          }
        | undefined;
      if (!conflict) throw new Error("conflict_not_found_or_already_resolved");
      const now = new Date().toISOString();

      if (resolution === "accept_remote") {
        this.db.prepare(`
          INSERT INTO sync_records(
            institution_id, entity_type, entity_id, payload_json, server_version,
            local_dirty, deleted_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(institution_id, entity_type, entity_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            server_version = excluded.server_version,
            local_dirty = 0,
            deleted_at = excluded.deleted_at,
            updated_at = excluded.updated_at
        `).run(
          conflict.institution_id,
          conflict.entity_type,
          conflict.entity_id,
          conflict.remote_payload_json,
          conflict.remote_server_version,
          conflict.remote_action === "delete" ? now : null,
          now,
        );
        materializeTracked(this.db, {
          institutionId: conflict.institution_id,
          entityType: conflict.entity_type as SyncEntityType,
          entityId: conflict.entity_id,
          action: conflict.remote_action,
          payload: parseStoredJson<Record<string, unknown>>(conflict.remote_payload_json),
          serverVersion: conflict.remote_server_version,
          occurredAt: now,
        });
        if (conflict.operation_id) {
          this.db.prepare(`
            DELETE FROM sync_outbox WHERE institution_id = ? AND operation_id = ?
          `).run(conflict.institution_id, conflict.operation_id);
        }
      } else if (conflict.operation_id) {
        this.db.prepare(`
          UPDATE sync_outbox
          SET state = 'pending', base_server_version = ?, last_error = NULL
          WHERE institution_id = ? AND operation_id = ?
        `).run(conflict.remote_server_version, conflict.institution_id, conflict.operation_id);
      }

      retryMaterializationFailures(this.db, conflict.institution_id);
      this.db.prepare(`
        UPDATE sync_conflicts SET resolution = ?, resolved_at = ?, resolved_by = ?
        WHERE institution_id = ? AND id = ?
      `).run(resolution, now, resolvedBy, conflict.institution_id, conflictId);
      this.audit(conflict.institution_id, "sync.conflict_resolved", {
        conflict_id: conflictId,
        resolution,
      });
      return { conflict_id: conflictId, resolution };
    })();
  }

  bootstrap(raw: unknown): BootstrapResult {
    return applyBootstrap(this.db, raw);
  }

  status(): RelayStatus {
    const count = (sql: string) =>
      Number((this.db.prepare(sql).get() as { count: number }).count || 0);
    const institutions = this.db.prepare(`
      SELECT id, name, code
      FROM institutions
      WHERE deleted_at IS NULL
      ORDER BY name, id
    `).all() as Array<{ id: string; name: string; code: string | null }>;
    const scopedCount = (sql: string, institutionId: string) =>
      Number((this.db.prepare(sql).get(institutionId) as { count: number }).count || 0);
    return {
      ok: true,
      schema_version: schemaVersion(this.db),
      institution_count: count("SELECT COUNT(*) AS count FROM institutions WHERE deleted_at IS NULL"),
      pending_operations: count("SELECT COUNT(*) AS count FROM sync_outbox WHERE state IN ('pending', 'sending')"),
      blocked_operations: count("SELECT COUNT(*) AS count FROM sync_outbox WHERE state = 'blocked'"),
      unresolved_conflicts: count("SELECT COUNT(*) AS count FROM sync_conflicts WHERE resolved_at IS NULL"),
      materialization_failures: count("SELECT COUNT(*) AS count FROM sync_materialization_failures"),
      last_cloud_sync_at: latestInstitutionMeta(this.db, "last_cloud_sync_at"),
      institutions: institutions.map((institution) => ({
        institution_id: institution.id,
        name: institution.name,
        code: institution.code,
        last_cloud_sync_at: getInstitutionMeta(this.db, institution.id, "last_cloud_sync_at"),
        pending_operations: scopedCount(
          "SELECT COUNT(*) AS count FROM sync_outbox WHERE institution_id = ? AND state IN ('pending', 'sending')",
          institution.id,
        ),
        blocked_operations: scopedCount(
          "SELECT COUNT(*) AS count FROM sync_outbox WHERE institution_id = ? AND state = 'blocked'",
          institution.id,
        ),
        unresolved_conflicts: scopedCount(
          "SELECT COUNT(*) AS count FROM sync_conflicts WHERE institution_id = ? AND resolved_at IS NULL",
          institution.id,
        ),
        materialization_failures: scopedCount(
          "SELECT COUNT(*) AS count FROM sync_materialization_failures WHERE institution_id = ?",
          institution.id,
        ),
      })),
    };
  }

  listPending(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.db.prepare(`
      SELECT operation_id, institution_id, device_id, actor_profile_id, entity_type,
             entity_id, action, base_server_version, payload_json, occurred_at,
             state, attempts, last_status, last_error
      FROM sync_outbox
      WHERE state IN ('pending', 'sending')
      ORDER BY occurred_at, operation_id
      LIMIT ?
    `).all(safeLimit).map((row) => {
      const item = row as Record<string, unknown> & { payload_json: string | null };
      const { payload_json: stored, ...rest } = item;
      return { ...rest, payload: parseStoredJson(stored) };
    });
  }

  private assertInstitution(institutionId: string) {
    const row = this.db.prepare("SELECT 1 FROM institutions WHERE id = ? AND deleted_at IS NULL")
      .get(institutionId);
    if (!row) throw new Error("institution_not_initialized");
  }

  private recordInbox(event: RemoteEvent, payloadJson: string | null) {
    this.db.prepare(`
      INSERT INTO sync_inbox(
        event_id, institution_id, entity_type, entity_id, action, server_version,
        payload_json, occurred_at, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.event_id,
      event.institution_id,
      event.entity_type,
      event.entity_id,
      event.action,
      event.server_version,
      payloadJson,
      event.occurred_at,
      new Date().toISOString(),
    );
  }

  private audit(
    institutionId: string,
    eventType: string,
    details: unknown,
    entityId?: string,
  ) {
    this.db.prepare(`
      INSERT INTO audit_log(
        institution_id, event_type, entity_id, details_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(institutionId, eventType, entityId ?? null, canonicalJson(details), new Date().toISOString());
  }
}

function sameOperation(
  stored: OutboxComparable,
  operation: SyncOperation,
  payloadJson: string | null,
) {
  return (
    stored.institution_id === operation.institution_id &&
    stored.device_id === operation.device_id &&
    stored.actor_profile_id === (operation.actor_profile_id ?? null) &&
    stored.entity_type === operation.entity_type &&
    stored.entity_id === operation.entity_id &&
    stored.action === operation.action &&
    stored.base_server_version === operation.base_server_version &&
    stored.payload_json === payloadJson &&
    stored.occurred_at === operation.occurred_at
  );
}

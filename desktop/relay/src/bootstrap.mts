import type { RelayDatabase } from "./db.mjs";
import { setMeta } from "./db.mjs";
import { collectionSpec, ENTITY_SPECS, materializeEntity, retryMaterializationFailures } from "./entity-materializer.mjs";
import { canonicalJson } from "./json.mjs";
import { SYNC_PROTOCOL_VERSION, type SyncEntityType } from "./types.mjs";

export type BootstrapResult = {
  snapshot_id: string;
  institution_id: string;
  status: "applied" | "duplicate";
  imported_entities: number;
  preserved_local_entities: number;
  collections: Record<string, number>;
  completed_at: string;
};

type BootstrapSnapshot = {
  protocol_version: typeof SYNC_PROTOCOL_VERSION;
  snapshot_id: string;
  institution_id: string;
  generated_at: string;
  cursor: string | null;
  institution: Record<string, unknown>;
  entities: Record<string, Record<string, unknown>[]>;
};

const FORBIDDEN_COLLECTION = /finance|payment|receipt|cash|payroll|expense|budget|charge|debt/i;

export function applyBootstrap(db: RelayDatabase, raw: unknown): BootstrapResult {
  const snapshot = parseBootstrapSnapshot(raw);
  const existing = db.prepare(`
    SELECT completed_at, imported_entities, preserved_local_entities, collections_json
    FROM sync_bootstrap_runs
    WHERE snapshot_id = ? AND institution_id = ? AND status = 'completed'
  `).get(snapshot.snapshot_id, snapshot.institution_id) as
    | {
        completed_at: string;
        imported_entities: number;
        preserved_local_entities: number;
        collections_json: string;
      }
    | undefined;
  if (existing) {
    return {
      snapshot_id: snapshot.snapshot_id,
      institution_id: snapshot.institution_id,
      status: "duplicate",
      imported_entities: Number(existing.imported_entities || 0),
      preserved_local_entities: Number(existing.preserved_local_entities || 0),
      collections: JSON.parse(existing.collections_json) as Record<string, number>,
      completed_at: existing.completed_at,
    };
  }

  return db.transaction(() => {
    const startedAt = new Date().toISOString();
    let imported = 0;
    let preserved = 0;
    const collectionCounts: Record<string, number> = {};

    const institutionPayload = {
      ...snapshot.institution,
      id: snapshot.institution_id,
      name: requiredText(snapshot.institution.name, "institution_name"),
    };
    const institutionVersion = nonNegativeInteger(snapshot.institution.server_version ?? 0, "server_version");
    materializeEntity(db, {
      institutionId: snapshot.institution_id,
      entityType: "institution",
      entityId: snapshot.institution_id,
      action: "upsert",
      payload: institutionPayload,
      serverVersion: institutionVersion,
      occurredAt: snapshot.generated_at,
    });
    writeSyncRecord(
      db,
      snapshot.institution_id,
      "institution",
      snapshot.institution_id,
      institutionPayload,
      institutionVersion,
      snapshot.generated_at,
    );
    imported += 1;
    collectionCounts.institutions = 1;

    db.prepare(`
      INSERT INTO sync_bootstrap_runs(
        snapshot_id, institution_id, generated_at, started_at, status,
        imported_entities, preserved_local_entities, collections_json
      ) VALUES (?, ?, ?, ?, 'running', 0, 0, '{}')
    `).run(snapshot.snapshot_id, snapshot.institution_id, snapshot.generated_at, startedAt);

    for (const spec of ENTITY_SPECS) {
      if (spec.entityType === "institution") continue;
      const rows = snapshot.entities[spec.collection] ?? [];
      collectionCounts[spec.collection] = rows.length;
      for (const row of rows) {
        const entityId = requiredText(row.id, `${spec.collection}.id`);
        const foreignInstitution = String(row.institution_id ?? snapshot.institution_id).trim();
        if (foreignInstitution !== snapshot.institution_id) {
          throw new Error(`${spec.collection}.institution_id_mismatch`);
        }
        const dirty = db.prepare(`
          SELECT local_dirty FROM sync_records
          WHERE institution_id = ? AND entity_type = ? AND entity_id = ?
        `).get(snapshot.institution_id, spec.entityType, entityId) as
          | { local_dirty: number }
          | undefined;
        if (dirty?.local_dirty === 1) {
          preserved += 1;
          continue;
        }

        const serverVersion = nonNegativeInteger(row.server_version ?? 0, `${spec.collection}.server_version`);
        const occurredAt = isoText(row.updated_at ?? snapshot.generated_at, `${spec.collection}.updated_at`);
        materializeEntity(db, {
          institutionId: snapshot.institution_id,
          entityType: spec.entityType,
          entityId,
          action: "upsert",
          payload: row,
          serverVersion,
          occurredAt,
        });
        writeSyncRecord(
          db,
          snapshot.institution_id,
          spec.entityType,
          entityId,
          row,
          serverVersion,
          occurredAt,
        );
        imported += 1;
      }
    }

    db.prepare(`
      INSERT INTO sync_cursors(institution_id, stream, cursor, last_success_at, last_error_at, last_error)
      VALUES (?, 'cloud', ?, ?, NULL, NULL)
      ON CONFLICT(institution_id, stream) DO UPDATE SET
        cursor = excluded.cursor,
        last_success_at = excluded.last_success_at,
        last_error_at = NULL,
        last_error = NULL
    `).run(snapshot.institution_id, snapshot.cursor, snapshot.generated_at);
    setMeta(db, "last_cloud_sync_at", snapshot.generated_at);
    setMeta(db, `last_cloud_sync_at:${snapshot.institution_id}`, snapshot.generated_at);
    retryMaterializationFailures(db, snapshot.institution_id);

    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE sync_bootstrap_runs
      SET status = 'completed', completed_at = ?, imported_entities = ?,
          preserved_local_entities = ?, collections_json = ?
      WHERE snapshot_id = ? AND institution_id = ?
    `).run(
      completedAt,
      imported,
      preserved,
      canonicalJson(collectionCounts),
      snapshot.snapshot_id,
      snapshot.institution_id,
    );
    db.prepare(`
      INSERT INTO audit_log(institution_id, event_type, details_json, occurred_at)
      VALUES (?, 'sync.bootstrap_completed', ?, ?)
    `).run(
      snapshot.institution_id,
      canonicalJson({
        snapshot_id: snapshot.snapshot_id,
        imported_entities: imported,
        preserved_local_entities: preserved,
        collections: collectionCounts,
      }),
      completedAt,
    );

    return {
      snapshot_id: snapshot.snapshot_id,
      institution_id: snapshot.institution_id,
      status: "applied" as const,
      imported_entities: imported,
      preserved_local_entities: preserved,
      collections: collectionCounts,
      completed_at: completedAt,
    };
  })();
}

function parseBootstrapSnapshot(raw: unknown): BootstrapSnapshot {
  const root = record(raw, "bootstrap");
  if (root.protocol_version !== SYNC_PROTOCOL_VERSION) {
    throw new Error("protocol_version_unsupported");
  }
  const snapshotId = requiredText(root.snapshot_id, "snapshot_id");
  const institutionId = requiredText(root.institution_id, "institution_id");
  const generatedAt = isoText(root.generated_at, "generated_at");
  const cursor = root.cursor === null || root.cursor === undefined
    ? null
    : requiredText(root.cursor, "cursor");
  const institution = record(root.institution, "institution");
  if (institution.id !== undefined && String(institution.id).trim() !== institutionId) {
    throw new Error("institution.id_mismatch");
  }
  const rawEntities = record(root.entities ?? {}, "entities");
  const entities: Record<string, Record<string, unknown>[]> = {};

  for (const [collection, value] of Object.entries(rawEntities)) {
    if (FORBIDDEN_COLLECTION.test(collection)) throw new Error(`forbidden_collection:${collection}`);
    const spec = collectionSpec(collection);
    if (!spec || spec.entityType === "institution") {
      throw new Error(`bootstrap_collection_unsupported:${collection}`);
    }
    if (!Array.isArray(value)) throw new Error(`${collection}_must_be_array`);
    entities[collection] = value.map((row, index) => record(row, `${collection}[${index}]`));
  }

  return {
    protocol_version: SYNC_PROTOCOL_VERSION,
    snapshot_id: snapshotId,
    institution_id: institutionId,
    generated_at: generatedAt,
    cursor,
    institution,
    entities,
  };
}

function writeSyncRecord(
  db: RelayDatabase,
  institutionId: string,
  entityType: SyncEntityType,
  entityId: string,
  payload: Record<string, unknown>,
  serverVersion: number,
  updatedAt: string,
) {
  db.prepare(`
    INSERT INTO sync_records(
      institution_id, entity_type, entity_id, payload_json, server_version,
      local_dirty, deleted_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
    ON CONFLICT(institution_id, entity_type, entity_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      server_version = excluded.server_version,
      local_dirty = 0,
      deleted_at = NULL,
      updated_at = excluded.updated_at
  `).run(
    institutionId,
    entityType,
    entityId,
    canonicalJson(payload),
    serverVersion,
    updatedAt,
  );
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}_required`);
  return text;
}

function nonNegativeInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label}_invalid`);
  return number;
}

function isoText(value: unknown, label: string) {
  const text = requiredText(value, label);
  if (!Number.isFinite(new Date(text).getTime())) throw new Error(`${label}_invalid`);
  return text;
}

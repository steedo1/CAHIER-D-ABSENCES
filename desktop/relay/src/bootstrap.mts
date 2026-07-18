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
  source_skipped_entities: number;
  source_diagnostics: Record<string, unknown>;
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
  diagnostics: Record<string, unknown>;
};

type DependencyRule = {
  field: string;
  collection: string;
  optional?: boolean;
};

const DEPENDENCY_RULES: Record<string, readonly DependencyRule[]> = {
  user_roles: [{ field: "profile_id", collection: "profiles" }],
  teacher_subjects: [
    { field: "teacher_id", collection: "profiles" },
    { field: "subject_id", collection: "subjects" },
  ],
  class_enrollments: [
    { field: "class_id", collection: "classes" },
    { field: "student_id", collection: "students" },
  ],
  teacher_timetables: [
    { field: "class_id", collection: "classes" },
    { field: "subject_id", collection: "subjects" },
    { field: "teacher_id", collection: "profiles" },
    { field: "period_id", collection: "institution_periods" },
  ],
  teacher_absence_requests: [{ field: "teacher_id", collection: "profiles" }],
  teacher_sessions: [
    { field: "class_id", collection: "classes" },
    { field: "subject_id", collection: "subjects" },
    { field: "teacher_id", collection: "profiles" },
    { field: "period_id", collection: "institution_periods", optional: true },
  ],
  attendance_marks: [
    { field: "session_id", collection: "teacher_sessions" },
    { field: "student_id", collection: "students" },
  ],
  grade_evaluations: [
    { field: "class_id", collection: "classes" },
    { field: "subject_id", collection: "subjects" },
    { field: "teacher_id", collection: "profiles", optional: true },
    { field: "grade_period_id", collection: "grade_periods", optional: true },
  ],
  student_grades: [
    { field: "evaluation_id", collection: "grade_evaluations" },
    { field: "student_id", collection: "students" },
  ],
  textbook_assignments: [
    { field: "class_id", collection: "classes" },
    { field: "subject_id", collection: "subjects" },
    { field: "teacher_id", collection: "profiles", optional: true },
  ],
  textbook_items: [{ field: "assignment_id", collection: "textbook_assignments" }],
  textbook_sessions: [
    { field: "assignment_id", collection: "textbook_assignments" },
    { field: "item_id", collection: "textbook_items" },
    { field: "teacher_id", collection: "profiles", optional: true },
    { field: "period_id", collection: "institution_periods", optional: true },
  ],
  textbook_completions: [
    { field: "assignment_id", collection: "textbook_assignments" },
    { field: "item_id", collection: "textbook_items" },
  ],
};

const FORBIDDEN_COLLECTION = /finance|payment|receipt|cash|payroll|expense|budget|charge|debt/i;

export function applyBootstrap(db: RelayDatabase, raw: unknown): BootstrapResult {
  const snapshot = parseBootstrapSnapshot(raw);
  validateBootstrapDependencies(snapshot);
  const existing = db.prepare(`
    SELECT completed_at, imported_entities, preserved_local_entities, collections_json,
           source_skipped_entities, source_diagnostics_json
    FROM sync_bootstrap_runs
    WHERE snapshot_id = ? AND institution_id = ? AND status = 'completed'
  `).get(snapshot.snapshot_id, snapshot.institution_id) as
    | {
        completed_at: string;
        imported_entities: number;
        preserved_local_entities: number;
        collections_json: string;
        source_skipped_entities: number;
        source_diagnostics_json: string;
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
      source_skipped_entities: Number(existing.source_skipped_entities || 0),
      source_diagnostics: JSON.parse(existing.source_diagnostics_json) as Record<string, unknown>,
      completed_at: existing.completed_at,
    };
  }

  return db.transaction(() => {
    const startedAt = new Date().toISOString();
    let imported = 0;
    let preserved = 0;
    const collectionCounts: Record<string, number> = {};
    const sourceSkippedEntities = nonNegativeInteger(
      snapshot.diagnostics.skipped_count ?? 0,
      "diagnostics.skipped_count",
    );

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
        imported_entities, preserved_local_entities, collections_json,
        source_skipped_entities, source_diagnostics_json
      ) VALUES (?, ?, ?, ?, 'running', 0, 0, '{}', ?, ?)
    `).run(
      snapshot.snapshot_id,
      snapshot.institution_id,
      snapshot.generated_at,
      startedAt,
      sourceSkippedEntities,
      canonicalJson(snapshot.diagnostics),
    );

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
        try {
          materializeEntity(db, {
            institutionId: snapshot.institution_id,
            entityType: spec.entityType,
            entityId,
            action: "upsert",
            payload: row,
            serverVersion,
            occurredAt,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "materialization_failed";
          throw new Error(`bootstrap_materialization_failed:${spec.collection}:${entityId}:${message}`);
        }
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
          preserved_local_entities = ?, collections_json = ?,
          source_skipped_entities = ?, source_diagnostics_json = ?
      WHERE snapshot_id = ? AND institution_id = ?
    `).run(
      completedAt,
      imported,
      preserved,
      canonicalJson(collectionCounts),
      sourceSkippedEntities,
      canonicalJson(snapshot.diagnostics),
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
        source_skipped_entities: sourceSkippedEntities,
        source_diagnostics: snapshot.diagnostics,
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
      source_skipped_entities: sourceSkippedEntities,
      source_diagnostics: snapshot.diagnostics,
      completed_at: completedAt,
    };
  })();
}

function validateBootstrapDependencies(snapshot: BootstrapSnapshot) {
  const idsByCollection = new Map<string, Set<string>>();
  for (const spec of ENTITY_SPECS) {
    if (spec.entityType === "institution") continue;
    const ids = new Set<string>();
    for (const row of snapshot.entities[spec.collection] ?? []) {
      const id = String(row.id ?? "").trim();
      if (id) ids.add(id);
    }
    idsByCollection.set(spec.collection, ids);
  }

  for (const [collection, rules] of Object.entries(DEPENDENCY_RULES)) {
    for (const row of snapshot.entities[collection] ?? []) {
      const entityId = requiredText(row.id, `${collection}.id`);
      for (const rule of rules) {
        const foreignId = String(row[rule.field] ?? "").trim();
        if (!foreignId && rule.optional) continue;
        if (!foreignId || !idsByCollection.get(rule.collection)?.has(foreignId)) {
          throw new Error(
            `bootstrap_dependency_missing:${collection}:${entityId}:${rule.field}:${foreignId || "null"}`,
          );
        }
      }
    }
  }
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
  const diagnostics = root.diagnostics === undefined
    ? {}
    : record(root.diagnostics, "diagnostics");
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
    diagnostics,
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

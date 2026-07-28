import type { RelayDatabase } from "./db.mjs";
import { getInstitutionMeta, setInstitutionMeta } from "./db.mjs";
import {
  collectionSpec,
  ENTITY_SPECS,
  materializeEntity,
  materializeTracked,
  retryMaterializationFailures,
} from "./entity-materializer.mjs";
import { canonicalJson } from "./json.mjs";
import { SYNC_PROTOCOL_VERSION, type SyncEntityType } from "./types.mjs";

export type BootstrapDiagnostic = {
  collection: string;
  entity_id: string;
  institution_id: string;
  reason:
    | "dependency_missing"
    | "institution_mismatch"
    | "materialization_failed"
    | "validation_failed"
    | "duplicate_entity"
    | "forbidden_collection"
    | "unsupported_collection"
    | "collection_invalid";
  dependency_type?: string;
  dependency_id?: string;
  error?: string;
};

export type BootstrapResult = {
  snapshot_id: string;
  institution_id: string;
  status: "applied" | "partial" | "duplicate";
  imported_entities: number;
  preserved_local_entities: number;
  deferred_entities: number;
  rejected_entities: number;
  collections: Record<string, number>;
  diagnostics: BootstrapDiagnostic[];
  source_skipped_entities: number;
  source_diagnostics: Record<string, unknown>;
  completed_at: string;
  snapshot_revision: number | null;
  snapshot_completeness: "complete" | "partial";
  applied_snapshot_revision: number | null;
};

type BootstrapSnapshot = {
  protocol_version: typeof SYNC_PROTOCOL_VERSION;
  snapshot_id: string;
  institution_id: string;
  generated_at: string;
  snapshot_revision: number | null;
  snapshot_completeness: "complete" | "partial";
  schedule_manifest: Record<string, unknown>;
  cursor: string | null;
  institution: Record<string, unknown>;
  entities: Record<string, Record<string, unknown>[]>;
  diagnostics: Record<string, unknown>;
  inputDiagnostics: BootstrapDiagnostic[];
};

type DependencyRule = {
  field: string;
  collection: string;
  optional?: boolean;
};

type WorkItem = {
  key: string;
  collection: string;
  entityType: SyncEntityType;
  entityId: string;
  row: Record<string, unknown>;
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
  const existing = db.prepare(`
    SELECT completed_at, status, imported_entities, preserved_local_entities,
           deferred_entities, rejected_entities, collections_json, diagnostics_json,
           source_skipped_entities, source_diagnostics_json
    FROM sync_bootstrap_runs
    WHERE institution_id = ? AND snapshot_id = ? AND status IN ('completed', 'partial')
  `).get(snapshot.institution_id, snapshot.snapshot_id) as StoredBootstrapRun | undefined;
  if (existing) return duplicateResult(db, snapshot, existing);

  return db.transaction(() => {
    const startedAt = new Date().toISOString();
    let imported = 0;
    let preserved = 0;
    let rejected = snapshot.inputDiagnostics.length;
    const diagnostics = [...snapshot.inputDiagnostics];
    const deferredKeys = new Set<string>();
    const collectionCounts = collectionCountsFor(snapshot);
    const sourceSkippedEntities = nonNegativeInteger(
      snapshot.diagnostics.skipped_count ?? 0,
      "diagnostics.skipped_count",
    );

    assertInstitutionIdentityCompatible(db, snapshot);
    const institutionPayload = {
      ...snapshot.institution,
      id: snapshot.institution_id,
      name: requiredText(snapshot.institution.name, "institution_name"),
    };
    const institutionVersion = nonNegativeInteger(
      snapshot.institution.server_version ?? 0,
      "server_version",
    );
    const institutionDirty = isLocalDirty(
      db,
      snapshot.institution_id,
      "institution",
      snapshot.institution_id,
    );
    if (institutionDirty) {
      preserved += 1;
    } else {
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
    }

    db.prepare(`
      INSERT INTO sync_bootstrap_runs(
        snapshot_id, institution_id, generated_at, started_at, status,
        imported_entities, preserved_local_entities, deferred_entities,
        rejected_entities, collections_json, diagnostics_json,
        source_skipped_entities, source_diagnostics_json
      ) VALUES (?, ?, ?, ?, 'running', 0, 0, 0, 0, '{}', '[]', ?, ?)
    `).run(
      snapshot.snapshot_id,
      snapshot.institution_id,
      snapshot.generated_at,
      startedAt,
      sourceSkippedEntities,
      canonicalJson(snapshot.diagnostics),
    );

    const available = loadAvailableEntities(db, snapshot.institution_id);
    let remaining = buildWorkItems(snapshot, diagnostics);
    const incomingTimetableIds = new Set(
      remaining
        .filter((item) => item.entityType === "teacher_timetable")
        .map((item) => item.entityId),
    );
    const preservedSupersededTimetableIds = new Set<string>();
    rejected += diagnostics.length - snapshot.inputDiagnostics.length;

    while (remaining.length > 0) {
      let progressed = 0;
      const next: WorkItem[] = [];
      for (const item of remaining) {
        const missing = missingDependencies(item, available);
        if (missing.length > 0) {
          deferredKeys.add(item.key);
          next.push(item);
          continue;
        }

        const outcome = importWorkItem(db, snapshot, item);
        if (outcome.status === "preserved") {
          preserved += 1;
        } else if (outcome.status === "imported") {
          imported += 1;
          available.get(item.collection)?.add(item.entityId);
          if (item.entityType === "teacher_timetable") {
            const reconciliation = reconcileSupersededTeacherTimetables(
              db,
              snapshot,
              item.entityId,
              incomingTimetableIds,
              preservedSupersededTimetableIds,
              sourceSkippedEntities === 0,
            );
            preserved += reconciliation.preserved;
          }
        } else {
          rejected += 1;
          diagnostics.push(outcome.diagnostic);
        }
        progressed += 1;
      }
      remaining = next;
      if (progressed === 0) break;
    }

    for (const item of remaining) {
      const missing = missingDependencies(item, available);
      const diagnosticRows = missing.length > 0
        ? missing.map((dependency) => ({
            collection: item.collection,
            entity_id: item.entityId,
            institution_id: snapshot.institution_id,
            reason: "dependency_missing" as const,
            dependency_type: dependency.field,
            dependency_id: dependency.id || "null",
          }))
        : [{
            collection: item.collection,
            entity_id: item.entityId,
            institution_id: snapshot.institution_id,
            reason: "materialization_failed" as const,
            error: "bootstrap_entity_could_not_be_materialized",
          }];
      diagnostics.push(...diagnosticRows);
      rejected += 1;
      persistRejectedEntity(db, snapshot, item, diagnosticRows);
    }

    retryMaterializationFailures(db, snapshot.institution_id);
    db.prepare(`
      INSERT INTO sync_cursors(institution_id, stream, cursor, last_success_at, last_error_at, last_error)
      VALUES (?, 'cloud', ?, ?, NULL, NULL)
      ON CONFLICT(institution_id, stream) DO UPDATE SET
        cursor = excluded.cursor,
        last_success_at = excluded.last_success_at,
        last_error_at = NULL,
        last_error = NULL
    `).run(snapshot.institution_id, snapshot.cursor, snapshot.generated_at);
    setInstitutionMeta(db, snapshot.institution_id, "last_cloud_sync_at", snapshot.generated_at);

    const completedAt = new Date().toISOString();
    const partial = rejected > 0 || sourceSkippedEntities > 0;
    const completeSnapshotApplied =
      snapshot.snapshot_completeness === "complete" &&
      snapshot.snapshot_revision !== null &&
      !partial;
    if (completeSnapshotApplied) {
      setInstitutionMeta(
        db,
        snapshot.institution_id,
        "attendance_schedule_manifest",
        canonicalJson(snapshot.schedule_manifest),
      );
      setInstitutionMeta(
        db,
        snapshot.institution_id,
        "attendance_schedule_revision",
        String(snapshot.snapshot_revision),
      );
      setInstitutionMeta(
        db,
        snapshot.institution_id,
        "attendance_schedule_generated_at",
        snapshot.generated_at,
      );
    }
    const storedStatus = partial ? "partial" : "completed";
    const resultStatus: BootstrapResult["status"] = partial ? "partial" : "applied";
    db.prepare(`
      UPDATE sync_bootstrap_runs
      SET status = ?, completed_at = ?, imported_entities = ?,
          preserved_local_entities = ?, deferred_entities = ?, rejected_entities = ?,
          collections_json = ?, diagnostics_json = ?,
          source_skipped_entities = ?, source_diagnostics_json = ?
      WHERE institution_id = ? AND snapshot_id = ?
    `).run(
      storedStatus,
      completedAt,
      imported,
      preserved,
      deferredKeys.size,
      rejected,
      canonicalJson(collectionCounts),
      canonicalJson(diagnostics),
      sourceSkippedEntities,
      canonicalJson(snapshot.diagnostics),
      snapshot.institution_id,
      snapshot.snapshot_id,
    );
    db.prepare(`
      INSERT INTO audit_log(institution_id, event_type, details_json, occurred_at)
      VALUES (?, ?, ?, ?)
    `).run(
      snapshot.institution_id,
      partial ? "sync.bootstrap_partial" : "sync.bootstrap_completed",
      canonicalJson({
        snapshot_id: snapshot.snapshot_id,
        imported_entities: imported,
        preserved_local_entities: preserved,
        deferred_entities: deferredKeys.size,
        rejected_entities: rejected,
        collections: collectionCounts,
        diagnostics,
        source_skipped_entities: sourceSkippedEntities,
        source_diagnostics: snapshot.diagnostics,
      }),
      completedAt,
    );

    return {
      snapshot_id: snapshot.snapshot_id,
      institution_id: snapshot.institution_id,
      status: resultStatus,
      imported_entities: imported,
      preserved_local_entities: preserved,
      deferred_entities: deferredKeys.size,
      rejected_entities: rejected,
      collections: collectionCounts,
      diagnostics,
      source_skipped_entities: sourceSkippedEntities,
      source_diagnostics: snapshot.diagnostics,
      completed_at: completedAt,
      snapshot_revision: snapshot.snapshot_revision,
      snapshot_completeness: snapshot.snapshot_completeness,
      applied_snapshot_revision: completeSnapshotApplied
        ? snapshot.snapshot_revision
        : storedScheduleRevision(db, snapshot.institution_id),
    };
  })();
}

type StoredBootstrapRun = {
  completed_at: string;
  status: "completed" | "partial";
  imported_entities: number;
  preserved_local_entities: number;
  deferred_entities: number;
  rejected_entities: number;
  collections_json: string;
  diagnostics_json: string;
  source_skipped_entities: number;
  source_diagnostics_json: string;
};

function duplicateResult(
  db: RelayDatabase,
  snapshot: BootstrapSnapshot,
  existing: StoredBootstrapRun,
): BootstrapResult {
  return {
    snapshot_id: snapshot.snapshot_id,
    institution_id: snapshot.institution_id,
    status: "duplicate",
    imported_entities: Number(existing.imported_entities || 0),
    preserved_local_entities: Number(existing.preserved_local_entities || 0),
    deferred_entities: Number(existing.deferred_entities || 0),
    rejected_entities: Number(existing.rejected_entities || 0),
    collections: JSON.parse(existing.collections_json) as Record<string, number>,
    diagnostics: JSON.parse(existing.diagnostics_json) as BootstrapDiagnostic[],
    source_skipped_entities: Number(existing.source_skipped_entities || 0),
    source_diagnostics: JSON.parse(existing.source_diagnostics_json) as Record<string, unknown>,
    completed_at: existing.completed_at,
    snapshot_revision: snapshot.snapshot_revision,
    snapshot_completeness: snapshot.snapshot_completeness,
    applied_snapshot_revision: storedScheduleRevision(
      db,
      snapshot.institution_id,
    ),
  };
}

function storedScheduleRevision(db: RelayDatabase, institutionId: string) {
  const value = getInstitutionMeta(
    db,
    institutionId,
    "attendance_schedule_revision",
  );
  if (value === null) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function assertInstitutionIdentityCompatible(db: RelayDatabase, snapshot: BootstrapSnapshot) {
  const current = db.prepare(`
    SELECT code FROM institutions WHERE id = ?
  `).get(snapshot.institution_id) as { code: string | null } | undefined;
  const currentCode = normalizedCode(current?.code);
  const suppliedCode = normalizedCode(
    snapshot.institution.code_unique ?? snapshot.institution.code ?? snapshot.institution.acronym,
  );
  if (currentCode && suppliedCode && currentCode !== suppliedCode) {
    throw new Error(
      `bootstrap_institution_identity_conflict:${snapshot.institution_id}:${currentCode}:${suppliedCode}`,
    );
  }
}

function collectionCountsFor(snapshot: BootstrapSnapshot) {
  const counts: Record<string, number> = { institutions: 1 };
  for (const spec of ENTITY_SPECS) {
    if (spec.entityType !== "institution") {
      counts[spec.collection] = snapshot.entities[spec.collection]?.length ?? 0;
    }
  }
  return counts;
}

function loadAvailableEntities(db: RelayDatabase, institutionId: string) {
  const available = new Map<string, Set<string>>();
  for (const spec of ENTITY_SPECS) {
    if (spec.entityType === "institution") continue;
    const rows = db.prepare(`
      SELECT id FROM ${spec.table}
      WHERE institution_id = ? AND deleted_at IS NULL
    `).all(institutionId) as Array<{ id: string }>;
    available.set(spec.collection, new Set(rows.map((row) => String(row.id))));
  }
  return available;
}

function buildWorkItems(
  snapshot: BootstrapSnapshot,
  diagnostics: BootstrapDiagnostic[],
) {
  const work: WorkItem[] = [];
  const seen = new Set<string>();
  let ordinal = 0;
  for (const [collection, rows] of Object.entries(snapshot.entities)) {
    const spec = collectionSpec(collection);
    if (!spec || spec.entityType === "institution") continue;
    for (const row of rows) {
      ordinal += 1;
      const entityId = String(row.id ?? "").trim();
      if (!entityId) {
        diagnostics.push({
          collection,
          entity_id: `<missing:${ordinal}>`,
          institution_id: snapshot.institution_id,
          reason: "validation_failed",
          error: `${collection}.id_required`,
        });
        continue;
      }
      const foreignInstitution = String(row.institution_id ?? snapshot.institution_id).trim();
      if (foreignInstitution !== snapshot.institution_id) {
        diagnostics.push({
          collection,
          entity_id: entityId,
          institution_id: snapshot.institution_id,
          reason: "institution_mismatch",
          dependency_type: "institution_id",
          dependency_id: foreignInstitution || "null",
        });
        continue;
      }
      const identity = `${collection}\u0000${entityId}`;
      if (seen.has(identity)) {
        diagnostics.push({
          collection,
          entity_id: entityId,
          institution_id: snapshot.institution_id,
          reason: "duplicate_entity",
        });
        continue;
      }
      seen.add(identity);
      work.push({
        key: `${identity}\u0000${ordinal}`,
        collection,
        entityType: spec.entityType,
        entityId,
        row,
      });
    }
  }
  return work;
}

function missingDependencies(
  item: WorkItem,
  available: Map<string, Set<string>>,
) {
  const missing: Array<{ field: string; id: string; collection: string }> = [];
  for (const rule of DEPENDENCY_RULES[item.collection] ?? []) {
    const id = String(item.row[rule.field] ?? "").trim();
    if (!id && rule.optional) continue;
    if (!id || !available.get(rule.collection)?.has(id)) {
      missing.push({ field: rule.field, id, collection: rule.collection });
    }
  }
  return missing;
}

function importWorkItem(
  db: RelayDatabase,
  snapshot: BootstrapSnapshot,
  item: WorkItem,
):
  | { status: "imported" }
  | { status: "preserved" }
  | { status: "rejected"; diagnostic: BootstrapDiagnostic } {
  if (isLocalDirty(db, snapshot.institution_id, item.entityType, item.entityId)) {
    return { status: "preserved" };
  }

  let serverVersion: number;
  let occurredAt: string;
  try {
    serverVersion = nonNegativeInteger(
      item.row.server_version ?? 0,
      `${item.collection}.server_version`,
    );
    occurredAt = isoText(
      item.row.updated_at ?? snapshot.generated_at,
      `${item.collection}.updated_at`,
    );
  } catch (error) {
    return {
      status: "rejected",
      diagnostic: {
        collection: item.collection,
        entity_id: item.entityId,
        institution_id: snapshot.institution_id,
        reason: "validation_failed",
        error: error instanceof Error ? error.message : "bootstrap_validation_failed",
      },
    };
  }

  writeSyncRecord(
    db,
    snapshot.institution_id,
    item.entityType,
    item.entityId,
    item.row,
    serverVersion,
    occurredAt,
  );
  const result = materializeTracked(db, {
    institutionId: snapshot.institution_id,
    entityType: item.entityType,
    entityId: item.entityId,
    action: "upsert",
    payload: item.row,
    serverVersion,
    occurredAt,
  });
  if (result.materialized) return { status: "imported" };
  return {
    status: "rejected",
    diagnostic: {
      collection: item.collection,
      entity_id: item.entityId,
      institution_id: snapshot.institution_id,
      reason: "materialization_failed",
      error: result.error,
    },
  };
}

function reconcileSupersededTeacherTimetables(
  db: RelayDatabase,
  snapshot: BootstrapSnapshot,
  incomingId: string,
  incomingIds: ReadonlySet<string>,
  preservedIds: Set<string>,
  sourceIsComplete: boolean,
) {
  if (!sourceIsComplete) return { preserved: 0 };
  const incoming = db.prepare(`
    SELECT class_id, subject_id, teacher_id, period_id, weekday
    FROM teacher_timetables
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(snapshot.institution_id, incomingId) as {
    class_id: string;
    subject_id: string;
    teacher_id: string;
    period_id: string;
    weekday: number | null;
  } | undefined;
  if (!incoming) return { preserved: 0 };

  const candidates = db.prepare(`
    SELECT id
    FROM teacher_timetables
    WHERE institution_id = ?
      AND id <> ?
      AND class_id = ?
      AND subject_id = ?
      AND teacher_id = ?
      AND period_id = ?
      AND weekday IS ?
      AND deleted_at IS NULL
    ORDER BY id
  `).all(
    snapshot.institution_id,
    incomingId,
    incoming.class_id,
    incoming.subject_id,
    incoming.teacher_id,
    incoming.period_id,
    incoming.weekday,
  ) as Array<{ id: string }>;

  let preserved = 0;
  for (const candidate of candidates) {
    if (incomingIds.has(candidate.id)) continue;
    if (
      isLocalDirty(db, snapshot.institution_id, "teacher_timetable", candidate.id) ||
      hasLocalTimetableOperation(db, snapshot.institution_id, candidate.id)
    ) {
      if (!preservedIds.has(candidate.id)) {
        preservedIds.add(candidate.id);
        preserved += 1;
      }
      continue;
    }

    db.prepare(`
      UPDATE teacher_timetables
      SET deleted_at = ?, updated_at = ?
      WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
    `).run(
      snapshot.generated_at,
      snapshot.generated_at,
      snapshot.institution_id,
      candidate.id,
    );
    db.prepare(`
      UPDATE sync_records
      SET local_dirty = 0, deleted_at = ?, updated_at = ?
      WHERE institution_id = ? AND entity_type = 'teacher_timetable' AND entity_id = ?
    `).run(
      snapshot.generated_at,
      snapshot.generated_at,
      snapshot.institution_id,
      candidate.id,
    );
    db.prepare(`
      DELETE FROM sync_materialization_failures
      WHERE institution_id = ? AND entity_type = 'teacher_timetable' AND entity_id = ?
    `).run(snapshot.institution_id, candidate.id);
  }
  return { preserved };
}

function hasLocalTimetableOperation(
  db: RelayDatabase,
  institutionId: string,
  timetableId: string,
) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sync_outbox
    WHERE institution_id = ?
      AND entity_type = 'teacher_timetable'
      AND entity_id = ?
    LIMIT 1
  `).get(institutionId, timetableId));
}

function persistRejectedEntity(
  db: RelayDatabase,
  snapshot: BootstrapSnapshot,
  item: WorkItem,
  diagnostics: BootstrapDiagnostic[],
) {
  try {
    const serverVersion = nonNegativeInteger(
      item.row.server_version ?? 0,
      `${item.collection}.server_version`,
    );
    const occurredAt = isoText(
      item.row.updated_at ?? snapshot.generated_at,
      `${item.collection}.updated_at`,
    );
    writeSyncRecord(
      db,
      snapshot.institution_id,
      item.entityType,
      item.entityId,
      item.row,
      serverVersion,
      occurredAt,
    );
    db.prepare(`
      INSERT INTO sync_materialization_failures(
        institution_id, entity_type, entity_id, action, payload_json,
        server_version, occurred_at, attempts, last_error, updated_at
      ) VALUES (?, ?, ?, 'upsert', ?, ?, ?, 1, ?, ?)
      ON CONFLICT(institution_id, entity_type, entity_id) DO UPDATE SET
        action = excluded.action,
        payload_json = excluded.payload_json,
        server_version = excluded.server_version,
        occurred_at = excluded.occurred_at,
        attempts = sync_materialization_failures.attempts + 1,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(
      snapshot.institution_id,
      item.entityType,
      item.entityId,
      canonicalJson(item.row),
      serverVersion,
      occurredAt,
      `bootstrap_rejected:${canonicalJson(diagnostics)}`,
      new Date().toISOString(),
    );
  } catch {
    // The run-level diagnostic remains authoritative for an invalid payload.
  }
}

function isLocalDirty(
  db: RelayDatabase,
  institutionId: string,
  entityType: SyncEntityType,
  entityId: string,
) {
  const row = db.prepare(`
    SELECT local_dirty FROM sync_records
    WHERE institution_id = ? AND entity_type = ? AND entity_id = ?
  `).get(institutionId, entityType, entityId) as { local_dirty: number } | undefined;
  return row?.local_dirty === 1;
}

function parseBootstrapSnapshot(raw: unknown): BootstrapSnapshot {
  const root = record(raw, "bootstrap");
  if (root.protocol_version !== SYNC_PROTOCOL_VERSION) {
    throw new Error("protocol_version_unsupported");
  }
  const snapshotId = requiredText(root.snapshot_id, "snapshot_id");
  const institutionId = requiredText(root.institution_id, "institution_id");
  const generatedAt = isoText(root.generated_at, "generated_at");
  const snapshotRevision = root.snapshot_revision === undefined
    ? null
    : nonNegativeInteger(root.snapshot_revision, "snapshot_revision");
  const snapshotCompleteness = root.snapshot_completeness === "complete"
    ? "complete"
    : "partial";
  if (snapshotCompleteness === "complete" && snapshotRevision === null) {
    throw new Error("snapshot_revision_required_for_complete_snapshot");
  }
  const cursor = root.cursor === null || root.cursor === undefined
    ? null
    : requiredText(root.cursor, "cursor");
  const institution = record(root.institution, "institution");
  const scheduleManifest = root.schedule_manifest === undefined
    ? {}
    : record(root.schedule_manifest, "schedule_manifest");
  if (institution.id !== undefined && String(institution.id).trim() !== institutionId) {
    throw new Error("institution.id_mismatch");
  }
  const rawEntities = record(root.entities ?? {}, "entities");
  const diagnostics = root.diagnostics === undefined
    ? {}
    : record(root.diagnostics, "diagnostics");
  const entities: Record<string, Record<string, unknown>[]> = {};
  const inputDiagnostics: BootstrapDiagnostic[] = [];

  for (const [collection, value] of Object.entries(rawEntities)) {
    const forbidden = FORBIDDEN_COLLECTION.test(collection);
    const spec = collectionSpec(collection);
    if (forbidden || !spec || spec.entityType === "institution" || !Array.isArray(value)) {
      const rows = Array.isArray(value) && value.length > 0 ? value : [null];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const entityId = row && typeof row === "object" && !Array.isArray(row)
          ? String((row as Record<string, unknown>).id ?? `<row:${index}>`)
          : `<row:${index}>`;
        inputDiagnostics.push({
          collection,
          entity_id: entityId,
          institution_id: institutionId,
          reason: forbidden
            ? "forbidden_collection"
            : !spec || spec.entityType === "institution"
              ? "unsupported_collection"
              : "collection_invalid",
        });
      }
      continue;
    }
    entities[collection] = value.map((row, index) => record(row, `${collection}[${index}]`));
  }

  return {
    protocol_version: SYNC_PROTOCOL_VERSION,
    snapshot_id: snapshotId,
    institution_id: institutionId,
    generated_at: generatedAt,
    snapshot_revision: snapshotRevision,
    snapshot_completeness: snapshotCompleteness,
    schedule_manifest: scheduleManifest,
    cursor,
    institution,
    entities,
    diagnostics,
    inputDiagnostics,
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

function normalizedCode(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
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

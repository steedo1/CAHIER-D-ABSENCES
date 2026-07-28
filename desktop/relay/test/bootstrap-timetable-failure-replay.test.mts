import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBootstrap } from "../src/bootstrap.mjs";
import { openRelayDatabase, type RelayDatabase } from "../src/db.mjs";
import { SYNC_PROTOCOL_VERSION } from "../src/types.mjs";

const INSTITUTION_ID = "inst-bootstrap-replay";
const INSTITUTION_CODE = "REPLAY-1";
const GENERATED_AT = "2026-07-28T10:00:00.000Z";

type SnapshotOptions = {
  snapshotId: string;
  timetableCount?: number;
  completeness?: "complete" | "partial";
  institutionId?: string;
  institutionCode?: string;
};

test("A et K - un snapshot complet neutralise l'ancien UUID et son rejeu est idempotent", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-a", timetableCount: 1 });
  seedFailure(db, oldTimetablePayload(snapshot, 0, "old-a"));

  const first = applyBootstrap(db, snapshot);
  assert.equal(first.materialization_failure_counters.obsolete_failures_pruned, 1);
  assert.equal(first.materialization_failure_counters.failures_retried, 0);
  assert.equal(failureCount(db, INSTITUTION_ID, "teacher_timetable", "old-a"), 0);
  assert.equal(timetableCount(db, INSTITUTION_ID, "old-a"), 0);
  assert.equal(activeTimetableCount(db, INSTITUTION_ID), 1);
  assert.equal(ambiguityCount(db, INSTITUTION_ID), 0);

  const replay = applyBootstrap(db, snapshot);
  assert.equal(replay.status, "duplicate");
  assert.deepEqual(
    replay.materialization_failure_counters,
    first.materialization_failure_counters,
  );
  assert.equal(activeTimetableCount(db, INSTITUTION_ID), 1);
  assert.equal(ambiguityCount(db, INSTITUTION_ID), 0);
  db.close();
});

test("B - 87 UUID courants neutralisent 49 UUID historiques sur 25 cles sans ambiguite", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-b", timetableCount: 87 });
  for (let index = 0; index < 49; index += 1) {
    seedFailure(
      db,
      oldTimetablePayload(snapshot, index % 25, `old-b-${index}`),
    );
  }

  const result = applyBootstrap(db, snapshot);
  assert.equal(result.materialization_failure_counters.obsolete_failures_pruned, 49);
  assert.equal(result.materialization_failure_counters.failures_retried, 0);
  assert.equal(materializationFailureCount(db, INSTITUTION_ID), 0);
  assert.equal(activeTimetableCount(db, INSTITUTION_ID), 87);
  assert.equal(ambiguityCount(db, INSTITUTION_ID), 0);
  assert.equal(String(db.pragma("integrity_check", { simple: true })), "ok");
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("C - un snapshot partiel conserve l'ancien echec et interdit son rejeu", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({
    snapshotId: "snapshot-c",
    timetableCount: 1,
    completeness: "partial",
  });
  seedFailure(db, oldTimetablePayload(snapshot, 0, "old-c"));

  const result = applyBootstrap(db, snapshot);
  assert.equal(result.materialization_failure_counters.obsolete_failures_pruned, 0);
  assert.equal(result.materialization_failure_counters.failures_retried, 0);
  assert.equal(
    result.materialization_failure_counters.preserved_by_reason
      .snapshot_not_authoritative,
    1,
  );
  assert.equal(failureCount(db, INSTITUTION_ID, "teacher_timetable", "old-c"), 1);
  assert.equal(timetableCount(db, INSTITUTION_ID, "old-c"), 0);
  db.close();
});

test("C - une collection necessaire absente ou declaree omise interdit le pruning", () => {
  for (const mode of ["absente", "declaree-omise"] as const) {
    const db = openRelayDatabase(":memory:");
    seedInstitution(db);
    const snapshot = timetableSnapshot({
      snapshotId: `snapshot-c-${mode}`,
      timetableCount: 1,
    });
    if (mode === "absente") {
      delete (snapshot.entities as unknown as Record<string, unknown>).teacher_subjects;
    } else {
      (snapshot.diagnostics as Record<string, unknown>).omitted_collections = [
        "teacher_subjects",
      ];
    }
    seedFailure(db, oldTimetablePayload(snapshot, 0, `old-c-${mode}`));

    const result = applyBootstrap(db, snapshot);
    assert.equal(result.materialization_failure_counters.obsolete_failures_pruned, 0);
    assert.equal(
      result.materialization_failure_counters.preserved_by_reason
        .snapshot_not_authoritative,
      1,
    );
    assert.equal(
      failureCount(
        db,
        INSTITUTION_ID,
        "teacher_timetable",
        `old-c-${mode}`,
      ),
      1,
    );
    db.close();
  }
});

test("D - local_dirty protege l'ancien UUID de la neutralisation et du rejeu", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-d", timetableCount: 1 });
  seedFailure(db, oldTimetablePayload(snapshot, 0, "old-d"), { localDirty: 1 });

  const result = applyBootstrap(db, snapshot);
  assert.equal(result.materialization_failure_counters.protected_failures_preserved, 1);
  assert.equal(
    result.materialization_failure_counters.preserved_by_reason.local_dirty,
    1,
  );
  assert.equal(failureCount(db, INSTITUTION_ID, "teacher_timetable", "old-d"), 1);
  assert.equal(timetableCount(db, INSTITUTION_ID, "old-d"), 0);
  db.close();
});

test("E - les outbox pending, sending et blocked protegent chaque ancien UUID", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-e", timetableCount: 3 });
  const states = ["pending", "sending", "blocked"] as const;
  states.forEach((state, index) => {
    const oldId = `old-e-${state}`;
    seedFailure(db, oldTimetablePayload(snapshot, index, oldId));
    seedOutbox(db, {
      operationId: `operation-e-${state}`,
      entityType: "teacher_timetable",
      entityId: oldId,
      state,
    });
  });

  const before = outboxRows(db);
  const result = applyBootstrap(db, snapshot);
  assert.equal(result.materialization_failure_counters.protected_failures_preserved, 3);
  assert.equal(
    result.materialization_failure_counters.preserved_by_reason.outbox_operation,
    3,
  );
  assert.equal(materializationFailureCount(db, INSTITUTION_ID), 3);
  assert.deepEqual(outboxRows(db), before);
  db.close();
});

test("F - une dependance d'outbox protege explicitement l'identite historique", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-f", timetableCount: 1 });
  seedFailure(db, oldTimetablePayload(snapshot, 0, "old-f"));
  seedOutbox(db, {
    operationId: "operation-f-timetable",
    entityType: "teacher_timetable",
    entityId: "old-f",
    state: "pending",
  });
  seedOutbox(db, {
    operationId: "operation-f-dependent",
    entityType: "teacher_session",
    entityId: "session-f",
    state: "pending",
  });
  db.prepare(`
    INSERT INTO sync_outbox_dependencies(
      institution_id, operation_id, depends_on_operation_id, created_at
    ) VALUES (?, 'operation-f-dependent', 'operation-f-timetable', ?)
  `).run(INSTITUTION_ID, GENERATED_AT);

  const result = applyBootstrap(db, snapshot);
  assert.equal(
    result.materialization_failure_counters.preserved_by_reason.outbox_dependency,
    1,
  );
  assert.equal(failureCount(db, INSTITUTION_ID, "teacher_timetable", "old-f"), 1);
  assert.equal(
    Number((db.prepare(`
      SELECT COUNT(*) AS count FROM sync_outbox_dependencies
      WHERE institution_id = ?
    `).get(INSTITUTION_ID) as { count: number }).count),
    1,
  );
  db.close();
});

test("G - la meme identite dans une autre ecole reste strictement isolee", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  seedInstitution(db, "inst-other", "OTHER-1");
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-g", timetableCount: 1 });
  seedFailure(db, oldTimetablePayload(snapshot, 0, "old-shared"));
  const otherPayload = {
    ...oldTimetablePayload(snapshot, 0, "old-shared"),
    institution_id: "inst-other",
  };
  seedFailure(db, otherPayload, { institutionId: "inst-other" });

  applyBootstrap(db, snapshot);
  assert.equal(failureCount(db, INSTITUTION_ID, "teacher_timetable", "old-shared"), 0);
  assert.equal(failureCount(db, "inst-other", "teacher_timetable", "old-shared"), 1);
  db.close();
});

test("H - un echec d'un autre type n'est ni neutralise ni rejoue", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-h", timetableCount: 1 });
  seedFailure(db, {
    id: "historical-class",
    institution_id: INSTITUTION_ID,
    academic_year: "2026",
    label: "Classe historique",
    server_version: 1,
    updated_at: GENERATED_AT,
  }, { entityType: "class" });

  const result = applyBootstrap(db, snapshot);
  assert.equal(
    result.materialization_failure_counters.preserved_by_reason.other_entity_type,
    1,
  );
  assert.equal(failureCount(db, INSTITUTION_ID, "class", "historical-class"), 1);
  assert.equal(
    Number((db.prepare(`
      SELECT COUNT(*) AS count FROM classes
      WHERE institution_id = ? AND id = 'historical-class'
    `).get(INSTITUTION_ID) as { count: number }).count),
    0,
  );
  db.close();
});

test("I - sans remplacement semantique courant l'ancien echec est conserve", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-i", timetableCount: 1 });
  const unmatched = {
    ...oldTimetablePayload(snapshot, 0, "old-i"),
    period_id: "period-absent",
  };
  seedFailure(db, unmatched);

  const result = applyBootstrap(db, snapshot);
  assert.equal(
    result.materialization_failure_counters.preserved_by_reason
      .no_semantic_replacement,
    1,
  );
  assert.equal(failureCount(db, INSTITUTION_ID, "teacher_timetable", "old-i"), 1);
  db.close();
});

test("J - un payload historique invalide reste diagnostique et non rejoue", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-j", timetableCount: 1 });
  seedFailure(db, oldTimetablePayload(snapshot, 0, "old-j"), {
    failurePayloadJson: "{invalide",
  });

  const result = applyBootstrap(db, snapshot);
  assert.equal(result.materialization_failure_counters.invalid_failures_preserved, 1);
  assert.equal(
    result.materialization_failure_counters.preserved_by_reason.invalid_payload,
    1,
  );
  assert.equal(failureCount(db, INSTITUTION_ID, "teacher_timetable", "old-j"), 1);
  db.close();
});

test("L - les outbox attendance_call et teacher_session restent bit pour bit inchangees", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({ snapshotId: "snapshot-l", timetableCount: 1 });
  seedOutbox(db, {
    operationId: "operation-l-attendance",
    entityType: "attendance_call",
    entityId: "attendance-l",
    state: "pending",
    payloadJson: '{"marker":"attendance-call"}',
  });
  seedOutbox(db, {
    operationId: "operation-l-session",
    entityType: "teacher_session",
    entityId: "session-l",
    state: "pending",
    payloadJson: '{"marker":"teacher-session"}',
  });
  const before = outboxRows(db);

  applyBootstrap(db, snapshot);
  assert.deepEqual(outboxRows(db), before);
  db.close();
});

test("le pruning est annule avec tout le bootstrap si une etape ulterieure echoue", () => {
  const db = openRelayDatabase(":memory:");
  seedInstitution(db);
  const snapshot = timetableSnapshot({
    snapshotId: "snapshot-atomicity",
    timetableCount: 1,
  });
  seedFailure(db, oldTimetablePayload(snapshot, 0, "old-atomicity"));
  db.exec(`
    CREATE TRIGGER test_fail_bootstrap_cursor
    BEFORE INSERT ON sync_cursors
    WHEN NEW.institution_id = '${INSTITUTION_ID}'
    BEGIN
      SELECT RAISE(ABORT, 'injected_after_pruning');
    END;
  `);

  assert.throws(
    () => applyBootstrap(db, snapshot),
    /injected_after_pruning/,
  );
  assert.equal(
    failureCount(db, INSTITUTION_ID, "teacher_timetable", "old-atomicity"),
    1,
  );
  assert.equal(activeTimetableCount(db, INSTITUTION_ID), 0);
  assert.equal(
    Number((db.prepare(`
      SELECT COUNT(*) AS count
      FROM sync_bootstrap_runs
      WHERE institution_id = ? AND snapshot_id = 'snapshot-atomicity'
    `).get(INSTITUTION_ID) as { count: number }).count),
    0,
  );
  db.close();
});

function timetableSnapshot(options: SnapshotOptions) {
  const institutionId = options.institutionId ?? INSTITUTION_ID;
  const institutionCode = options.institutionCode ?? INSTITUTION_CODE;
  const timetableCount = options.timetableCount ?? 1;
  const completeness = options.completeness ?? "complete";
  const classes = Array.from({ length: timetableCount }, (_, index) => ({
    id: `class-${index}`,
    institution_id: institutionId,
    academic_year: "2026",
    label: `Classe ${index}`,
    level: null,
    server_version: 1,
    updated_at: GENERATED_AT,
  }));
  const periods = Array.from({ length: timetableCount }, (_, index) => ({
    id: `period-${index}`,
    institution_id: institutionId,
    weekday: 2,
    label: `Creneau ${index}`,
    start_time: "09:00",
    end_time: "10:00",
    server_version: 1,
    updated_at: GENERATED_AT,
  }));
  const timetables = Array.from({ length: timetableCount }, (_, index) => ({
    id: `current-timetable-${index}`,
    institution_id: institutionId,
    academic_year: "2026",
    class_id: `class-${index}`,
    subject_id: "subject-shared",
    teacher_id: "teacher-shared",
    period_id: `period-${index}`,
    weekday: 2,
    server_version: 2,
    updated_at: GENERATED_AT,
  }));
  return {
    protocol_version: SYNC_PROTOCOL_VERSION,
    snapshot_id: options.snapshotId,
    institution_id: institutionId,
    generated_at: GENERATED_AT,
    snapshot_revision: 8,
    snapshot_completeness: completeness,
    schedule_manifest: { completeness },
    cursor: `cursor-${options.snapshotId}`,
    institution: {
      id: institutionId,
      name: institutionCode,
      code: institutionCode,
      timezone: "UTC",
      settings_json: {},
      server_version: 2,
      updated_at: GENERATED_AT,
    },
    entities: {
      profiles: [{
        id: "teacher-shared",
        institution_id: institutionId,
        display_name: "Enseignant test",
        is_active: true,
        server_version: 2,
        updated_at: GENERATED_AT,
      }],
      user_roles: [{
        id: "role-teacher-shared",
        institution_id: institutionId,
        profile_id: "teacher-shared",
        role: "teacher",
        server_version: 2,
        updated_at: GENERATED_AT,
      }],
      classes,
      subjects: [{
        id: "subject-shared",
        institution_id: institutionId,
        base_subject_id: null,
        name: "Matiere test",
        short_name: "TEST",
        server_version: 2,
        updated_at: GENERATED_AT,
      }],
      teacher_subjects: [{
        id: "teacher-subject-shared",
        institution_id: institutionId,
        teacher_id: "teacher-shared",
        subject_id: "subject-shared",
        server_version: 2,
        updated_at: GENERATED_AT,
      }],
      institution_periods: periods,
      teacher_timetables: timetables,
    },
    diagnostics: {
      skipped_count: 0,
      skipped: [],
    },
  };
}

function oldTimetablePayload(
  snapshot: ReturnType<typeof timetableSnapshot>,
  currentIndex: number,
  oldId: string,
) {
  return {
    ...snapshot.entities.teacher_timetables[currentIndex],
    id: oldId,
    server_version: 1,
    updated_at: "2026-07-20T10:00:00.000Z",
  };
}

function seedInstitution(
  db: RelayDatabase,
  institutionId = INSTITUTION_ID,
  institutionCode = INSTITUTION_CODE,
) {
  db.prepare(`
    INSERT INTO institutions(id, name, code, timezone, settings_json, updated_at)
    VALUES (?, ?, ?, 'UTC', '{}', ?)
  `).run(institutionId, institutionCode, institutionCode, GENERATED_AT);
}

function seedFailure(
  db: RelayDatabase,
  payload: Record<string, unknown>,
  options: {
    institutionId?: string;
    entityType?: string;
    localDirty?: 0 | 1;
    failurePayloadJson?: string;
  } = {},
) {
  const institutionId = options.institutionId ?? INSTITUTION_ID;
  const entityType = options.entityType ?? "teacher_timetable";
  const entityId = String(payload.id);
  const payloadJson = JSON.stringify(payload);
  db.prepare(`
    INSERT INTO sync_records(
      institution_id, entity_type, entity_id, payload_json, server_version,
      local_dirty, deleted_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, NULL, ?)
  `).run(
    institutionId,
    entityType,
    entityId,
    payloadJson,
    options.localDirty ?? 0,
    GENERATED_AT,
  );
  db.prepare(`
    INSERT INTO sync_materialization_failures(
      institution_id, entity_type, entity_id, action, payload_json,
      server_version, occurred_at, attempts, last_error, updated_at
    ) VALUES (?, ?, ?, 'upsert', ?, 1, ?, 1, 'historical_unique_conflict', ?)
  `).run(
    institutionId,
    entityType,
    entityId,
    options.failurePayloadJson ?? payloadJson,
    GENERATED_AT,
    GENERATED_AT,
  );
}

function seedOutbox(
  db: RelayDatabase,
  input: {
    operationId: string;
    entityType: string;
    entityId: string;
    state: "pending" | "sending" | "blocked";
    payloadJson?: string;
  },
) {
  db.prepare(`
    INSERT INTO sync_outbox(
      operation_id, institution_id, device_id, entity_type, entity_id,
      action, base_server_version, payload_json, occurred_at, state,
      attempts, created_at
    ) VALUES (?, ?, 'device-test', ?, ?, 'upsert', 0, ?, ?, ?, 0, ?)
  `).run(
    input.operationId,
    INSTITUTION_ID,
    input.entityType,
    input.entityId,
    input.payloadJson ?? '{"marker":"protected"}',
    GENERATED_AT,
    input.state,
    GENERATED_AT,
  );
}

function failureCount(
  db: RelayDatabase,
  institutionId: string,
  entityType: string,
  entityId: string,
) {
  return Number((db.prepare(`
    SELECT COUNT(*) AS count
    FROM sync_materialization_failures
    WHERE institution_id = ? AND entity_type = ? AND entity_id = ?
  `).get(institutionId, entityType, entityId) as { count: number }).count);
}

function materializationFailureCount(
  db: RelayDatabase,
  institutionId: string,
) {
  return Number((db.prepare(`
    SELECT COUNT(*) AS count
    FROM sync_materialization_failures
    WHERE institution_id = ?
  `).get(institutionId) as { count: number }).count);
}

function timetableCount(
  db: RelayDatabase,
  institutionId: string,
  timetableId: string,
) {
  return Number((db.prepare(`
    SELECT COUNT(*) AS count
    FROM teacher_timetables
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(institutionId, timetableId) as { count: number }).count);
}

function activeTimetableCount(db: RelayDatabase, institutionId: string) {
  return Number((db.prepare(`
    SELECT COUNT(*) AS count
    FROM teacher_timetables
    WHERE institution_id = ? AND deleted_at IS NULL
  `).get(institutionId) as { count: number }).count);
}

function ambiguityCount(db: RelayDatabase, institutionId: string) {
  return Number((db.prepare(`
    SELECT COUNT(*) AS count
    FROM (
      SELECT teacher_id, class_id, period_id, weekday
      FROM teacher_timetables
      WHERE institution_id = ? AND deleted_at IS NULL
      GROUP BY teacher_id, class_id, period_id, weekday
      HAVING COUNT(*) > 1
    )
  `).get(institutionId) as { count: number }).count);
}

function outboxRows(db: RelayDatabase) {
  return db.prepare(`
    SELECT operation_id, institution_id, device_id, actor_profile_id,
           entity_type, entity_id, action, base_server_version, payload_json,
           occurred_at, state, attempts, next_attempt_at, last_attempt_at,
           last_status, last_error, created_at
    FROM sync_outbox
    WHERE institution_id = ?
    ORDER BY operation_id
  `).all(INSTITUTION_ID);
}

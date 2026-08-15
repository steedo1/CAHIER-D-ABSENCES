import assert from "node:assert/strict";
import { test } from "node:test";
import type { RelayConfig } from "../src/config.mjs";
import { openRelayDatabase } from "../src/db.mjs";
import { syncRelayOnce } from "../src/cloud-sync-grade-v4-safe.mjs";
import { RelayStore } from "../src/store.mjs";
import { SYNC_PROTOCOL_VERSION } from "../src/types.mjs";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = `${DEVICE_ID}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
const INSTITUTION_ID = "inst-1";
const GRADE_ID = "grade-1";
const EVALUATION_ID = "evaluation-1";
const STUDENT_ID = "student-1";
const TEACHER_ID = "teacher-1";
const CLASS_ID = "class-1";
const SUBJECT_ID = "subject-1";
const BASE_TIME = "2026-08-15T05:00:00.000Z";

function config(): RelayConfig {
  return {
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "admin-token",
    institutions: [{
      code: "SCH-000001",
      name: "École test",
      cloud_sync: {
        enabled: true,
        endpoint: "https://mon-cahier.com/api/relay/sync/push",
        device_id: DEVICE_ID,
        token: TOKEN,
      },
    }],
    institutionCodes: ["SCH-000001"],
    cloudSyncBatchSize: 25,
    cloudSyncTimeoutMs: 20_000,
    cloudSyncIntervalMs: 15_000,
  };
}

function setup() {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.ensureInstitution(INSTITUTION_ID, "École test", BASE_TIME);
  db.prepare("UPDATE institutions SET code = 'SCH-000001' WHERE id = ?").run(INSTITUTION_ID);

  db.prepare(`
    INSERT INTO profiles(
      id,institution_id,display_name,is_active,server_version,updated_at,deleted_at
    ) VALUES (?,?,'Prof test',1,1,?,NULL)
  `).run(TEACHER_ID, INSTITUTION_ID, BASE_TIME);
  db.prepare(`
    INSERT INTO classes(
      id,institution_id,academic_year,label,level,server_version,updated_at,deleted_at
    ) VALUES (?,?,'2026-2027','6e1','6e',1,?,NULL)
  `).run(CLASS_ID, INSTITUTION_ID, BASE_TIME);
  db.prepare(`
    INSERT INTO subjects(
      id,institution_id,name,short_name,server_version,updated_at,deleted_at
    ) VALUES (?,?,'Mathématiques','MATH',1,?,NULL)
  `).run(SUBJECT_ID, INSTITUTION_ID, BASE_TIME);
  db.prepare(`
    INSERT INTO students(
      id,institution_id,display_name,is_active,server_version,updated_at,deleted_at
    ) VALUES (?,?,'Élève test',1,1,?,NULL)
  `).run(STUDENT_ID, INSTITUTION_ID, BASE_TIME);
  db.prepare(`
    INSERT INTO grade_evaluations(
      id,institution_id,class_id,subject_id,teacher_id,grade_period_id,title,
      evaluation_date,max_score,coefficient,is_published,is_locked,
      server_version,updated_at,deleted_at
    ) VALUES (?,?,?,?,?,NULL,'Devoir test','2026-08-15',20,1,0,0,1,?,NULL)
  `).run(
    EVALUATION_ID,
    INSTITUTION_ID,
    CLASS_ID,
    SUBJECT_ID,
    TEACHER_ID,
    BASE_TIME,
  );
  db.prepare(`
    INSERT INTO student_grades(
      id,institution_id,evaluation_id,student_id,score,comment,
      server_version,updated_at,deleted_at
    ) VALUES (?,?,?,?,12,'Cloud initial',1,?,NULL)
  `).run(GRADE_ID, INSTITUTION_ID, EVALUATION_ID, STUDENT_ID, BASE_TIME);
  db.prepare(`
    INSERT INTO sync_records(
      institution_id,entity_type,entity_id,payload_json,server_version,
      local_dirty,deleted_at,updated_at
    ) VALUES (?,'student_grade',?,?,1,0,NULL,?)
  `).run(
    INSTITUTION_ID,
    GRADE_ID,
    JSON.stringify(remotePayload(12, "Cloud initial")),
    BASE_TIME,
  );

  store.enqueue({
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: "grade-op-local",
    institution_id: INSTITUTION_ID,
    device_id: `teacher:${TEACHER_ID}`,
    actor_profile_id: TEACHER_ID,
    entity_type: "student_grade",
    entity_id: GRADE_ID,
    action: "upsert",
    base_server_version: 1,
    occurred_at: "2026-08-15T05:01:00.000Z",
    payload: {
      operation_type: "grades.score.set",
      institution_id: INSTITUTION_ID,
      evaluation_id: EVALUATION_ID,
      student_id: STUDENT_ID,
      class_id: CLASS_ID,
      subject_id: SUBJECT_ID,
      actor_kind: "teacher",
      score: 13,
      comment: "Local",
      updated_by: TEACHER_ID,
      captured_at_device: "2026-08-15T05:01:00.000Z",
    },
  });

  return { db, store };
}

function remotePayload(score: number, comment: string) {
  return {
    id: GRADE_ID,
    institution_id: INSTITUTION_ID,
    evaluation_id: EVALUATION_ID,
    student_id: STUDENT_ID,
    score,
    comment,
    updated_by: TEACHER_ID,
    updated_at: "2026-08-15T05:02:00.000Z",
  };
}

function cloudResponse(
  operationId: string,
  acknowledgement: Record<string, unknown>,
) {
  return new Response(JSON.stringify({
    protocol_version: 1,
    institution_id: INSTITUTION_ID,
    device_id: DEVICE_ID,
    server_time: "2026-08-15T05:02:00.000Z",
    acknowledgements: [{ operation_id: operationId, ...acknowledgement }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function unresolvedConflict(db: ReturnType<typeof openRelayDatabase>) {
  return db.prepare(`
    SELECT id,operation_id,remote_server_version,resolution,resolved_at
    FROM sync_conflicts
    WHERE institution_id = ? AND entity_type = 'student_grade'
      AND entity_id = ? AND resolved_at IS NULL
    ORDER BY detected_at DESC
    LIMIT 1
  `).get(INSTITUTION_ID, GRADE_ID) as {
    id: string;
    operation_id: string;
    remote_server_version: number;
    resolution: string | null;
    resolved_at: string | null;
  } | undefined;
}

test("LOT4A: un ACK versionné met à jour la version locale et nettoie local_dirty", async () => {
  const { db, store } = setup();
  const result = await syncRelayOnce(config(), store, {
    now: () => new Date("2026-08-15T05:02:00.000Z"),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const operation = body.operations[0];
      assert.equal(operation.base_server_version, 1);
      return cloudResponse(operation.operation_id, {
        status: "acknowledged",
        http_status: 200,
        cloud_entity_id: GRADE_ID,
        cloud_server_version: 2,
      });
    },
  });

  assert.equal(result.acknowledged_operations, 1);
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get() as any).count),
    0,
  );
  const grade = db.prepare(`
    SELECT score,server_version,deleted_at FROM student_grades
    WHERE institution_id = ? AND id = ?
  `).get(INSTITUTION_ID, GRADE_ID) as any;
  assert.equal(grade.score, 13);
  assert.equal(grade.server_version, 2);
  assert.equal(grade.deleted_at, null);
  const record = db.prepare(`
    SELECT server_version,local_dirty FROM sync_records
    WHERE institution_id = ? AND entity_type = 'student_grade' AND entity_id = ?
  `).get(INSTITUTION_ID, GRADE_ID) as any;
  assert.deepEqual(
    { server_version: record.server_version, local_dirty: record.local_dirty },
    { server_version: 2, local_dirty: 0 },
  );
  db.close();
});

test("LOT4A: keep_local rebase l'intention avec un nouvel operation_id", async () => {
  const { db, store } = setup();
  let call = 0;
  let rebasedOperationId = "";
  const fetchImpl: typeof fetch = async (_url, init) => {
    call += 1;
    const body = JSON.parse(String(init?.body || "{}"));
    const operation = body.operations[0];
    if (call === 1) {
      assert.equal(operation.operation_id, "grade-op-local");
      assert.equal(operation.base_server_version, 1);
      return cloudResponse(operation.operation_id, {
        status: "conflict",
        http_status: 409,
        error: "student_grade_version_conflict",
        cloud_entity_id: GRADE_ID,
        cloud_server_version: 2,
        conflict: {
          server_version: 2,
          action: "upsert",
          payload: remotePayload(17, "Cloud concurrent"),
        },
      });
    }
    rebasedOperationId = operation.operation_id;
    assert.notEqual(rebasedOperationId, "grade-op-local");
    assert.match(rebasedOperationId, /^grade-rebase-/);
    assert.equal(operation.base_server_version, 2);
    assert.equal(operation.payload.score, 13);
    return cloudResponse(operation.operation_id, {
      status: "acknowledged",
      http_status: 200,
      cloud_entity_id: GRADE_ID,
      cloud_server_version: 3,
    });
  };

  const first = await syncRelayOnce(config(), store, {
    now: () => new Date("2026-08-15T05:02:00.000Z"),
    fetchImpl,
  });
  assert.equal(first.conflict_operations, 1);
  const conflict = unresolvedConflict(db);
  assert.ok(conflict);
  assert.equal(conflict.operation_id, "grade-op-local");
  assert.equal(conflict.remote_server_version, 2);
  const blocked = db.prepare(`
    SELECT state,base_server_version,last_error FROM sync_outbox
    WHERE operation_id = 'grade-op-local'
  `).get() as any;
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.base_server_version, 1);
  assert.match(String(blocked.last_error), /^sync_conflict:/);

  store.resolveConflict(INSTITUTION_ID, conflict.id, "keep_local", "admin-test");
  const rebasedPending = db.prepare(`
    SELECT state,base_server_version FROM sync_outbox
    WHERE operation_id = 'grade-op-local'
  `).get() as any;
  assert.deepEqual(
    { state: rebasedPending.state, base_server_version: rebasedPending.base_server_version },
    { state: "pending", base_server_version: 2 },
  );

  const second = await syncRelayOnce(config(), store, {
    now: () => new Date("2026-08-15T05:03:00.000Z"),
    fetchImpl,
  });
  assert.equal(second.acknowledged_operations, 1);
  assert.ok(rebasedOperationId);
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get() as any).count),
    0,
  );
  const grade = db.prepare(`
    SELECT score,server_version FROM student_grades
    WHERE institution_id = ? AND id = ?
  `).get(INSTITUTION_ID, GRADE_ID) as any;
  assert.deepEqual(
    { score: grade.score, server_version: grade.server_version },
    { score: 13, server_version: 3 },
  );
  const oldConflict = db.prepare(`
    SELECT resolution,resolved_at FROM sync_conflicts WHERE id = ?
  `).get(conflict.id) as any;
  assert.equal(oldConflict.resolution, "keep_local");
  assert.ok(oldConflict.resolved_at);
  db.close();
});

test("LOT4A: accept_remote remplace la note locale et retire l'opération", async () => {
  const { db, store } = setup();
  const result = await syncRelayOnce(config(), store, {
    now: () => new Date("2026-08-15T05:02:00.000Z"),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const operation = body.operations[0];
      return cloudResponse(operation.operation_id, {
        status: "conflict",
        http_status: 409,
        error: "student_grade_version_conflict",
        cloud_entity_id: GRADE_ID,
        cloud_server_version: 2,
        conflict: {
          server_version: 2,
          action: "upsert",
          payload: remotePayload(17, "Cloud concurrent"),
        },
      });
    },
  });
  assert.equal(result.conflict_operations, 1);
  const conflict = unresolvedConflict(db);
  assert.ok(conflict);

  store.resolveConflict(INSTITUTION_ID, conflict.id, "accept_remote", "admin-test");
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get() as any).count),
    0,
  );
  const grade = db.prepare(`
    SELECT score,comment,server_version,deleted_at FROM student_grades
    WHERE institution_id = ? AND id = ?
  `).get(INSTITUTION_ID, GRADE_ID) as any;
  assert.deepEqual(
    {
      score: grade.score,
      comment: grade.comment,
      server_version: grade.server_version,
      deleted_at: grade.deleted_at,
    },
    {
      score: 17,
      comment: "Cloud concurrent",
      server_version: 2,
      deleted_at: null,
    },
  );
  const record = db.prepare(`
    SELECT server_version,local_dirty FROM sync_records
    WHERE institution_id = ? AND entity_type = 'student_grade' AND entity_id = ?
  `).get(INSTITUTION_ID, GRADE_ID) as any;
  assert.deepEqual(
    { server_version: record.server_version, local_dirty: record.local_dirty },
    { server_version: 2, local_dirty: 0 },
  );
  const resolved = db.prepare(`
    SELECT resolution,resolved_at FROM sync_conflicts WHERE id = ?
  `).get(conflict.id) as any;
  assert.equal(resolved.resolution, "accept_remote");
  assert.ok(resolved.resolved_at);
  db.close();
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceMonitor } from "../src/attendance-monitor.mjs";
import { loadRelayConfig } from "../src/config.mjs";
import { openRelayDatabase } from "../src/db.mjs";
import { RelayStore } from "../src/store.mjs";
import { SYNC_PROTOCOL_VERSION } from "../src/types.mjs";

test("la migration crée le domaine pédagogique sans finance", () => {
  const db = openRelayDatabase(":memory:");
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
  `).all().map((row) => String((row as { name: string }).name));

  assert.ok(tables.includes("teacher_sessions"));
  assert.ok(tables.includes("student_grades"));
  assert.ok(tables.includes("textbook_sessions"));
  assert.ok(tables.includes("sync_outbox"));
  assert.equal(tables.some((name) => /finance|payment|payroll|cash/i.test(name)), false);
  assert.equal(Number(db.pragma("foreign_keys", { simple: true })), 1);
  db.close();
});

test("un même operation_id est idempotent et ne peut pas changer de contenu", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.ensureInstitution("inst-1", "Collège test");
  const operation = {
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: "op-1",
    institution_id: "inst-1",
    device_id: "device-1",
    actor_profile_id: "teacher-1",
    entity_type: "attendance_mark",
    entity_id: "mark-1",
    action: "upsert",
    base_server_version: 2,
    occurred_at: "2026-07-17T10:00:00.000Z",
    payload: { status: "absent", student_id: "student-1" },
  } as const;

  assert.deepEqual(store.enqueue(operation), { operation_id: "op-1", inserted: true });
  assert.deepEqual(store.enqueue(operation), { operation_id: "op-1", inserted: false });
  assert.throws(
    () => store.enqueue({ ...operation, payload: { status: "present" } }),
    /operation_id_reused_with_different_payload/,
  );
  assert.equal(store.status().pending_operations, 1);
  db.close();
});

test("un changement distant concurrent est bloqué comme conflit visible", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.ensureInstitution("inst-1", "Collège test");
  store.enqueue({
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: "grade-op-1",
    institution_id: "inst-1",
    device_id: "device-1",
    entity_type: "student_grade",
    entity_id: "grade-1",
    action: "upsert",
    base_server_version: 4,
    occurred_at: "2026-07-17T10:00:00.000Z",
    payload: { score: 14 },
  });

  const event = {
    protocol_version: SYNC_PROTOCOL_VERSION,
    event_id: "event-9",
    institution_id: "inst-1",
    entity_type: "student_grade",
    entity_id: "grade-1",
    action: "upsert",
    server_version: 5,
    occurred_at: "2026-07-17T10:00:01.000Z",
    payload: { score: 16 },
  } as const;
  const result = store.applyRemote(event);
  assert.equal(result.status, "conflict");
  assert.equal(store.status().blocked_operations, 1);
  assert.equal(store.status().unresolved_conflicts, 1);
  assert.deepEqual(store.applyRemote(event), { event_id: "event-9", status: "duplicate" });

  if (result.status === "conflict") {
    store.resolveConflict(result.conflict_id, "keep_local", "admin-1");
  }
  assert.equal(store.status().blocked_operations, 0);
  assert.equal(store.status().pending_operations, 1);
  assert.equal(store.status().unresolved_conflicts, 0);
  db.close();
});

test("un événement identique acquitte une opération dont la réponse réseau a été perdue", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.ensureInstitution("inst-1", "Collège test");
  store.enqueue({
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: "textbook-op-1",
    institution_id: "inst-1",
    device_id: "device-1",
    entity_type: "textbook_session",
    entity_id: "session-1",
    action: "upsert",
    base_server_version: 0,
    occurred_at: "2026-07-17T10:00:00.000Z",
    payload: { client_session_id: "client-1", content: "Leçon" },
  });
  const applied = store.applyRemote({
    protocol_version: SYNC_PROTOCOL_VERSION,
    event_id: "textbook-event-1",
    institution_id: "inst-1",
    entity_type: "textbook_session",
    entity_id: "session-1",
    action: "upsert",
    server_version: 1,
    occurred_at: "2026-07-17T10:00:02.000Z",
    payload: { content: "Leçon", client_session_id: "client-1" },
  });
  assert.deepEqual(applied, { event_id: "textbook-event-1", status: "applied" });
  assert.equal(store.status().pending_operations, 0);
  assert.equal(store.status().unresolved_conflicts, 0);
  db.close();
});

test("le contrôle des appels fonctionne depuis SQLite sans Internet", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const now = "2026-07-14T12:00:00.000Z";
  store.ensureInstitution("inst-1", "Collège test", now);

  db.prepare(`INSERT INTO classes(id,institution_id,academic_year,label,updated_at)
              VALUES ('class-1','inst-1','2026-2027','4e A',?)`).run(now);
  db.prepare(`INSERT INTO subjects(id,institution_id,name,updated_at)
              VALUES ('math','inst-1','Mathématiques',?)`).run(now);
  for (const [id, name] of [["t1", "Mme Un"], ["t2", "M. Deux"], ["t3", "Mme Trois"]]) {
    db.prepare(`INSERT INTO profiles(id,institution_id,display_name,updated_at)
                VALUES (?, 'inst-1', ?, ?)`).run(id, name, now);
  }
  db.prepare(`
    INSERT INTO institution_periods(id,institution_id,weekday,label,start_time,end_time,updated_at)
    VALUES ('p1','inst-1',1,'Cours 1','08:00:00','09:00:00',?)
  `).run(now);
  for (const teacher of ["t1", "t2", "t3"]) {
    db.prepare(`
      INSERT INTO teacher_timetables(
        id,institution_id,class_id,subject_id,teacher_id,period_id,weekday,updated_at
      ) VALUES (?, 'inst-1', 'class-1', 'math', ?, 'p1', 1, ?)
    `).run(`tt-${teacher}`, teacher, now);
  }
  db.prepare(`
    INSERT INTO teacher_sessions(
      id,institution_id,class_id,subject_id,teacher_id,period_id,started_at,
      actual_call_at,origin,updated_at
    ) VALUES ('session-1','inst-1','class-1','math','t1','p1',
              '2026-07-13T08:00:00.000Z','2026-07-13T08:20:00.000Z','teacher',?)
  `).run(now);
  db.prepare(`
    INSERT INTO teacher_absence_requests(
      id,institution_id,teacher_id,start_date,end_date,status,reason_label,updated_at
    ) VALUES ('absence-1','inst-1','t2','2026-07-13','2026-07-13',
              'approved','Autorisation',?)
  `).run(now);

  const rows = attendanceMonitor(db, {
    institutionId: "inst-1",
    from: "2026-07-13",
    to: "2026-07-13",
    now: new Date(now),
  });
  assert.deepEqual(
    rows.map((row) => [row.teacher_name, row.status, row.late_minutes]),
    [
      ["Mme Un", "late", 20],
      ["M. Deux", "justified_absence", null],
      ["Mme Trois", "missing", null],
    ],
  );
  db.close();
});

test("une écoute LAN est refusée sans jeton", () => {
  assert.throws(
    () => loadRelayConfig({ MONCAHIER_RELAY_HOST: "0.0.0.0" }),
    /MONCAHIER_RELAY_TOKEN_required_for_lan/,
  );
  assert.equal(
    loadRelayConfig({ MONCAHIER_RELAY_HOST: "0.0.0.0", MONCAHIER_RELAY_TOKEN: "secret" }).host,
    "0.0.0.0",
  );
});

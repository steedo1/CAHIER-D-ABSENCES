import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { adminDashboard } from "../src/admin-dashboard.mjs";
import { attendanceMonitor } from "../src/attendance-monitor.mjs";
import { founderAttendanceSlots } from "../src/attendance-slots.mjs";
import { issueAttendancePresenceProof } from "../src/presence-proof.mjs";
import { loadRelayConfig } from "../src/config.mjs";
import { openRelayDatabase } from "../src/db.mjs";
import { createRelayServer } from "../src/server.mjs";
import { RelayStore } from "../src/store.mjs";
import { SYNC_PROTOCOL_VERSION } from "../src/types.mjs";

function attendanceRelayAccessToken(secret: string, actorProfileId: string, now: Date) {
  const payload = {
    v: 1,
    purpose: "attendance_relay_access",
    institution_id: "inst-1",
    actor_profile_id: actorProfileId,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

test("la migration crée le domaine pédagogique sans finance", () => {
  const db = openRelayDatabase(":memory:");
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
  `).all().map((row) => String((row as { name: string }).name));

  assert.ok(tables.includes("teacher_sessions"));
  assert.ok(tables.includes("student_grades"));
  assert.ok(tables.includes("textbook_sessions"));
  assert.ok(tables.includes("sync_outbox"));
  assert.ok(tables.includes("sync_bootstrap_runs"));
  assert.ok(tables.includes("sync_materialization_failures"));
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

test("le relais signe une preuve de présence liée au compte enseignant et à la séance", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const snapshot = bootstrapFixture("snapshot-presence", "Mme Présente") as any;
  const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const now = new Date("2026-07-13T08:05:00.000Z");
  snapshot.institution.settings_json = {
    attendance_presence: {
      enabled: true,
      allow_local_relay: true,
      relay_presence_secret: secret,
      relay_proof_ttl_seconds: 180,
    },
  };
  store.bootstrap(snapshot);

  const result = issueAttendancePresenceProof(
    db,
    {
      institution_id: "inst-1",
      actor_profile_id: "teacher-1",
      client_session_id: "class-1_math_2026-07-13T08:00:00.000Z",
      access_token: attendanceRelayAccessToken(secret, "teacher-1", now),
    },
    now,
  );
  assert.equal(result.ok, true);
  assert.equal(result.method, "local_relay");
  assert.equal(result.proof.split(".").length, 2);
  const payload = JSON.parse(
    Buffer.from(result.proof.split(".")[0] || "", "base64url").toString("utf8"),
  ) as any;
  assert.equal(payload.institution_id, "inst-1");
  assert.equal(payload.actor_profile_id, "teacher-1");
  assert.equal(payload.client_session_id, "class-1_math_2026-07-13T08:00:00.000Z");
  assert.throws(
    () => issueAttendancePresenceProof(db, {
      institution_id: "inst-1",
      actor_profile_id: "teacher-inconnu",
      client_session_id: "session-2",
      access_token: attendanceRelayAccessToken(secret, "teacher-inconnu", now),
    }, now),
    /teacher_not_paired_with_relay/,
  );
  assert.throws(
    () => issueAttendancePresenceProof(db, {
      institution_id: "inst-1",
      actor_profile_id: "teacher-1",
      client_session_id: "session-3",
      access_token: `${attendanceRelayAccessToken(secret, "teacher-1", now)}corrompu`,
    }, now),
    /relay_access_token_signature_invalid/,
  );
  db.close();
});


test("le bootstrap Cloud peuple SQLite et le dashboard Admin local", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const snapshot = bootstrapFixture("snapshot-1", "Mme Cloud");

  const result = store.bootstrap(snapshot);
  assert.equal(result.status, "applied");
  assert.equal(result.imported_entities, 9);
  assert.deepEqual(store.bootstrap(snapshot), { ...result, status: "duplicate" });

  const dashboard = adminDashboard(db, {
    institutionId: "inst-1",
    date: "2026-07-13",
    now: new Date("2026-07-13T12:00:00.000Z"),
  });
  assert.equal(dashboard.source, "relay");
  assert.equal(dashboard.institution.name, "Collège local");
  assert.equal(dashboard.counts.classes, 1);
  assert.equal(dashboard.counts.teachers, 1);
  assert.equal(dashboard.attendance.late, 1);
  assert.equal(dashboard.attendance_rows[0]?.teacher_name, "Mme Cloud");
  assert.equal(dashboard.sync.last_cloud_sync_at, "2026-07-13T12:00:00.000Z");
  db.close();
});

test("un événement distant met réellement à jour la table pédagogique", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.bootstrap(bootstrapFixture("snapshot-1", "Mme Initiale"));

  store.applyRemote({
    protocol_version: SYNC_PROTOCOL_VERSION,
    event_id: "profile-event-2",
    institution_id: "inst-1",
    entity_type: "profile",
    entity_id: "teacher-1",
    action: "upsert",
    server_version: 2,
    occurred_at: "2026-07-13T12:05:00.000Z",
    payload: {
      display_name: "Mme Synchronisée",
      email: "teacher@example.test",
      phone: null,
      is_active: true,
    },
  });

  const row = db.prepare("SELECT display_name, server_version FROM profiles WHERE id = 'teacher-1'")
    .get() as { display_name: string; server_version: number };
  assert.deepEqual(row, { display_name: "Mme Synchronisée", server_version: 2 });
  assert.equal(store.status().materialization_failures, 0);
  db.close();
});

test("un bootstrap ultérieur protège les modifications locales en attente", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.bootstrap(bootstrapFixture("snapshot-1", "Mme Cloud"));
  store.enqueue({
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: "profile-local-1",
    institution_id: "inst-1",
    device_id: "relay-1",
    actor_profile_id: "admin-1",
    entity_type: "profile",
    entity_id: "teacher-1",
    action: "upsert",
    base_server_version: 1,
    occurred_at: "2026-07-13T12:10:00.000Z",
    payload: {
      display_name: "Mme Locale",
      email: "teacher@example.test",
      phone: null,
      is_active: true,
    },
  });

  const second = store.bootstrap(bootstrapFixture("snapshot-2", "Mme Cloud Nouvelle", 2));
  assert.equal(second.preserved_local_entities, 1);
  const row = db.prepare("SELECT display_name FROM profiles WHERE id = 'teacher-1'")
    .get() as { display_name: string };
  assert.equal(row.display_name, "Mme Locale");
  assert.equal(store.status().pending_operations, 1);
  db.close();
});

test("le bootstrap refuse explicitement toute collection financière", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const snapshot = bootstrapFixture("snapshot-finance", "Mme Cloud") as any;
  snapshot.entities.finance_receipts = [];
  assert.throws(() => store.bootstrap(snapshot), /forbidden_collection:finance_receipts/);
  db.close();
});



test("la vue Founder locale classe le créneau courant depuis SQLite", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.bootstrap(bootstrapFixture("snapshot-founder", "Mme Locale"));
  const payload = founderAttendanceSlots(db, {
    institutionId: "inst-1",
    now: new Date("2026-07-13T08:30:00.000Z"),
  });
  assert.equal(payload.source, "relay");
  assert.equal(payload.totals.activeSchools, 1);
  assert.equal(payload.totals.expected, 1);
  assert.equal(payload.totals.present, 1);
  assert.equal(payload.rows[0]?.periodState, "current");
  db.close();
});

test("le relais autorise le prévol navigateur et l'accès réseau local", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const server = createRelayServer({
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "secret-local",
  }, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/status`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://mon-cahier.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://mon-cahier.com");
    assert.equal(response.headers.get("access-control-allow-private-network"), "true");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});

test("l'API de présence accepte uniquement l'accès enseignant signé sans exposer le jeton Admin", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const secret = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  const snapshot = bootstrapFixture("snapshot-presence-api", "Mme API Présence") as any;
  snapshot.institution.settings_json = {
    attendance_presence: {
      enabled: true,
      allow_local_relay: true,
      relay_presence_secret: secret,
      relay_proof_ttl_seconds: 180,
    },
  };
  store.bootstrap(snapshot);
  const server = createRelayServer({
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "secret-admin-local",
  }, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const now = new Date();
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/attendance/presence-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        institution_id: "inst-1",
        actor_profile_id: "teacher-1",
        client_session_id: "session-api-1",
        access_token: attendanceRelayAccessToken(secret, "teacher-1", now),
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.method, "local_relay");

    const refused = await fetch(`http://127.0.0.1:${address.port}/v1/attendance/presence-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        institution_id: "inst-1",
        actor_profile_id: "teacher-1",
        client_session_id: "session-api-2",
        access_token: "jeton-invalide",
      }),
    });
    assert.equal(refused.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});

test("l'API locale expose le dashboard Admin protégé par le jeton", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.bootstrap(bootstrapFixture("snapshot-api", "Mme API"));
  const server = createRelayServer({
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "secret-local",
  }, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/v1/admin/dashboard?institution_id=inst-1&date=2026-07-13`;
    const unauthorized = await fetch(url);
    assert.equal(unauthorized.status, 401);
    const response = await fetch(url, {
      headers: { Authorization: "Bearer secret-local" },
    });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.source, "relay");
    assert.equal(body.counts.teachers, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});

function bootstrapFixture(snapshotId: string, teacherName: string, version = 1) {
  const generatedAt = "2026-07-13T12:00:00.000Z";
  return {
    protocol_version: SYNC_PROTOCOL_VERSION,
    snapshot_id: snapshotId,
    institution_id: "inst-1",
    generated_at: generatedAt,
    cursor: `cursor-${snapshotId}`,
    institution: {
      id: "inst-1",
      name: "Collège local",
      code: "LOCAL",
      timezone: "Africa/Abidjan",
      settings_json: {},
      server_version: version,
      updated_at: generatedAt,
    },
    entities: {
      academic_years: [{
        id: "year-1",
        institution_id: "inst-1",
        code: "2026-2027",
        label: "2026-2027",
        start_date: "2026-09-01",
        end_date: "2027-07-31",
        is_current: true,
        server_version: version,
        updated_at: generatedAt,
      }],
      profiles: [{
        id: "teacher-1",
        institution_id: "inst-1",
        display_name: teacherName,
        email: "teacher@example.test",
        phone: null,
        is_active: true,
        server_version: version,
        updated_at: generatedAt,
      }],
      user_roles: [{
        id: "role-1",
        institution_id: "inst-1",
        profile_id: "teacher-1",
        role: "teacher",
        server_version: version,
        updated_at: generatedAt,
      }],
      classes: [{
        id: "class-1",
        institution_id: "inst-1",
        academic_year: "2026-2027",
        label: "4e A",
        level: "4e",
        server_version: version,
        updated_at: generatedAt,
      }],
      subjects: [{
        id: "subject-1",
        institution_id: "inst-1",
        base_subject_id: null,
        name: "Mathématiques",
        short_name: "MATH",
        server_version: version,
        updated_at: generatedAt,
      }],
      institution_periods: [{
        id: "period-1",
        institution_id: "inst-1",
        weekday: 1,
        label: "Cours 1",
        start_time: "08:00:00",
        end_time: "09:00:00",
        server_version: version,
        updated_at: generatedAt,
      }],
      teacher_timetables: [{
        id: "timetable-1",
        institution_id: "inst-1",
        academic_year: "2026-2027",
        class_id: "class-1",
        subject_id: "subject-1",
        teacher_id: "teacher-1",
        period_id: "period-1",
        weekday: 1,
        server_version: version,
        updated_at: generatedAt,
      }],
      teacher_sessions: [{
        id: "session-1",
        institution_id: "inst-1",
        client_session_id: "client-session-1",
        class_id: "class-1",
        subject_id: "subject-1",
        teacher_id: "teacher-1",
        period_id: "period-1",
        started_at: "2026-07-13T08:20:00.000Z",
        actual_call_at: "2026-07-13T08:20:00.000Z",
        ended_at: null,
        origin: "teacher",
        server_version: version,
        updated_at: generatedAt,
      }],
    },
  } as const;
}

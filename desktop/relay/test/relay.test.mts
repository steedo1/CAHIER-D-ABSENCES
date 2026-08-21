import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { adminDashboard } from "../src/admin-dashboard.mjs";
import { attendanceMonitor } from "../src/attendance-monitor.mjs";
import { founderAttendanceSlots } from "../src/attendance-slots.mjs";
import { issueAttendancePresenceProof } from "../src/presence-proof.mjs";
import { loadRelayConfig } from "../src/config.mjs";
import { openRelayDatabase, schemaVersion } from "../src/db.mjs";
import { materializeEntity } from "../src/entity-materializer.mjs";
import { createRelayServer } from "../src/server.mjs";
import { configureRelay } from "../src/setup.mjs";
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
    store.resolveConflict("inst-1", result.conflict_id, "keep_local", "admin-1");
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

test("l'écriture locale des notes est une capacité explicite, inactive par défaut", () => {
  assert.equal(loadRelayConfig({}).gradeScoreWritesEnabled, false);
  assert.equal(
    loadRelayConfig({
      MONCAHIER_RELAY_GRADE_SCORE_WRITES_ENABLED: "true",
    }).gradeScoreWritesEnabled,
    true,
  );
});

test("l'assistant conserve l'école unique ou ajoute explicitement un groupe scolaire", () => {
  const root = mkdtempSync(join(tmpdir(), "moncahier-relay-setup-"));
  const configPath = join(root, "MonCahier", "Relay", "config.json");
  try {
    const first = configureRelay({
      institutionCode: "LMA-000101",
      institutionName: "COLLEGE NOTRE-DAME",
      configPath,
      env: {},
    });
    assert.equal(first.token.length >= 32, true);
    assert.equal(first.token_reused, false);
    assert.match(first.database_path, /lma-000101\.db$/);

    const loaded = loadRelayConfig({ MONCAHIER_RELAY_CONFIG: configPath });
    assert.equal(loaded.host, "0.0.0.0");
    assert.equal(loaded.port, 4317);
    assert.equal(loaded.token, first.token);
    assert.equal(loaded.institutionCode, "LMA-000101");
    assert.equal(loaded.institutionName, "COLLEGE NOTRE-DAME");
    assert.deepEqual(loaded.institutionCodes, ["LMA-000101"]);
    assert.equal(loaded.databasePath, first.database_path);
    assert.equal(loaded.mdnsEnabled, true);
    assert.equal(loaded.mdnsHostname, "moncahier-relay-lma-000101");
    assert.equal(loaded.mdnsUrl, "http://moncahier-relay-lma-000101.local:4317");
    assert.equal(first.lan_hostname, "moncahier-relay-lma-000101.local");
    assert.equal(first.lan_url, "http://moncahier-relay-lma-000101.local:4317");
    assert.deepEqual(loaded.allowedOrigins?.slice(0, 2), [
      "https://mon-cahier.com",
      "https://www.mon-cahier.com",
    ]);

    const second = configureRelay({
      institutionCode: "LMA-000101",
      institutionName: "COLLEGE NOTRE-DAME",
      configPath,
      env: {},
    });
    assert.equal(second.token_reused, true);
    assert.equal(second.token, first.token);
    assert.equal(second.database_path, first.database_path);

    const schoolGroup = configureRelay({
      institutionCode: "PRI-000202",
      institutionName: "ECOLE PRIMAIRE NOTRE-DAME",
      configPath,
      addInstitution: true,
      env: {},
    });
    assert.equal(schoolGroup.mode, "school_group");
    assert.equal(schoolGroup.token_reused, false);
    assert.notEqual(schoolGroup.token, first.token);
    assert.equal(schoolGroup.database_path, first.database_path);
    assert.deepEqual(
      schoolGroup.institutions.map((item) => item.code),
      ["LMA-000101", "PRI-000202"],
    );

    const loadedGroup = loadRelayConfig({ MONCAHIER_RELAY_CONFIG: configPath });
    assert.deepEqual(loadedGroup.institutionCodes, ["LMA-000101", "PRI-000202"]);
    assert.notEqual(loadedGroup.token, first.token);
    assert.notEqual(loadedGroup.token, schoolGroup.token);
    assert.equal(loadedGroup.institutions?.[0]?.admin_token, first.token);
    assert.equal(loadedGroup.institutions?.[1]?.admin_token, schoolGroup.token);

    const otherSchool = configureRelay({
      institutionCode: "TEST-000002",
      institutionName: "Autre établissement",
      configPath,
      env: {},
    });
    assert.equal(otherSchool.token_reused, false);
    assert.notEqual(otherSchool.token, first.token);
    assert.match(otherSchool.database_path, /test-000002\.db$/);
    assert.notEqual(otherSchool.database_path, first.database_path);

    const file = JSON.parse(readFileSync(configPath, "utf8")) as any;
    assert.equal(file.version, 4);
    assert.equal(file.institution_code, "TEST-000002");
    assert.deepEqual(file.institutions.map((item: any) => item.code), ["TEST-000002"]);
    assert.equal(file.database_path, otherSchool.database_path);
    assert.equal(file.mdns_enabled, true);
    assert.equal(file.mdns_hostname, "moncahier-relay-test-000002");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  const result = store.bootstrap(snapshot);
  assert.equal(result.status, "partial");
  assert.equal(result.imported_entities, 9);
  assert.equal(result.rejected_entities, 1);
  assert.deepEqual(result.diagnostics[0], {
    collection: "finance_receipts",
    entity_id: "<row:0>",
    institution_id: "inst-1",
    reason: "forbidden_collection",
  });
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS count FROM profiles WHERE institution_id = 'inst-1'")
      .get() as { count: number }).count),
    1,
  );
  db.close();
});

test("le bootstrap multi-écoles refuse une dépendance orpheline et conserve son diagnostic source", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const invalid = bootstrapFixture("snapshot-orphan", "Mme Orpheline") as any;
  invalid.entities.teacher_timetables[0].subject_id = "subject-from-another-school";

  const orphan = store.bootstrap(invalid);
  assert.equal(orphan.status, "partial");
  assert.equal(orphan.imported_entities, 8);
  assert.equal(orphan.deferred_entities, 1);
  assert.equal(orphan.rejected_entities, 1);
  assert.ok(orphan.diagnostics.some((diagnostic) =>
    diagnostic.collection === "teacher_timetables" &&
    diagnostic.entity_id === "timetable-1" &&
    diagnostic.institution_id === "inst-1" &&
    diagnostic.dependency_type === "subject_id" &&
    diagnostic.dependency_id === "subject-from-another-school"
  ));
  assert.equal(store.status().institution_count, 1);

  const valid = bootstrapFixture("snapshot-diagnostic", "Mme Diagnostiquée") as any;
  valid.diagnostics = {
    skipped_count: 1,
    skipped: [{
      collection: "teacher_sessions",
      entity_id: "session-externe",
      field: "subject_id",
      reference_id: "subject-from-another-school",
    }],
  };
  const result = store.bootstrap(valid);
  assert.equal(result.source_skipped_entities, 1);
  assert.deepEqual(result.source_diagnostics, valid.diagnostics);

  const run = db.prepare(`
    SELECT source_skipped_entities, source_diagnostics_json
    FROM sync_bootstrap_runs
    WHERE snapshot_id = 'snapshot-diagnostic'
  `).get() as { source_skipped_entities: number; source_diagnostics_json: string };
  assert.equal(run.source_skipped_entities, 1);
  assert.deepEqual(JSON.parse(run.source_diagnostics_json), valid.diagnostics);
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

test("un relais Notre Dame refuse un bootstrap provenant d'un autre établissement", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const server = createRelayServer({
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "secret-local",
    institutionCode: "LMA-000101",
  }, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const wrongSchool = bootstrapFixture("snapshot-wrong-school", "Mme CSCA") as any;
    wrongSchool.institution.code = "CSK-000657";
    const refused = await fetch(`http://127.0.0.1:${address.port}/v1/sync/bootstrap`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-local",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(wrongSchool),
    });
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), { error: "bootstrap_institution_code_mismatch" });
    assert.equal(store.status().institution_count, 0);

    const notreDame = bootstrapFixture("snapshot-notre-dame", "M. KOUADIO") as any;
    notreDame.institution.code = "LMA-000101";
    const accepted = await fetch(`http://127.0.0.1:${address.port}/v1/sync/bootstrap`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-local",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(notreDame),
    });
    assert.equal(accepted.status, 200);
    assert.equal(store.status().institution_count, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});

test("un relais de groupe accepte deux écoles autorisées et garde leurs états isolés", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const server = createRelayServer({
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "secret-maitre-groupe",
    institutions: [
      { code: "SEC-000101", name: "Secondaire", admin_token: "secret-secondaire" },
      { code: "PRI-000202", name: "Primaire", admin_token: "secret-primaire" },
    ],
    institutionCodes: ["SEC-000101", "PRI-000202"],
  }, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const relayUrl = `http://127.0.0.1:${address.port}`;
    const send = (snapshot: unknown, token: string) => fetch(`${relayUrl}/v1/sync/bootstrap`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(snapshot),
    });

    const secondary = bootstrapFixture("snapshot-secondary", "Mme Secondaire") as any;
    secondary.institution.code = "SEC-000101";
    const primary = bootstrapFixtureForSchool({
      snapshotId: "snapshot-primary",
      teacherName: "M. Primaire",
      institutionId: "inst-2",
      institutionName: "École primaire locale",
      institutionCode: "PRI-000202",
      idSuffix: "2",
    });

    assert.equal((await send(secondary, "secret-secondaire")).status, 200);
    assert.equal((await send(primary, "secret-secondaire")).status, 401);
    assert.equal((await send(primary, "secret-primaire")).status, 200);

    const unlisted = bootstrapFixtureForSchool({
      snapshotId: "snapshot-unlisted",
      teacherName: "Mme Externe",
      institutionId: "inst-3",
      institutionName: "École externe",
      institutionCode: "EXT-000303",
      idSuffix: "3",
    });
    const refused = await send(unlisted, "secret-maitre-groupe");
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), { error: "bootstrap_institution_code_mismatch" });

    store.enqueue({
      protocol_version: SYNC_PROTOCOL_VERSION,
      operation_id: "group-operation-1",
      institution_id: "inst-1",
      device_id: "relay-group-1",
      actor_profile_id: "teacher-1",
      entity_type: "profile",
      entity_id: "teacher-1",
      action: "upsert",
      base_server_version: 1,
      occurred_at: "2026-07-13T12:10:00.000Z",
      payload: {
        display_name: "Mme Secondaire locale",
        email: "teacher@example.test",
        phone: null,
        is_active: true,
      },
    });

    const status = store.status();
    assert.equal(status.institution_count, 2);
    assert.equal(status.institutions.length, 2);
    assert.equal(
      status.institutions.find((item) => item.institution_id === "inst-1")?.pending_operations,
      1,
    );
    assert.equal(
      status.institutions.find((item) => item.institution_id === "inst-2")?.pending_operations,
      0,
    );
    const secondaryDevice = store.getOrCreateRelayDevice("inst-1");
    const primaryDevice = store.getOrCreateRelayDevice("inst-2");
    assert.notEqual(secondaryDevice, primaryDevice);
    assert.equal(store.getOrCreateRelayDevice("inst-1"), secondaryDevice);
    assert.equal(store.getOrCreateRelayDevice("inst-2"), primaryDevice);

    const primaryDashboardUrl =
      `${relayUrl}/v1/admin/dashboard?institution_id=inst-2&date=2026-07-13`;
    const crossSchoolRead = await fetch(primaryDashboardUrl, {
      headers: { Authorization: "Bearer secret-secondaire" },
    });
    assert.equal(crossSchoolRead.status, 401);
    const ownSchoolRead = await fetch(primaryDashboardUrl, {
      headers: { Authorization: "Bearer secret-primaire" },
    });
    assert.equal(ownSchoolRead.status, 200);

    const schoolCannotReadGlobalStatus = await fetch(`${relayUrl}/v1/status`, {
      headers: { Authorization: "Bearer secret-primaire" },
    });
    assert.equal(schoolCannotReadGlobalStatus.status, 401);
    const groupStatus = await fetch(`${relayUrl}/v1/status`, {
      headers: { Authorization: "Bearer secret-maitre-groupe" },
    });
    assert.equal(groupStatus.status, 200);
    assert.equal(
      adminDashboard(db, { institutionId: "inst-1", date: "2026-07-13" }).counts.teachers,
      1,
    );
    assert.equal(
      adminDashboard(db, { institutionId: "inst-2", date: "2026-07-13" }).counts.teachers,
      1,
    );
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

test("le bootstrap conserve les données valides quand un professeur est absent", () => {
  const db = openRelayDatabase(":memory:");
  const snapshot = mutableFixture("snapshot-missing-teacher", "Mme Valide");
  snapshot.entities.teacher_timetables[0].teacher_id = "teacher-missing";
  const result = new RelayStore(db).bootstrap(snapshot);
  assertBootstrapDependency(result, "teacher_timetables", "timetable-1", "teacher_id", "teacher-missing");
  assert.equal(countRows(db, "classes", "inst-1"), 1);
  db.close();
});

test("le bootstrap conserve les données valides quand une classe est absente", () => {
  const db = openRelayDatabase(":memory:");
  const snapshot = mutableFixture("snapshot-missing-class", "Mme Valide");
  snapshot.entities.teacher_timetables[0].class_id = "class-missing";
  const result = new RelayStore(db).bootstrap(snapshot);
  assertBootstrapDependency(result, "teacher_timetables", "timetable-1", "class_id", "class-missing");
  assert.equal(countRows(db, "profiles", "inst-1"), 1);
  db.close();
});

test("le bootstrap diagnostique précisément un élève absent", () => {
  const db = openRelayDatabase(":memory:");
  const snapshot = mutableFixture("snapshot-missing-student", "Mme Valide");
  snapshot.entities.class_enrollments = [{
    id: "enrollment-1",
    institution_id: "inst-1",
    class_id: "class-1",
    student_id: "student-missing",
    start_date: "2026-09-01",
    end_date: null,
    server_version: 1,
    updated_at: snapshot.generated_at,
  }];
  const result = new RelayStore(db).bootstrap(snapshot);
  assertBootstrapDependency(
    result,
    "class_enrollments",
    "enrollment-1",
    "student_id",
    "student-missing",
  );
  assert.equal(countRows(db, "classes", "inst-1"), 1);
  db.close();
});

test("le bootstrap diagnostique précisément un créneau absent", () => {
  const db = openRelayDatabase(":memory:");
  const snapshot = mutableFixture("snapshot-missing-period", "Mme Valide");
  snapshot.entities.teacher_timetables[0].period_id = "period-missing";
  const result = new RelayStore(db).bootstrap(snapshot);
  assertBootstrapDependency(result, "teacher_timetables", "timetable-1", "period_id", "period-missing");
  assert.equal(countRows(db, "subjects", "inst-1"), 1);
  db.close();
});

test("une dépendance reçue plus tard est différée puis matérialisée", () => {
  const db = openRelayDatabase(":memory:");
  const snapshot = mutableFixture("snapshot-deferred", "Mme Différée");
  const entities = snapshot.entities;
  snapshot.entities = {
    teacher_timetables: entities.teacher_timetables,
    teacher_sessions: entities.teacher_sessions,
    user_roles: entities.user_roles,
    academic_years: entities.academic_years,
    profiles: entities.profiles,
    classes: entities.classes,
    subjects: entities.subjects,
    institution_periods: entities.institution_periods,
  };
  const result = new RelayStore(db).bootstrap(snapshot);
  assert.equal(result.status, "applied");
  assert.equal(result.deferred_entities, 3);
  assert.equal(result.rejected_entities, 0);
  assert.equal(countRows(db, "teacher_timetables", "inst-1"), 1);
  assert.equal(countRows(db, "teacher_sessions", "inst-1"), 1);
  db.close();
});

test("une base neuve respecte les clés étrangères et son intégrité", () => {
  const db = openRelayDatabase(":memory:");
  new RelayStore(db).bootstrap(bootstrapFixture("snapshot-integrity", "Mme Intègre"));
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(String(db.pragma("integrity_check", { simple: true })), "ok");
  db.close();
});

test("deux écoles peuvent partager tous leurs identifiants pédagogiques sans collision", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const schoolA = fixtureWithStudent("snapshot-same-a", "inst-1", "ECOLE-A", "Mme A");
  const schoolB = fixtureWithStudent("snapshot-same-b", "inst-2", "ECOLE-B", "Mme B");
  assert.equal(store.bootstrap(schoolA).status, "applied");
  assert.equal(store.bootstrap(schoolB).status, "applied");

  for (const [table, id] of [
    ["profiles", "teacher-1"],
    ["classes", "class-1"],
    ["students", "student-1"],
    ["institution_periods", "period-1"],
    ["teacher_timetables", "timetable-1"],
    ["teacher_sessions", "session-1"],
  ] as const) {
    const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id = ?`)
      .get(id) as { count: number };
    assert.equal(Number(count.count), 2, `${table}:${id}`);
  }

  materializeEntity(db, {
    institutionId: "inst-1",
    entityType: "profile",
    entityId: "teacher-1",
    action: "upsert",
    payload: { display_name: "Mme A modifiée" },
    serverVersion: 2,
    occurredAt: "2026-07-13T13:00:00.000Z",
  });
  assert.equal(profileName(db, "inst-1"), "Mme A modifiée");
  assert.equal(profileName(db, "inst-2"), "Mme B");

  materializeEntity(db, {
    institutionId: "inst-1",
    entityType: "class",
    entityId: "class-1",
    action: "delete",
    payload: null,
    serverVersion: 2,
    occurredAt: "2026-07-13T13:01:00.000Z",
  });
  assert.notEqual(deletedAt(db, "classes", "inst-1", "class-1"), null);
  assert.equal(deletedAt(db, "classes", "inst-2", "class-1"), null);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("operation_id, event_id et accusés de réception restent cloisonnés par école", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.ensureInstitution("inst-1", "École A");
  store.ensureInstitution("inst-2", "École B");
  const payload = { display_name: "Nom local" };
  for (const institutionId of ["inst-1", "inst-2"]) {
    assert.equal(store.enqueue({
      protocol_version: SYNC_PROTOCOL_VERSION,
      operation_id: "operation-shared",
      institution_id: institutionId,
      device_id: "device-shared",
      entity_type: "profile",
      entity_id: "profile-shared",
      action: "upsert",
      base_server_version: 0,
      occurred_at: "2026-07-13T14:00:00.000Z",
      payload,
    }).inserted, true);
  }
  assert.equal(Number((db.prepare(`
    SELECT COUNT(*) AS count FROM sync_outbox WHERE operation_id = 'operation-shared'
  `).get() as { count: number }).count), 2);

  const apply = (institutionId: string) => store.applyRemote({
    protocol_version: SYNC_PROTOCOL_VERSION,
    event_id: "event-shared",
    institution_id: institutionId,
    entity_type: "profile",
    entity_id: "profile-shared",
    action: "upsert",
    server_version: 1,
    occurred_at: "2026-07-13T14:00:01.000Z",
    caused_by_operation_id: "operation-shared",
    payload,
  });
  assert.equal(apply("inst-1").status, "applied");
  assert.equal(pendingOperationCount(db, "inst-1", "operation-shared"), 0);
  assert.equal(pendingOperationCount(db, "inst-2", "operation-shared"), 1);
  assert.equal(apply("inst-2").status, "applied");
  assert.equal(pendingOperationCount(db, "inst-2", "operation-shared"), 0);
  assert.equal(Number((db.prepare(`
    SELECT COUNT(*) AS count FROM sync_inbox WHERE event_id = 'event-shared'
  `).get() as { count: number }).count), 2);
  db.close();
});

test("un bootstrap interrompu et un redémarrage conservent l'outbox locale", () => {
  const root = mkdtempSync(join(tmpdir(), "moncahier-relay-restart-"));
  const databasePath = join(root, "restart.db");
  try {
    let db = openRelayDatabase(databasePath);
    let store = new RelayStore(db);
    store.bootstrap(bootstrapFixture("snapshot-before-restart", "Mme Locale"));
    store.enqueue(profileOperation("operation-survives", "inst-1", "Mme Locale modifiée"));
    const invalid = mutableFixture("snapshot-interrupted", "Mme Cloud");
    invalid.institution.code = "OTHER-SCHOOL";
    assert.throws(() => store.bootstrap(invalid), /bootstrap_institution_identity_conflict/);
    assert.equal(pendingOperationCount(db, "inst-1", "operation-survives"), 1);
    db.close();

    db = openRelayDatabase(databasePath);
    store = new RelayStore(db);
    assert.equal(store.status().pending_operations, 1);
    assert.equal(profileName(db, "inst-1"), "Mme Locale modifiée");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("les diagnostics de bootstrap restent séparés par établissement", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  for (const [institutionId, code] of [
    ["inst-1", "ECOLE-A"],
    ["inst-2", "ECOLE-B"],
  ] as const) {
    const snapshot = sameIdentifiersFixture(`snapshot-diagnostic-${institutionId}`, institutionId, code, code);
    snapshot.entities.teacher_timetables[0].subject_id = `missing-${institutionId}`;
    const result = store.bootstrap(snapshot);
    assert.equal(result.status, "partial");
    assert.ok(result.diagnostics.every((item: any) => item.institution_id === institutionId));
  }
  const runs = db.prepare(`
    SELECT institution_id, diagnostics_json FROM sync_bootstrap_runs ORDER BY institution_id
  `).all() as Array<{ institution_id: string; diagnostics_json: string }>;
  assert.equal(runs.length, 2);
  for (const run of runs) {
    assert.ok((JSON.parse(run.diagnostics_json) as any[])
      .every((item) => item.institution_id === run.institution_id));
  }
  db.close();
});

test("le bootstrap de l'école B ne remplace ni ne supprime l'école A", () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.bootstrap(sameIdentifiersFixture("snapshot-school-a", "inst-1", "ECOLE-A", "Mme A"));
  store.bootstrap(sameIdentifiersFixture("snapshot-school-b", "inst-2", "ECOLE-B", "Mme B"));
  assert.equal(profileName(db, "inst-1"), "Mme A");
  assert.equal(profileName(db, "inst-2"), "Mme B");
  assert.equal(countRows(db, "teacher_timetables", "inst-1"), 1);
  assert.equal(countRows(db, "teacher_timetables", "inst-2"), 1);
  db.close();
});

test("une base schéma 3 peuplée migre atomiquement vers le schéma courant sans rejouer la migration 4", () => {
  const root = mkdtempSync(join(tmpdir(), "moncahier-relay-migration-"));
  const databasePath = join(root, "schema-3.db");
  try {
    const legacy = createSchema3Database(databasePath);
    insertLegacyInstitution(legacy, "inst-legacy", "LEGACY");
    legacy.prepare(`
      INSERT INTO profiles(id, institution_id, display_name, updated_at)
      VALUES ('profile-legacy', 'inst-legacy', 'Mme Legacy', '2026-07-13T12:00:00.000Z')
    `).run();
    legacy.prepare(`
      INSERT INTO sync_outbox(
        operation_id, institution_id, device_id, entity_type, entity_id, action,
        base_server_version, payload_json, occurred_at
      ) VALUES (
        'operation-legacy', 'inst-legacy', 'device-legacy', 'profile', 'profile-legacy',
        'upsert', 0, '{"display_name":"Mme Locale"}', '2026-07-13T12:01:00.000Z'
      )
    `).run();
    legacy.close();

    let db = openRelayDatabase(databasePath);
    assert.equal(schemaVersion(db), 9);
    assert.equal(profileName(db, "inst-legacy", "profile-legacy"), "Mme Legacy");
    assert.equal(pendingOperationCount(db, "inst-legacy", "operation-legacy"), 1);
    assert.deepEqual(primaryKeyColumns(db, "profiles"), ["institution_id", "id"]);
    assert.deepEqual(primaryKeyColumns(db, "sync_outbox"), ["institution_id", "operation_id"]);
    assert.deepEqual(primaryKeyColumns(db, "sync_inbox"), ["institution_id", "event_id"]);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.equal(String(db.pragma("integrity_check", { simple: true })), "ok");
    const appliedAt = String((db.prepare(`
      SELECT applied_at FROM schema_migrations WHERE version = 4
    `).get() as { applied_at: string }).applied_at);
    db.close();

    db = openRelayDatabase(databasePath);
    assert.equal(schemaVersion(db), 9);
    assert.equal(String((db.prepare(`
      SELECT applied_at FROM schema_migrations WHERE version = 4
    `).get() as { applied_at: string }).applied_at), appliedAt);
    assert.equal(Number((db.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 4
    `).get() as { count: number }).count), 1);
    assert.equal(pendingOperationCount(db, "inst-legacy", "operation-legacy"), 1);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    db.close();

    db = openRelayDatabase(databasePath);
    assert.equal(schemaVersion(db), 9);
    assert.equal(String(db.pragma("integrity_check", { simple: true })), "ok");
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("le préflight diagnostique une dépendance inter-écoles et laisse le schéma 3 intact", () => {
  const root = mkdtempSync(join(tmpdir(), "moncahier-relay-rollback-"));
  const databasePath = join(root, "invalid-schema-3.db");
  try {
    const legacy = createSchema3Database(databasePath);
    insertLegacyInstitution(legacy, "inst-a", "ECOLE-A");
    insertLegacyInstitution(legacy, "inst-b", "ECOLE-B");
    legacy.prepare(`
      INSERT INTO profiles(id, institution_id, display_name, updated_at)
      VALUES ('profile-b', 'inst-b', 'Mme B', '2026-07-13T12:00:00.000Z')
    `).run();
    legacy.prepare(`
      INSERT INTO user_roles(id, institution_id, profile_id, role, updated_at)
      VALUES ('role-cross-school', 'inst-a', 'profile-b', 'teacher', '2026-07-13T12:00:00.000Z')
    `).run();
    legacy.close();

    assert.throws(
      () => openRelayDatabase(databasePath),
      /migration_v4_preflight:dependency_invalid:table=user_roles:.*institution_id=inst-a:field=profile_id:dependency_table=profiles:dependency_id=profile-b:dependency_institution_id=inst-b/,
    );

    const unchanged = new Database(databasePath);
    assert.equal(Number((unchanged.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get() as { version: number }).version), 3);
    assert.equal(Number((unchanged.prepare(`
      SELECT COUNT(*) AS count FROM user_roles WHERE id = 'role-cross-school'
    `).get() as { count: number }).count), 1);
    assert.deepEqual(primaryKeyColumns(unchanged, "profiles"), ["id"]);
    assert.equal(Number((unchanged.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE '__v3_%'
    `).get() as { count: number }).count), 0);
    assert.equal(String(unchanged.pragma("integrity_check", { simple: true })), "ok");
    unchanged.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("une erreur après le début de la migration annule toute la transaction", () => {
  const root = mkdtempSync(join(tmpdir(), "moncahier-relay-transaction-"));
  const databasePath = join(root, "forced-failure-schema-3.db");
  try {
    const legacy = createSchema3Database(databasePath);
    insertLegacyInstitution(legacy, "inst-rollback", "ROLLBACK");
    legacy.prepare(`
      INSERT INTO profiles(id, institution_id, display_name, updated_at)
      VALUES ('profile-rollback', 'inst-rollback', 'Mme Rollback', '2026-07-13T12:00:00.000Z')
    `).run();
    legacy.exec(`
      CREATE TRIGGER force_migration_v4_failure
      BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 4
      BEGIN
        SELECT RAISE(ABORT, 'forced_migration_v4_failure');
      END;
    `);
    legacy.close();

    assert.throws(() => openRelayDatabase(databasePath), /forced_migration_v4_failure/);

    const unchanged = new Database(databasePath);
    assert.equal(Number((unchanged.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get() as { version: number }).version), 3);
    assert.equal(profileName(unchanged, "inst-rollback", "profile-rollback"), "Mme Rollback");
    assert.equal(Number((unchanged.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'relay_institution_meta'
    `).get() as { count: number }).count), 0);
    assert.equal(Number((unchanged.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE '__v3_%'
    `).get() as { count: number }).count), 0);
    assert.deepEqual(primaryKeyColumns(unchanged, "profiles"), ["id"]);
    assert.equal(String(unchanged.pragma("integrity_check", { simple: true })), "ok");
    unchanged.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
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

function bootstrapFixtureForSchool(input: {
  snapshotId: string;
  teacherName: string;
  institutionId: string;
  institutionName: string;
  institutionCode: string;
  idSuffix: string;
}) {
  const replacements = new Map<string, string>([
    ["inst-1", input.institutionId],
    ["year-1", `year-${input.idSuffix}`],
    ["teacher-1", `teacher-${input.idSuffix}`],
    ["role-1", `role-${input.idSuffix}`],
    ["class-1", `class-${input.idSuffix}`],
    ["subject-1", `subject-${input.idSuffix}`],
    ["period-1", `period-${input.idSuffix}`],
    ["timetable-1", `timetable-${input.idSuffix}`],
    ["session-1", `session-${input.idSuffix}`],
    ["client-session-1", `client-session-${input.idSuffix}`],
  ]);
  const rewrite = (value: unknown): any => {
    if (typeof value === "string") return replacements.get(value) || value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([key, item]) => [key, rewrite(item)]),
      );
    }
    return value;
  };
  const snapshot = rewrite(bootstrapFixture(input.snapshotId, input.teacherName));
  snapshot.institution.name = input.institutionName;
  snapshot.institution.code = input.institutionCode;
  return snapshot;
}

function mutableFixture(snapshotId: string, teacherName: string, version = 1): any {
  return JSON.parse(JSON.stringify(bootstrapFixture(snapshotId, teacherName, version)));
}

function sameIdentifiersFixture(
  snapshotId: string,
  institutionId: string,
  institutionCode: string,
  teacherName: string,
) {
  const snapshot = mutableFixture(snapshotId, teacherName);
  snapshot.institution_id = institutionId;
  snapshot.institution.id = institutionId;
  snapshot.institution.code = institutionCode;
  snapshot.institution.name = institutionCode;
  for (const rows of Object.values(snapshot.entities) as any[][]) {
    for (const row of rows) row.institution_id = institutionId;
  }
  return snapshot;
}

function fixtureWithStudent(
  snapshotId: string,
  institutionId: string,
  institutionCode: string,
  teacherName: string,
) {
  const snapshot = sameIdentifiersFixture(snapshotId, institutionId, institutionCode, teacherName);
  snapshot.entities.students = [{
    id: "student-1",
    institution_id: institutionId,
    registration_number: "SAME-001",
    first_name: "Élève",
    last_name: institutionCode,
    display_name: `Élève ${institutionCode}`,
    gender: null,
    is_active: true,
    server_version: 1,
    updated_at: snapshot.generated_at,
  }];
  snapshot.entities.class_enrollments = [{
    id: "enrollment-1",
    institution_id: institutionId,
    class_id: "class-1",
    student_id: "student-1",
    start_date: "2026-09-01",
    end_date: null,
    server_version: 1,
    updated_at: snapshot.generated_at,
  }];
  return snapshot;
}

function assertBootstrapDependency(
  result: any,
  collection: string,
  entityId: string,
  dependencyType: string,
  dependencyId: string,
) {
  assert.equal(result.status, "partial");
  assert.ok(result.deferred_entities >= 1);
  assert.ok(result.rejected_entities >= 1);
  assert.ok(result.diagnostics.some((diagnostic: any) =>
    diagnostic.collection === collection &&
    diagnostic.entity_id === entityId &&
    diagnostic.institution_id === "inst-1" &&
    diagnostic.reason === "dependency_missing" &&
    diagnostic.dependency_type === dependencyType &&
    diagnostic.dependency_id === dependencyId
  ));
}

function countRows(db: Database.Database, table: string, institutionId: string) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE institution_id = ?`)
    .get(institutionId) as { count: number };
  return Number(row.count);
}

function profileName(
  db: Database.Database,
  institutionId: string,
  profileId = "teacher-1",
) {
  const row = db.prepare(`
    SELECT display_name FROM profiles WHERE institution_id = ? AND id = ?
  `).get(institutionId, profileId) as { display_name: string | null } | undefined;
  return row?.display_name ?? null;
}

function deletedAt(
  db: Database.Database,
  table: string,
  institutionId: string,
  entityId: string,
) {
  const row = db.prepare(`SELECT deleted_at FROM ${table} WHERE institution_id = ? AND id = ?`)
    .get(institutionId, entityId) as { deleted_at: string | null } | undefined;
  return row?.deleted_at ?? null;
}

function pendingOperationCount(
  db: Database.Database,
  institutionId: string,
  operationId: string,
) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM sync_outbox
    WHERE institution_id = ? AND operation_id = ?
  `).get(institutionId, operationId) as { count: number };
  return Number(row.count);
}

function profileOperation(operationId: string, institutionId: string, displayName: string) {
  return {
    protocol_version: SYNC_PROTOCOL_VERSION,
    operation_id: operationId,
    institution_id: institutionId,
    device_id: "device-local",
    entity_type: "profile",
    entity_id: "teacher-1",
    action: "upsert",
    base_server_version: 1,
    occurred_at: "2026-07-13T12:10:00.000Z",
    payload: {
      display_name: displayName,
      email: "teacher@example.test",
      phone: null,
      is_active: true,
    },
  } as const;
}

function primaryKeyColumns(db: Database.Database, table: string) {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string; pk: number }>)
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
}

function createSchema3Database(databasePath: string) {
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE relay_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  for (const migration of [
    { version: 1, name: "core", file: "0001_core.sql" },
    { version: 2, name: "bootstrap_dashboard", file: "0002_bootstrap_dashboard.sql" },
    { version: 3, name: "bootstrap_diagnostics", file: "0003_bootstrap_diagnostics.sql" },
  ]) {
    const migrationPath = fileURLToPath(new URL(`../migrations/${migration.file}`, import.meta.url));
    db.exec(readFileSync(migrationPath, "utf8"));
    db.prepare(`
      INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)
    `).run(migration.version, migration.name, `2026-07-13T12:00:0${migration.version}.000Z`);
  }
  return db;
}

function insertLegacyInstitution(db: Database.Database, institutionId: string, code: string) {
  db.prepare(`
    INSERT INTO institutions(id, name, code, updated_at) VALUES (?, ?, ?, ?)
  `).run(institutionId, code, code, "2026-07-13T12:00:00.000Z");
}

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type Database from "better-sqlite3";
import { openRelayDatabase, type RelayDatabase } from "../src/db.mjs";
import { createRelayServer } from "../src/server.mjs";
import { RelayStore } from "../src/store.mjs";

const SCHOOL_ONE_SECRET = "1111111111111111111111111111111111111111111111111111111111111111";
const SCHOOL_TWO_SECRET = "2222222222222222222222222222222222222222222222222222222222222222";

function relayTeacherToken(input: {
  secret: string;
  institutionId: string;
  actorProfileId: string;
  now?: Date;
}) {
  const now = input.now || new Date();
  const payload = {
    v: 1,
    purpose: "attendance_relay_access",
    institution_id: input.institutionId,
    actor_profile_id: input.actorProfileId,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${createHmac("sha256", input.secret).update(encoded).digest("base64url")}`;
}

function seedSchool(
  db: RelayDatabase,
  input: { institutionId: string; code: string; secret: string },
) {
  db.prepare(`
    INSERT INTO institutions(id, name, code, settings_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.institutionId,
    input.code,
    input.code,
    JSON.stringify({ attendance_presence: { relay_presence_secret: input.secret } }),
    new Date().toISOString(),
  );
}

function seedTeacher(
  db: RelayDatabase,
  input: { institutionId: string; actorProfileId: string; active: boolean },
) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO profiles(
      id, institution_id, display_name, is_active, server_version, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    input.actorProfileId,
    input.institutionId,
    input.actorProfileId,
    input.active ? 1 : 0,
    now,
  );
  db.prepare(`
    INSERT INTO user_roles(
      id, institution_id, profile_id, role, server_version, updated_at
    ) VALUES (?, ?, ?, 'teacher', 0, ?)
  `).run(
    `role:${input.actorProfileId}`,
    input.institutionId,
    input.actorProfileId,
    now,
  );
}

function totalChanges(db: Database.Database) {
  const row = db.prepare("SELECT total_changes() AS count").get() as { count: number };
  return Number(row.count);
}

async function startRelay(
  store: RelayStore,
  config: Parameters<typeof createRelayServer>[0],
) {
  const server = createRelayServer(config, store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    ),
  };
}

function connectivityPost(url: string, token?: string, body: unknown = {}) {
  return fetch(`${url}/v1/teacher/connectivity-check`, {
    method: "POST",
    headers: {
      Origin: "https://mon-cahier.com",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("le contrôle de connectivité accepte seulement le professeur signé de l'école", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  seedSchool(db, { institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET });
  seedTeacher(db, { institutionId: "inst-1", actorProfileId: "teacher-active", active: true });
  seedTeacher(db, { institutionId: "inst-1", actorProfileId: "teacher-inactive", active: false });
  seedSchool(db, { institutionId: "inst-2", code: "SCH-000002", secret: SCHOOL_TWO_SECRET });
  seedTeacher(db, { institutionId: "inst-2", actorProfileId: "teacher-other", active: true });
  const relay = await startRelay(store, {
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "admin-token-must-not-work",
    institutionCode: "SCH-000001",
    institutionCodes: ["SCH-000001"],
  });
  const changesBefore = totalChanges(db);

  try {
    const valid = await connectivityPost(relay.url, relayTeacherToken({
      secret: SCHOOL_ONE_SECRET,
      institutionId: "inst-1",
      actorProfileId: "teacher-active",
    }));
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("access-control-allow-origin"), "https://mon-cahier.com");
    const validBody = await valid.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(validBody).sort(), ["institution_id", "ok", "relay_time"]);
    assert.equal(validBody.ok, true);
    assert.equal(validBody.institution_id, "inst-1");
    assert.ok(Number.isFinite(Date.parse(String(validBody.relay_time))));

    assert.equal((await connectivityPost(relay.url)).status, 401);
    assert.equal((await connectivityPost(relay.url, "not-a-signed-teacher-token")).status, 401);
    assert.equal((await connectivityPost(relay.url, "admin-token-must-not-work")).status, 401);
    assert.equal((await connectivityPost(relay.url, relayTeacherToken({
      secret: SCHOOL_TWO_SECRET,
      institutionId: "inst-2",
      actorProfileId: "teacher-other",
    }))).status, 401);
    assert.equal((await connectivityPost(relay.url, relayTeacherToken({
      secret: SCHOOL_ONE_SECRET,
      institutionId: "inst-1",
      actorProfileId: "teacher-inactive",
    }))).status, 401);
    assert.equal((await connectivityPost(
      relay.url,
      relayTeacherToken({
        secret: SCHOOL_ONE_SECRET,
        institutionId: "inst-1",
        actorProfileId: "teacher-active",
      }),
      { padding: "x".repeat(5_000) },
    )).status, 413);

    assert.equal(totalChanges(db), changesBefore);
  } finally {
    await relay.close();
    db.close();
  }
});

test("le contrôle de connectivité reste cloisonné sur un relais de groupe", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  seedSchool(db, { institutionId: "inst-1", code: "SCH-000001", secret: SCHOOL_ONE_SECRET });
  seedTeacher(db, { institutionId: "inst-1", actorProfileId: "teacher-shared", active: true });
  seedSchool(db, { institutionId: "inst-2", code: "SCH-000002", secret: SCHOOL_TWO_SECRET });
  seedTeacher(db, { institutionId: "inst-2", actorProfileId: "teacher-shared", active: true });
  const relay = await startRelay(store, {
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "group-admin-token",
    institutionCodes: ["SCH-000001", "SCH-000002"],
    institutions: [
      { code: "SCH-000001", name: "École 1", admin_token: "school-one-admin" },
      { code: "SCH-000002", name: "École 2", admin_token: "school-two-admin" },
    ],
  });
  const changesBefore = totalChanges(db);

  try {
    const schoolOne = await connectivityPost(relay.url, relayTeacherToken({
      secret: SCHOOL_ONE_SECRET,
      institutionId: "inst-1",
      actorProfileId: "teacher-shared",
    }));
    assert.equal(schoolOne.status, 200);
    assert.equal((await schoolOne.json() as any).institution_id, "inst-1");

    const schoolTwo = await connectivityPost(relay.url, relayTeacherToken({
      secret: SCHOOL_TWO_SECRET,
      institutionId: "inst-2",
      actorProfileId: "teacher-shared",
    }));
    assert.equal(schoolTwo.status, 200);
    assert.equal((await schoolTwo.json() as any).institution_id, "inst-2");

    const crossSigned = await connectivityPost(relay.url, relayTeacherToken({
      secret: SCHOOL_ONE_SECRET,
      institutionId: "inst-2",
      actorProfileId: "teacher-shared",
    }));
    assert.equal(crossSigned.status, 401);
    assert.equal(totalChanges(db), changesBefore);
  } finally {
    await relay.close();
    db.close();
  }
});

test("le prévol CORS du contrôle professeur autorise POST sans écrire dans SQLite", async () => {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  const relay = await startRelay(store, {
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    token: "admin-token",
  });
  const changesBefore = totalChanges(db);

  try {
    const response = await fetch(`${relay.url}/v1/teacher/connectivity-check`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://mon-cahier.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://mon-cahier.com");
    assert.match(String(response.headers.get("access-control-allow-methods")), /POST/);
    assert.match(String(response.headers.get("access-control-allow-headers")), /Authorization/i);
    assert.equal(response.headers.get("access-control-allow-private-network"), "true");
    assert.equal(totalChanges(db), changesBefore);
  } finally {
    await relay.close();
    db.close();
  }
});

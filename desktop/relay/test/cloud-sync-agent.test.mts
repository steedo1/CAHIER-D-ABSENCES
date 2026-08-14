import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createRelayCloudSyncAgent } from "../src/cloud-sync.mjs";
import type { RelayConfig } from "../src/config.mjs";
import { openRelayDatabase } from "../src/db.mjs";
import { RelayStore } from "../src/store.mjs";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = `${DEVICE_ID}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

function agentConfig(): RelayConfig {
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
        pull_endpoint: "https://mon-cahier.com/api/relay/sync/pull",
        device_id: DEVICE_ID,
        token: TOKEN,
      },
    }],
    institutionCodes: ["SCH-000001"],
    cloudSyncBatchSize: 25,
    cloudSyncTimeoutMs: 20_000,
    cloudSyncIntervalMs: 1_000,
  };
}

function agentSetup() {
  const db = openRelayDatabase(":memory:");
  const store = new RelayStore(db);
  store.ensureInstitution("inst-1", "École test", "2026-08-14T12:00:00.000Z");
  db.prepare("UPDATE institutions SET code = 'SCH-000001' WHERE id = 'inst-1'").run();
  return { db, store };
}

function notModifiedResponse() {
  return new Response(JSON.stringify({
    protocol_version: 1,
    status: "not_modified",
    institution_id: "inst-1",
    device_id: DEVICE_ID,
    server_time: "2026-08-14T12:00:00.000Z",
    cloud_revision: 0,
    schedule_revision: 0,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("agent Cloud: démarrage immédiat, périodicité, start idempotent et stop définitif", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const { db, store } = agentSetup();
  let calls = 0;
  const agent = createRelayCloudSyncAgent(agentConfig(), store, {
    fetchImpl: async () => {
      calls += 1;
      return notModifiedResponse();
    },
  });
  try {
    agent.start();
    agent.start();
    await agent.runOnce();
    assert.equal(calls, 1);

    context.mock.timers.tick(999);
    await Promise.resolve();
    assert.equal(calls, 1);
    context.mock.timers.tick(1);
    await agent.runOnce();
    assert.equal(calls, 2);

    await agent.stop();
    context.mock.timers.tick(10_000);
    await Promise.resolve();
    assert.equal(calls, 2);
  } finally {
    await agent.stop();
    db.close();
  }
});

test("agent Cloud: un cycle long ne chevauche rien et les cycles reprennent ensuite", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const { db, store } = agentSetup();
  const firstStarted = gate();
  const releaseFirst = gate();
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const agent = createRelayCloudSyncAgent(agentConfig(), store, {
    fetchImpl: async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (calls === 1) {
        firstStarted.release();
        await releaseFirst.promise;
      }
      active -= 1;
      return notModifiedResponse();
    },
  });
  try {
    agent.start();
    await firstStarted.promise;
    context.mock.timers.tick(5_000);
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(maxActive, 1);

    releaseFirst.release();
    await agent.runOnce();
    context.mock.timers.tick(1_000);
    await agent.runOnce();
    assert.equal(calls, 2);
    assert.equal(maxActive, 1);
  } finally {
    releaseFirst.release();
    await agent.stop();
    db.close();
  }
});

test("agent Cloud: une exception de cycle est isolée et le cycle suivant réussit", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const { db, store } = agentSetup();
  let failNow = true;
  let fetchCalls = 0;
  const agent = createRelayCloudSyncAgent(agentConfig(), store, {
    now: () => {
      if (failNow) throw new Error("injected_cycle_failure");
      return new Date("2026-08-14T12:00:00.000Z");
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return notModifiedResponse();
    },
  });
  try {
    agent.start();
    await agent.runOnce();
    assert.equal(fetchCalls, 0);

    failNow = false;
    context.mock.timers.tick(1_000);
    await agent.runOnce();
    assert.equal(fetchCalls, 1);
  } finally {
    await agent.stop();
    db.close();
  }
});

test("agent Cloud: stop attend le cycle actif avant que SQLite puisse être fermé", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const { db, store } = agentSetup();
  const started = gate();
  const release = gate();
  let calls = 0;
  const agent = createRelayCloudSyncAgent(agentConfig(), store, {
    fetchImpl: async () => {
      calls += 1;
      started.release();
      await release.promise;
      return notModifiedResponse();
    },
  });
  try {
    agent.start();
    await started.promise;
    let stopped = false;
    const stopping = agent.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    assert.equal(stopped, false);
    assert.equal((db.prepare("SELECT 1 AS value").get() as { value: number }).value, 1);

    release.release();
    await stopping;
    assert.equal(stopped, true);
    context.mock.timers.tick(10_000);
    await Promise.resolve();
    assert.equal(calls, 1);
  } finally {
    release.release();
    await agent.stop();
    db.close();
  }
});

test("serve attend Cloud, HTTP et mDNS avant de fermer SQLite", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/cli.mts"),
    "utf8",
  );
  const shutdownStart = source.indexOf("const shutdown =");
  const shutdownEnd = source.indexOf("server.once(\"error\"", shutdownStart);
  assert.ok(shutdownStart >= 0 && shutdownEnd > shutdownStart);
  const shutdown = source.slice(shutdownStart, shutdownEnd);
  assert.match(shutdown, /await Promise\.all\(\[/);
  assert.match(shutdown, /cloudSyncAgent\.stop\(\)/);
  assert.match(shutdown, /serverStopped/);
  assert.match(shutdown, /mdnsAnnouncer\?\.stop\(\)/);
  assert.ok(shutdown.indexOf("db.close()") > shutdown.indexOf("await Promise.all(["));
  assert.match(source, /server\.listen[\s\S]*?if \(closing\) return;[\s\S]*?cloudSyncAgent\.start\(\)/);
});

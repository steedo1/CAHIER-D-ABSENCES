import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { relayInstitutionsFromConfigFile } from "../src/config.mjs";
import { configureCloudSync, configureRelay } from "../src/setup.mjs";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = `${DEVICE_ID}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

test("une ancienne configuration push dérive automatiquement la route pull", () => {
  const institutions = relayInstitutionsFromConfigFile({
    version: 3,
    institutions: [{
      code: "SCH-000001",
      name: "École test",
      cloud_sync: {
        enabled: true,
        endpoint: "https://www.mon-cahier.com/api/relay/sync/push",
        device_id: DEVICE_ID,
        token: TOKEN,
      },
    }],
  });

  assert.equal(
    institutions[0]?.cloud_sync?.pull_endpoint,
    "https://www.mon-cahier.com/api/relay/sync/pull",
  );
});

test("sync-configure persiste les routes push et pull sans nouveau secret", () => {
  const root = mkdtempSync(join(tmpdir(), "moncahier-cloud-pull-config-"));
  const configPath = join(root, "config.json");
  try {
    writeFileSync(configPath, JSON.stringify({
      version: 3,
      institutions: [{
        code: "SCH-000001",
        name: "École test",
        admin_token: "a".repeat(32),
      }],
    }), "utf8");

    const result = configureCloudSync({
      institutionCode: "SCH-000001",
      endpoint: "https://www.mon-cahier.com/api/relay/sync/push",
      deviceId: DEVICE_ID,
      token: TOKEN,
      configPath,
    });
    assert.equal(
      result.pull_endpoint,
      "https://www.mon-cahier.com/api/relay/sync/pull",
    );

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(
      saved.institutions[0].cloud_sync.pull_endpoint,
      "https://www.mon-cahier.com/api/relay/sync/pull",
    );
    assert.equal(saved.institutions[0].cloud_sync.token, TOKEN);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("reconfigurer la même école conserve son identité Cloud", () => {
  const root = mkdtempSync(join(tmpdir(), "moncahier-cloud-pull-preserve-"));
  const configPath = join(root, "config.json");
  try {
    writeFileSync(configPath, JSON.stringify({
      version: 3,
      database_path: join(root, "relay.db"),
      token: "b".repeat(32),
      institutions: [{
        code: "SCH-000001",
        name: "Ancien nom",
        admin_token: "a".repeat(32),
        cloud_sync: {
          enabled: true,
          endpoint: "https://www.mon-cahier.com/api/relay/sync/push",
          pull_endpoint: "https://www.mon-cahier.com/api/relay/sync/pull",
          device_id: DEVICE_ID,
          token: TOKEN,
        },
      }],
    }), "utf8");

    configureRelay({
      institutionCode: "SCH-000001",
      institutionName: "Nouveau nom",
      configPath,
    });

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(saved.institutions[0].name, "Nouveau nom");
    assert.equal(saved.institutions[0].cloud_sync.device_id, DEVICE_ID);
    assert.equal(saved.institutions[0].cloud_sync.token, TOKEN);
    assert.equal(
      saved.institutions[0].cloud_sync.pull_endpoint,
      "https://www.mon-cahier.com/api/relay/sync/pull",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

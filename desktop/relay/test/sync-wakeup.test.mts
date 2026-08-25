import assert from "node:assert/strict";
import test from "node:test";
import {
  clearRelayCloudSyncWake,
  registerRelayCloudSyncWake,
  wakeRelayCloudSync,
} from "../src/sync-wakeup.mjs";

test("le réveil Cloud est immédiat puis throttlé", async () => {
  let calls = 0;
  const trigger = async () => {
    calls += 1;
  };

  registerRelayCloudSyncWake(trigger);
  try {
    await wakeRelayCloudSync(10_000, 5_000);
    assert.equal(calls, 1);

    assert.equal(wakeRelayCloudSync(12_000, 5_000), null);
    assert.equal(calls, 1);

    await wakeRelayCloudSync(16_000, 5_000);
    assert.equal(calls, 2);
  } finally {
    clearRelayCloudSyncWake(trigger);
  }
});

test("sans agent enregistré, le réveil reste un no-op sûr", () => {
  clearRelayCloudSyncWake();
  assert.equal(wakeRelayCloudSync(20_000, 0), null);
});

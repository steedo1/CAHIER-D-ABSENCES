import assert from "node:assert/strict";
import test from "node:test";
import { relayEnabledFromDeviceRows } from "../src/lib/relay-capability-server.ts";

test("le Relais reste désactivé sans appareil explicitement provisionné", () => {
  assert.equal(relayEnabledFromDeviceRows([]), false);
  assert.equal(
    relayEnabledFromDeviceRows([{
      is_active: true,
      revoked_at: null,
      last_seen_at: null,
    }]),
    false,
  );
});

test("un appareil inactif ou révoqué ne peut pas activer le Relais", () => {
  assert.equal(
    relayEnabledFromDeviceRows([{
      is_active: false,
      revoked_at: null,
      last_seen_at: "2026-08-01T00:00:00.000Z",
    }]),
    false,
  );
  assert.equal(
    relayEnabledFromDeviceRows([{
      is_active: true,
      revoked_at: "2026-08-02T00:00:00.000Z",
      last_seen_at: "2026-08-01T00:00:00.000Z",
    }]),
    false,
  );
});

test("seul un appareil actif, non révoqué et déjà vu active le Relais", () => {
  assert.equal(
    relayEnabledFromDeviceRows([{
      is_active: true,
      revoked_at: null,
      last_seen_at: "2026-08-01T00:00:00.000Z",
    }]),
    true,
  );
});

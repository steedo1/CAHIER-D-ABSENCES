import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openRelayDatabase, schemaVersion } from "../src/db.mjs";
import {
  CapturedAtDeviceError,
  effectiveCapturedAtDevice,
  normalizeCapturedAtDevice,
} from "../src/device-time.mjs";

const RECEIVED_AT = new Date("2026-07-22T10:00:00.000Z");

test("l'ancien format sans capture utilise l'heure d'acceptation du relais", () => {
  assert.equal(normalizeCapturedAtDevice(undefined), null);
  assert.equal(
    effectiveCapturedAtDevice(null, RECEIVED_AT).toISOString(),
    RECEIVED_AT.toISOString(),
  );
});

test("le nouveau format normalise et borne l'heure capturée sur l'appareil", () => {
  assert.equal(
    normalizeCapturedAtDevice("2026-07-22T09:59:00Z"),
    "2026-07-22T09:59:00.000Z",
  );
  assert.equal(
    effectiveCapturedAtDevice("2026-07-22T09:59:00.000Z", RECEIVED_AT).toISOString(),
    "2026-07-22T09:59:00.000Z",
  );
  assert.throws(
    () => normalizeCapturedAtDevice("hier"),
    (error: unknown) => error instanceof CapturedAtDeviceError &&
      error.code === "captured_at_device_invalid",
  );
  assert.throws(
    () => effectiveCapturedAtDevice("2026-07-22T10:05:01.000Z", RECEIVED_AT),
    (error: unknown) => error instanceof CapturedAtDeviceError &&
      error.code === "captured_at_device_in_future",
  );
  assert.throws(
    () => effectiveCapturedAtDevice("2026-06-20T10:00:00.000Z", RECEIVED_AT),
    (error: unknown) => error instanceof CapturedAtDeviceError &&
      error.code === "captured_at_device_too_old",
  );
});

test("SQLite reste en synchronous FULL après migration et redémarrage", () => {
  const directory = mkdtempSync(join(tmpdir(), "moncahier-relay-full-"));
  const path = join(directory, "relay.db");
  try {
    const first = openRelayDatabase(path);
    assert.equal(Number(first.pragma("synchronous", { simple: true })), 2);
    const version = schemaVersion(first);
    first.close();

    const reopened = openRelayDatabase(path);
    assert.equal(schemaVersion(reopened), version);
    assert.equal(Number(reopened.pragma("synchronous", { simple: true })), 2);
    assert.equal(String(reopened.pragma("integrity_check", { simple: true })), "ok");
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

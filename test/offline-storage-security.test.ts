import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_OFFLINE_AVAILABLE_BYTES,
  formatOfflineStorageBytes,
  inspectOfflineStorageProtection,
  offlineStorageProtectionMessage,
} from "../src/lib/offline-storage-security.ts";

const now = () => new Date("2026-08-08T06:00:00.000Z");

test("un navigateur sans StorageManager reste compatible en mode prudent", async () => {
  const result = await inspectOfflineStorageProtection({ storage: null, now });

  assert.equal(result.status, "unsupported");
  assert.equal(result.supported, false);
  assert.equal(result.persisted, false);
  assert.equal(result.checked_at, "2026-08-08T06:00:00.000Z");
});

test("la préparation demande la persistance une seule fois si nécessaire", async () => {
  let persistCalls = 0;
  const result = await inspectOfflineStorageProtection({
    storage: {
      persisted: async () => false,
      persist: async () => {
        persistCalls += 1;
        return true;
      },
      estimate: async () => ({
        quota: 512 * 1024 * 1024,
        usage: 32 * 1024 * 1024,
      }),
    },
    requestPersistence: true,
    now,
  });

  assert.equal(persistCalls, 1);
  assert.equal(result.status, "persistent");
  assert.equal(result.persisted, true);
  assert.equal(result.persistence_requested, true);
  assert.equal(result.available_bytes, 480 * 1024 * 1024);
});

test("un espace réellement faible est signalé même si le stockage est persistant", async () => {
  const result = await inspectOfflineStorageProtection({
    storage: {
      persisted: async () => true,
      estimate: async () => ({
        quota: 128 * 1024 * 1024,
        usage: 128 * 1024 * 1024 - MIN_OFFLINE_AVAILABLE_BYTES + 1,
      }),
    },
    requestPersistence: true,
    now,
  });

  assert.equal(result.status, "low_space");
  assert.equal(result.persisted, true);
  assert.match(offlineStorageProtectionMessage(result) || "", /Espace local faible/i);
});

test("un refus de persistance n'empêche pas le mode hors ligne si l'espace suffit", async () => {
  const result = await inspectOfflineStorageProtection({
    storage: {
      persisted: async () => false,
      persist: async () => false,
      estimate: async () => ({
        quota: 1024 * 1024 * 1024,
        usage: 64 * 1024 * 1024,
      }),
    },
    requestPersistence: true,
    now,
  });

  assert.equal(result.status, "best_effort");
  assert.equal(result.persisted, false);
  assert.match(offlineStorageProtectionMessage(result) || "", /protection permanente/i);
});

test("les tailles de stockage sont présentées simplement", () => {
  assert.equal(formatOfflineStorageBytes(20 * 1024 * 1024), "20 Mo");
  assert.equal(formatOfflineStorageBytes(2.5 * 1024 * 1024 * 1024), "2.5 Go");
  assert.equal(formatOfflineStorageBytes(null), null);
});

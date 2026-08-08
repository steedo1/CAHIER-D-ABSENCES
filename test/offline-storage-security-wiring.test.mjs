import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readiness = fs.readFileSync(
  new URL("../src/lib/offline-readiness.ts", import.meta.url),
  "utf8",
);
const card = fs.readFileSync(
  new URL("../src/components/OfflineReadinessCard.tsx", import.meta.url),
  "utf8",
);
const helper = fs.readFileSync(
  new URL("../src/lib/offline-storage-security.ts", import.meta.url),
  "utf8",
);

test("la préparation demande la persistance avant de télécharger les données", () => {
  assert.match(readiness, /Protection du stockage local/);
  assert.match(readiness, /getOfflineStorageProtection\(\{\s*requestPersistence: true/);
  assert.match(readiness, /storageProtection\.status === "low_space"/);
  assert.match(readiness, /storage_protection: storageProtection/);
});

test("le téléphone de classe conserve le diagnostic dans son bundle cohérent", () => {
  assert.match(readiness, /role === "class-device"/);
  assert.match(readiness, /persistClassDeviceBundle\(readiness, bundle\.schedule\)/);
});

test("la carte affiche la protection et l'espace disponible sans masquer la readiness", () => {
  assert.match(card, /getOfflineStorageProtection\(\)/);
  assert.match(card, /offlineStorageProtectionMessage/);
  assert.match(card, /storageProtectionText/);
  assert.match(card, /<Database/);
  assert.match(helper, /Stockage protégé par le navigateur/);
  assert.match(helper, /Espace local faible/);
});

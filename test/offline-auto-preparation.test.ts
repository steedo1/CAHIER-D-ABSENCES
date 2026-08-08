import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldAutomaticallyPrepareOffline,
  shouldShowOfflinePreparationRetry,
} from "../src/lib/offline-auto-preparation.ts";

test("une première préparation se lance automatiquement", () => {
  assert.equal(
    shouldAutomaticallyPrepareOffline({
      has_readiness: false,
      stale: false,
      preparing: false,
      storage_status: "best_effort",
    }),
    true,
  );
});

test("une préparation devenue obsolète est actualisée automatiquement", () => {
  assert.equal(
    shouldAutomaticallyPrepareOffline({
      has_readiness: true,
      stale: true,
      preparing: false,
      storage_status: "persistent",
    }),
    true,
  );
});

test("un appareil déjà prêt ne relance pas un téléchargement inutile", () => {
  assert.equal(
    shouldAutomaticallyPrepareOffline({
      has_readiness: true,
      stale: false,
      preparing: false,
      storage_status: "persistent",
    }),
    false,
  );
});

test("une préparation en cours ne peut pas être doublée", () => {
  assert.equal(
    shouldAutomaticallyPrepareOffline({
      has_readiness: false,
      stale: false,
      preparing: true,
    }),
    false,
  );
});

test("un espace critique bloque la préparation automatique", () => {
  assert.equal(
    shouldAutomaticallyPrepareOffline({
      has_readiness: false,
      stale: false,
      preparing: false,
      storage_status: "low_space",
    }),
    false,
  );
});

test("le bouton manuel est réservé à une erreur ou à un espace critique", () => {
  assert.equal(
    shouldShowOfflinePreparationRetry({ preparing: false, error: null }),
    false,
  );
  assert.equal(
    shouldShowOfflinePreparationRetry({
      preparing: false,
      error: "Connexion nécessaire",
    }),
    true,
  );
  assert.equal(
    shouldShowOfflinePreparationRetry({
      preparing: false,
      storage_status: "low_space",
    }),
    true,
  );
});

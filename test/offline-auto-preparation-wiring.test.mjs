import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const card = fs.readFileSync(
  new URL("../src/components/OfflineReadinessCard.tsx", import.meta.url),
  "utf8",
);

test("la préparation hors ligne se lance automatiquement après le diagnostic", () => {
  assert.match(card, /shouldAutomaticallyPrepareOffline/);
  assert.match(card, /autoAttemptedCycleRef/);
  assert.match(card, /preparingRef\.current/);
  assert.match(card, /void handlePrepare\(\)/);
  assert.match(card, /setRefreshCycle\(\(current\) => current \+ 1\)/);
});

test("la préparation est réévaluée au retour du réseau et au premier plan", () => {
  assert.match(card, /addEventListener\("online", handleNetworkChange\)/);
  assert.match(card, /addEventListener\("focus", handleFocus\)/);
  assert.match(card, /addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(card, /document\.visibilityState === "visible"/);
});

test("le bouton permanent Préparer ou Actualiser est masqué", () => {
  assert.doesNotMatch(card, /readiness \? "Actualiser" : "Préparer"/);
  assert.match(card, /showManualRetry &&/);
  assert.match(card, />\s*Réessayer\s*</);
  assert.match(card, /Configuration hors ligne automatique/);
});

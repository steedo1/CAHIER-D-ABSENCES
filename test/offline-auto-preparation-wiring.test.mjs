import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const card = fs.readFileSync(
  new URL("../src/components/OfflineReadinessCard.tsx", import.meta.url),
  "utf8",
);
const coordinator = fs.readFileSync(
  new URL("../src/components/OfflinePreparationCoordinator.tsx", import.meta.url),
  "utf8",
);

test("la carte est une vue abonnée et ne possède plus son propre moteur", () => {
  assert.match(card, /subscribeOfflinePreparation/);
  assert.match(card, /getOfflinePreparationSnapshot/);
  assert.doesNotMatch(card, /addEventListener\("online"/);
  assert.doesNotMatch(card, /addEventListener\("focus"/);
  assert.doesNotMatch(card, /visibilitychange/);
  assert.doesNotMatch(card, /prepareOffline/);
});

test("le coordinateur unique possède les déclencheurs automatiques", () => {
  assert.match(coordinator, /createOfflinePreparationTriggerController/);
  assert.match(coordinator, /subscribeWindow\("online"\)/);
  assert.match(coordinator, /subscribeWindow\("focus"\)/);
  assert.match(coordinator, /visibilitychange/);
  assert.match(coordinator, /controllerchange/);
  assert.match(coordinator, /setOfflinePreparationContext/);
});

test("le bouton permanent est masqué et seul Réessayer reste après échec", () => {
  assert.doesNotMatch(card, /readiness \? "Actualiser" : "Préparer"/);
  assert.match(card, /hasError && !isBusy/);
  assert.match(card, />\s*Réessayer\s*</);
  assert.match(card, /Configuration hors ligne automatique/);
});

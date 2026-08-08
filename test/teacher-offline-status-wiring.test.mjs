import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dashboard = fs.readFileSync(
  new URL("../src/components/teacher/TeacherDashboard.tsx", import.meta.url),
  "utf8",
);
const statusHelper = fs.readFileSync(
  new URL("../src/lib/teacher-offline-status.ts", import.meta.url),
  "utf8",
);

test("le tableau professeur affiche séparément Cloud, relais et emplacement des données", () => {
  assert.match(dashboard, /offlineStatus\.cloud\.label/);
  assert.match(dashboard, /offlineStatus\.relay\.label/);
  assert.match(dashboard, /offlineStatus\.data\.label/);
  assert.match(statusHelper, /Données : synchronisées/);
  assert.match(statusHelper, /sur ce téléphone/);
  assert.match(statusHelper, /sur le relais/);
});

test("le bouton Sync reste utilisable sans Internet lorsque des opérations attendent", () => {
  assert.match(dashboard, /disabled=\{!offlineStatus\.sync\.enabled\}/);
  assert.doesNotMatch(dashboard, /disabled=\{!isOnline \|\| syncing \|\| pending === 0\}/);
  assert.match(statusHelper, /const enabled = hasPending && !input\.syncing/);
  assert.match(statusHelper, /Essayer le relais local d’abord, puis le Cloud/);
});

test("les sondes réelles mettent à jour les statuts Cloud et relais", () => {
  assert.match(dashboard, /setCloudUiStatus\(cloudAvailable \? "connected" : "unavailable"\)/);
  assert.match(dashboard, /setRelayUiStatus\("checking"\)/);
  assert.match(dashboard, /liveRelayCheck\.status === "reachable" \? "connected" : "unavailable"/);
  assert.match(dashboard, /relayRecoveryResult\.relay_unreachable/);
});

test("les messages de synchronisation sont présentés comme des états visibles", () => {
  assert.match(dashboard, /statusMessageClasses/);
  assert.match(dashboard, /rounded-xl border px-3 py-2 text-sm font-medium/);
  assert.match(dashboard, /aria-live="polite"/);
});

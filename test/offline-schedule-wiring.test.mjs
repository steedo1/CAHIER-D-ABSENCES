import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("le bootstrap Cloud publie une révision complète et le Web exige son accusé", async () => {
  const [relayBootstrap, localRelay] = await Promise.all([
    read("src/app/api/relay/bootstrap/route.ts"),
    read("src/lib/local-relay.ts"),
  ]);
  assert.match(relayBootstrap, /snapshot_completeness/);
  assert.match(relayBootstrap, /snapshot_revision/);
  assert.match(relayBootstrap, /attendance_schedule_revision/);
  assert.match(relayBootstrap, /attendance_schedule_manifest/);
  assert.match(localRelay, /relay_update_required/);
  assert.match(localRelay, /relay_revision_ack_missing/);
  assert.match(localRelay, /relay_revision_mismatch/);
  assert.match(localRelay, /\/v1\/admin\/schedule-status/);
});

test("le relais annonce et vérifie explicitement l'accusé de révision", async () => {
  const [contract, server, installer, updater, settings, bridge] = await Promise.all([
    read("desktop/relay/src/schedule-contract.mts"),
    read("desktop/relay/src/server.mts"),
    read("desktop/relay/windows/install-relay.ps1"),
    read("desktop/relay/windows/update-relay.ps1"),
    read("src/components/admin/AttendancePresenceSettings.tsx"),
    read("src/components/admin/OfflineScheduleSyncBridge.tsx"),
  ]);
  assert.match(contract, /RELAY_VERSION = "0\.2\.1"/);
  assert.match(contract, /bootstrap_revision_ack_v1: true/);
  assert.match(contract, /admin_schedule_status_v1: true/);
  assert.match(server, /\/v1\/admin\/schedule-status/);
  assert.match(installer, /schema_version -lt 9/);
  assert.match(installer, /bootstrap_revision_ack_v1/);
  assert.match(updater, /backups\\update-/);
  assert.match(updater, /Start-ScheduledTask -TaskName "Mon Cahier Relay"/);
  assert.match(settings, /syncRelayScheduleAfterMutation/);
  assert.match(settings, /relayBootstrapErrorMessage/);
  assert.match(bridge, /getRelayConfig/);
  assert.match(bridge, /Mise à jour du programme relais requise/);
});

test("le service worker couvre les trois navigations professeur", async () => {
  const [worker, offline, readiness, release] = await Promise.all([
    read("public/moncahier-sw.js"),
    read("src/lib/offline.ts"),
    read("src/lib/offline-readiness.ts"),
    read("src/lib/offline-release.ts"),
  ]);
  assert.match(worker, /\/attendance/);
  assert.match(worker, /\/login/);
  assert.match(worker, /\/class/);
  assert.match(offline, /MON_CAHIER_SERVICE_WORKER_RELEASE/);
  assert.match(readiness, /warmOfflineShell/);
  assert.match(release, /MON_CAHIER_SERVICE_WORKER_RELEASE/);
});

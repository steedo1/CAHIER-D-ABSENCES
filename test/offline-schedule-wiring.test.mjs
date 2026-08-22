import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la migration Cloud couvre toutes les mutations pédagogiques dans la transaction métier", async () => {
  const sql = await read(
    "migrations/20260728_attendance_schedule_revision_v1.sql",
  );
  for (const table of [
    "institution_periods",
    "teacher_timetables",
    "class_teachers",
    "teacher_subjects",
    "classes",
    "profiles",
    "user_roles",
  ]) {
    assert.match(sql, new RegExp(`'${table}'`));
  }
  assert.match(sql, /AFTER INSERT OR UPDATE OR DELETE/);
  assert.match(
    sql,
    /attendance_schedule_revisions\.revision \+ 1/,
  );
});

test("la navigation sonde réellement le Cloud et ne dépend plus de navigator.onLine", async () => {
  const [chooseBook, readiness, localRelay] = await Promise.all([
    read("src/app/choose-book/page.tsx"),
    read("src/lib/offline-readiness.ts"),
    read("src/lib/local-relay.ts"),
  ]);
  assert.match(chooseBook, /probeCloudSchedule/);
  assert.match(chooseBook, /window\.location\.assign/);
  assert.doesNotMatch(chooseBook, /navigator\.onLine/);
  assert.doesNotMatch(readiness, /navigator\.onLine/);
  assert.doesNotMatch(localRelay, /navigator\.onLine/);
});

test("le bootstrap exige un snapshot complet et un accusé de la même révision", async () => {
  const [adminBootstrap, relaySnapshot, relayBootstrap, localRelay] = await Promise.all([
    read("src/app/api/admin/offline/bootstrap/route.ts"),
    read("src/lib/relay-bootstrap-snapshot.ts"),
    read("desktop/relay/src/bootstrap.mts"),
    read("src/lib/local-relay.ts"),
  ]);
  const snapshotConstruction = `${adminBootstrap}\n${relaySnapshot}`;
  assert.match(snapshotConstruction, /snapshot_completeness/);
  assert.match(snapshotConstruction, /schedule_manifest/);
  assert.match(snapshotConstruction, /class_teachers/);
  assert.match(snapshotConstruction, /revision_changed_during_generation/);
  assert.match(relayBootstrap, /completeSnapshotApplied/);
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
  assert.match(worker, /"\/attendance"/);
  assert.match(worker, /"\/grades"/);
  assert.match(worker, /"\/enseignant\/cahier-de-texte"/);
  assert.match(worker, /MON_CAHIER_GET_RELEASE/);
  assert.equal(
    worker.match(/event\.data\?\.type === "MON_CAHIER_GET_RELEASE"/g)?.length,
    1,
  );
  assert.match(worker, /Ressource essentielle indisponible/);
  assert.match(worker, /Ressource essentielle absente du cache/);
  assert.match(worker, /verified/);
  assert.match(worker, /2026-08-10-pwa-login-repeat-v5-7/);
  assert.match(release, /2026-08-10-pwa-login-repeat-v5-7/);
  assert.match(worker, /offline_schema_version: OFFLINE_SCHEMA_VERSION/);
  assert.match(offline, /getActiveOfflineWorkerInfo/);
  assert.match(offline, /MON_CAHIER_SW_URL = "\/moncahier-sw\.js"/);
  assert.doesNotMatch(offline, /moncahier-sw\.js\?v=/);
  assert.match(readiness, /offline_schema_version/);
});

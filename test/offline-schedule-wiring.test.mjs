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
  assert.match(localRelay, /relay_schedule_revision_not_acknowledged/);
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
  assert.match(worker, /2026-07-30-class-device-coherence-v5/);
  assert.match(release, /2026-07-30-class-device-coherence-v5/);
  assert.match(offline, /getActiveOfflineWorkerRelease/);
  assert.match(readiness, /serviceWorkerRelease/);
});

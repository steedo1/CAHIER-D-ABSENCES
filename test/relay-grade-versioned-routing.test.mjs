import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pushRoute = fs.readFileSync(
  new URL("../src/app/api/relay/sync/push/route.ts", import.meta.url),
  "utf8",
);
const cloudV4 = fs.readFileSync(
  new URL("../desktop/relay/src/cloud-sync-grade-v4.mts", import.meta.url),
  "utf8",
);
const cloudV4Safe = fs.readFileSync(
  new URL("../desktop/relay/src/cloud-sync-grade-v4-safe.mts", import.meta.url),
  "utf8",
);
const cli = fs.readFileSync(
  new URL("../desktop/relay/src/cli.mts", import.meta.url),
  "utf8",
);

test("LOT4A: les student_grade ne passent au CAS que pour canary + client compatible", () => {
  assert.match(pushRoute, /grade_sync_v4_enabled/);
  assert.match(pushRoute, /x-moncahier-grade-sync-v4/);
  assert.match(
    pushRoute,
    /operation\.entity_type === "student_grade" && gradeV4Enabled/,
  );
  assert.match(pushRoute, /processRelayStudentGradeSyncOperationV4/);
  assert.match(pushRoute, /: await processRelaySyncOperation\(/);
});

test("LOT4A: un client V4 avant canary reçoit déjà la version créée par LOT3", () => {
  assert.match(pushRoute, /readRelayStudentGradeServerVersion/);
  assert.match(pushRoute, /gradeV4Capable &&\s*!gradeV4Enabled/s);
  assert.match(pushRoute, /cloud_server_version: version/);
  assert.match(pushRoute, /student_grade_version_lookup_failed_after_ack/);
});

test("LOT4A: le relais V4 annonce sa capacité sur push et pull", () => {
  assert.match(cloudV4Safe, /X-MonCahier-Grade-Sync-V4/);
  assert.match(cloudV4Safe, /withGradeV4Capability/);
  assert.match(cloudV4Safe, /fetchImpl: withGradeV4Capability/);
});

test("LOT4A: les notes historiques en version 0 forcent un snapshot académique initial", () => {
  assert.match(cloudV4Safe, /needsGradeVersionBootstrap/);
  assert.match(cloudV4Safe, /server_version <= 0/);
  assert.match(cloudV4Safe, /searchParams\.delete\("known_revision"\)/);
  assert.match(cloudV4Safe, /forceAcademicBootstrap && method === "GET"/);
});

test("LOT4A: un ACK de note propage la version Cloud et nettoie local_dirty", () => {
  assert.match(cloudV4, /cloud_server_version/);
  assert.match(cloudV4, /UPDATE student_grades\s+SET server_version = \?/s);
  assert.match(cloudV4, /SET server_version = \?, local_dirty = 0/);
  assert.match(cloudV4, /DELETE FROM sync_outbox/);
});

test("LOT4A: un conflit CAS réutilise le moteur applyRemote existant", () => {
  assert.match(cloudV4, /store\.applyRemote\(/);
  assert.match(cloudV4, /event_id: `grade-cas:/);
  assert.match(cloudV4, /remote_changed_while_local_pending|applyGradeConflict/);
});

test("LOT4A: le wrapper conserve le moteur historique pour le reste et le pull", () => {
  assert.match(cloudV4, /syncRelayOnceLegacy\(config, store, options\)/);
  assert.match(cli, /from "\.\/cloud-sync-grade-v4-safe\.mjs"/);
  assert.match(cli, /requeueTimetableReplacementChain.*cloud-sync\.mjs/s);
});

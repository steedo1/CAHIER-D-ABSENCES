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
const cli = fs.readFileSync(
  new URL("../desktop/relay/src/cli.mts", import.meta.url),
  "utf8",
);

test("LOT4A: les student_grade sont routés vers le processeur CAS Cloud", () => {
  assert.match(pushRoute, /operation\.entity_type === "student_grade"/);
  assert.match(pushRoute, /processRelayStudentGradeSyncOperationV4/);
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
  assert.match(cli, /from "\.\/cloud-sync-grade-v4\.mjs"/);
  assert.match(cli, /requeueTimetableReplacementChain.*cloud-sync\.mjs/s);
});

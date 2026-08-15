import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const helper = fs.readFileSync(
  new URL("../src/lib/relay-grade-version-snapshot.ts", import.meta.url),
  "utf8",
);
const pullRoute = fs.readFileSync(
  new URL("../src/app/api/relay/sync/pull/route.ts", import.meta.url),
  "utf8",
);

test("LOT4A pull: les versions sont lues dans le périmètre établissement + student_grade", () => {
  assert.match(helper, /from\("relay_entity_versions"\)/);
  assert.match(helper, /eq\("institution_id", institutionId\)/);
  assert.match(helper, /eq\("entity_type", "student_grade"\)/);
  assert.match(helper, /select\("entity_id,server_version"\)/);
});

test("LOT4A pull: aucune note active ne retombe silencieusement à la version 0", () => {
  assert.match(helper, /student_grade_version_missing/);
  assert.doesNotMatch(helper, /server_version:\s*0/);
  assert.match(helper, /server_version: version/);
});

test("LOT4A pull: tout client V4 reçoit les versions, le canary ne gouverne que le CAS", () => {
  assert.match(pullRoute, /grade_sync_v4_enabled/);
  assert.match(pullRoute, /x-moncahier-grade-sync-v4/);
  assert.match(pullRoute, /const gradeV4Capable =/);
  assert.match(pullRoute, /const gradeV4Enabled =/);
  assert.match(pullRoute, /attachRelayStudentGradeVersions/);
  assert.match(
    pullRoute,
    /const snapshot = academicChanged && gradeV4Capable\s*\? await attachRelayStudentGradeVersions\(service, institutionId, rawSnapshot\)\s*:\s*rawSnapshot;/s,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { schoolSettingsRevision } from "../src/lib/school-settings-write.ts";

const route = "src/app/api/admin/bulletin-model-selection/route.ts";
const url = "https://example.invalid/api/admin/bulletin-model-selection";
const req = (payload) => new NextRequest(url, {
  method: "PATCH",
  headers: { origin: "https://example.invalid", "content-type": "application/json" },
  body: JSON.stringify(payload),
});
function setup() {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1 = {
    version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
    teachingTracksByCycle: { primary: ["french", "arabic"], secondary: ["french", "arabic"] },
    subjectTracksByCycle: {}, classCycleById: {}, defaultView: "all",
  };
  db.tables.institutions[0].settings_json.franco_arabic_reports_v1 = {
    version: 1, enabled: true, engine: "specialized", coefficientSource: "institution",
    format: "separate",
    scales: [{ cycle: "primary", level: "CP1", track: "french", maxScore: 10 }],
    coefficients: [],
  };
  return db;
}
test("school admin saves primary model only, preserving active engine and other settings", async () => {
  const db = setup();
  const before = structuredClone(db.tables.institutions[0].settings_json);
  const revision = schoolSettingsRevision(before);
  const response = await createFixtureRouteLoader(db, db.legacyAdminId)(route).PATCH(req({
    cycle: "primary", format: "combined", revision,
  }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const result = await response.json();
  assert.equal(result.active, true);
  const saved = db.tables.institutions[0].settings_json;
  assert.equal(saved.franco_arabic_reports_v1.formatsByCycle.primary, "combined");
  assert.equal(saved.franco_arabic_reports_v1.formatsByCycle.secondary, undefined);
  assert.equal(saved.franco_arabic_reports_v1.format, "separate");
  assert.equal(saved.franco_arabic_reports_v1.engine, "specialized");
  assert.deepEqual(saved.franco_arabic_reports_v1.scales, before.franco_arabic_reports_v1.scales);
  assert.deepEqual(saved.franco_arabic_reports_v1.coefficients, before.franco_arabic_reports_v1.coefficients);
  assert.equal(saved.legacy_csca_fixture, before.legacy_csca_fixture);
  assert.equal(db.calls.some(call => call.op !== "read" && call.table !== "institutions"), false);
  const stale = await createFixtureRouteLoader(db, db.legacyAdminId)(route).PATCH(req({
    cycle: "primary", format: "both", revision,
  }));
  assert.equal(stale.status, 409);
  const freshRevision = schoolSettingsRevision(db.tables.institutions[0].settings_json);
  const blockedSecondary = await createFixtureRouteLoader(db, db.legacyAdminId)(route).PATCH(req({
    cycle: "secondary", format: "both", revision: freshRevision,
  }));
  assert.equal(blockedSecondary.status, 400);
  assert.equal((await blockedSecondary.json()).error, "secondary_uses_historical_bulletin");
  assert.equal(saved.franco_arabic_reports_v1.formatsByCycle.secondary, undefined);
});
test("authorization, cycle, and format validation fail without writes", async () => {
  const db = setup();
  const rev = schoolSettingsRevision(db.tables.institutions[0].settings_json);
  for (const payload of [
    { cycle: "unknown", format: "both", revision: rev },
    { cycle: "primary", format: "average_franco_arabic", revision: rev },
  ]) {
    const response = await createFixtureRouteLoader(db, db.legacyAdminId)(route).PATCH(req(payload));
    assert.equal(response.status, 400);
  }
  assert.equal((await createFixtureRouteLoader(db, null)(route).PATCH(req({
    cycle: "primary", format: "both", revision: rev,
  }))).status, 401);
  assert.equal((await createFixtureRouteLoader(db, db.superId)(route).PATCH(req({
    cycle: "primary", format: "both", revision: rev,
  }))).status, 403);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

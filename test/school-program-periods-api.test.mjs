import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const route = "src/app/api/admin/school-program-periods/route.ts";
const endpoint = "/api/admin/school-program-periods";
const req = (path, method = "GET", body) => new NextRequest("https://example.invalid" + path, {
  method, headers: { origin: "https://example.invalid", "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function make() {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1 = {
    version: 1, enabled: true, enabledCycles: ["preschool", "primary", "secondary"],
    teachingTracksByCycle: { preschool: ["french", "arabic"], primary: ["french", "arabic"], secondary: ["french", "arabic"] },
  };
  db.tables.academic_years.push({
    id: "year1", institution_id: db.legacyId, code: "2026-2027",
    is_current: true, start_date: "2026-09-15",
  });
  return db;
}
const period = {
  code: "T1", label: "1er trimestre", shortLabel: "Trim. 1",
  kind: "trimester", startDate: "2026-09-15", endDate: "2026-12-15", active: true,
};
test("scoped French/Arabic periods remain independent and cannot replace school settings", async () => {
  const db = make(), api = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const before = await (await api.GET(req(endpoint))).json();
  assert.deepEqual(before.programs.length, 6);
  const saved = await api.PUT(req(endpoint, "PUT", {
    revision: before.revision, year: "2026-2027", cycle: "primary", track: "arabic", periods: [period],
  }));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const stored = db.tables.institutions[0].settings_json;
  assert.equal(stored.school_program_periods_v1.years["2026-2027"].primary.arabic[0].code, "T1");
  assert.equal(stored.legacy_csca_fixture, true);
  const french = await (await api.GET(req(endpoint + "?cycle=primary&track=french"))).json();
  assert.deepEqual(french.periods, []);
  const arabic = await (await api.GET(req(endpoint + "?cycle=primary&track=arabic"))).json();
  assert.equal(arabic.periods.length, 1);
  const stale = await api.PUT(req(endpoint, "PUT", {
    revision: before.revision, year: "2026-2027", cycle: "primary", track: "arabic", periods: [],
  }));
  assert.equal(stale.status, 409);
  assert.equal(db.calls.some(row => row.op !== "read" && row.table !== "institutions"), false);
});
test("invalid school programs and primary coefficients fail without any write", async () => {
  const db = make(), api = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const current = await (await api.GET(req(endpoint))).json();
  for (const body of [
    { cycle: "unknown", track: "arabic", periods: [period] },
    { cycle: "primary", track: "arabic", periods: [{ ...period, weight: 2 }] },
    { cycle: "preschool", track: "french", periods: [{ ...period, weight: 1 }] },
    { cycle: "primary", track: "arabic", periods: [{ ...period, startDate: "2026-12-20", endDate: "2026-12-15" }] },
  ]) {
    const response = await api.PUT(req(endpoint, "PUT", {
      revision: current.revision, year: current.year, ...body,
    }));
    assert.equal(response.status, 400, JSON.stringify(await response.clone().json()));
  }
  assert.equal(db.calls.some(row => row.op !== "read"), false);
});
test("ordinary schools, super admin and unauthenticated visitors cannot write scoped periods", async () => {
  const ordinary = createMulticycleFixture();
  const base = createFixtureRouteLoader(ordinary, ordinary.legacyAdminId)(route);
  assert.equal((await base.GET(req(endpoint))).status, 404);
  const school = make();
  assert.equal((await createFixtureRouteLoader(school, null)(route).GET(req(endpoint))).status, 401);
  assert.equal((await createFixtureRouteLoader(school, school.superId)(route).GET(req(endpoint))).status, 403);
  assert.equal(school.calls.some(row => row.op !== "read"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const route = "src/app/api/admin/school-directors/route.ts";
const url = "https://fixture.invalid/api/admin/school-directors";
const school = () => {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1 = {
    version: 1, enabled: true, enabledCycles: ["preschool", "primary", "secondary"],
    teachingTracksByCycle: {
      preschool: ["french", "arabic"], primary: ["french", "arabic"],
      secondary: ["french", "arabic"],
    }, subjectTracksByCycle: {}, classCycleById: {},
  };
  return db;
};
const post = body => new NextRequest(url, {
  method: "POST", headers: { origin: "https://fixture.invalid", "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("director management rejects unrelated schools, unauthenticated users, and unauthorized roles", async () => {
  const classic = createMulticycleFixture();
  const rejected = await createFixtureRouteLoader(classic, classic.legacyAdminId)(route)
    .POST(post({ track: "french", name: "Direction Exemple", phone: "+2250700000000" }));
  assert.equal(rejected.status, 403);
  assert.equal(classic.calls.some(x => x.op !== "read"), false);
  const db = school();
  const forbidden = await createFixtureRouteLoader(db, null)(route).GET();
  assert.equal(forbidden.status, 401);
  assert.equal(db.calls.some(x => x.op !== "read"), false);
});

test("director nomination rejects bad tracks and invalid phone without creating an Auth user", async () => {
  const db = school();
  let created = false;
  db.service.auth = { admin: { createUser: async () => { created = true; throw Error("unexpected"); } } };
  const load = createFixtureRouteLoader(db, db.legacyAdminId);
  for (const body of [
    { track: "english", name: "Direction Exemple", phone: "+2250700000000" },
    { track: "arabic", name: "Direction Exemple", phone: "0700000000" },
  ]) {
    const r = await load(route).POST(post(body));
    assert.equal(r.status, 400);
  }
  assert.equal(created, false);
  assert.equal(db.calls.some(x => x.op !== "read"), false);
});

test("one school director can be nominated without changing any classic school profile", async () => {
  const db = school();
  const profileId = "44444444-4444-4444-8444-444444444444";
  db.service.auth = { admin: {
    createUser: async () => ({ data: { user: { id: profileId } }, error: null }),
    deleteUser: async () => ({ error: null }),
  } };
  const load = createFixtureRouteLoader(db, db.legacyAdminId);
  const response = await load(route).POST(post({
    track: "arabic", name: "Directeur arabe de démonstration",
    phone: "+2250700000000",
  }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const result = await response.json();
  assert.match(result.temporary_password, /^[A-Za-z0-9_-]{20,}$/);
  const grant = db.tables.user_roles.find(x => x.profile_id === profileId);
  assert.equal(grant.role, "teaching_director");
  assert.equal(grant.institution_id, db.legacyId);
  const assignment = db.tables.school_teaching_directors[0];
  assert.equal(assignment.teaching_track, "arabic");
  assert.equal(assignment.profile_id, profileId);
  assert.equal(db.tables.institutions[0].settings_json.legacy_csca_fixture, true);
  const again = await load(route).POST(post({
    track: "arabic", name: "Autre directeur", phone: "+2250744444444",
  }));
  assert.equal(again.status, 409);
  assert.equal(db.tables.school_teaching_directors.length, 1);
});

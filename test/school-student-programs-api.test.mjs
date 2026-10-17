import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const routePath = "src/app/api/admin/school-student-programs/route.ts";
const api = "/api/admin/school-student-programs";
const c1 = "11111111-1111-4111-8111-111111111111";
const s1 = "22222222-2222-4222-8222-222222222222";
const s2 = "33333333-3333-4333-8333-333333333333";
const stranger = "44444444-4444-4444-8444-444444444444";
const request = (url, method = "GET", body, origin = "https://example.invalid") =>
  new NextRequest(`https://example.invalid${url}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function setup() {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1 = {
    version: 1,
    enabled: true,
    enabledCycles: ["primary"],
    teachingTracksByCycle: { primary: ["french", "arabic"] },
    classCycleById: {},
    subjectTracksByCycle: {},
    defaultView: "all",
  };
  db.tables.academic_years.push({
    id: "academic-current", institution_id: db.legacyId,
    code: "2026-2027", is_current: true, start_date: "2026-09-01",
  });
  db.tables.classes.push({
    id: c1, institution_id: db.legacyId, academic_year: "2026-2027",
    label: "CP1 A", level: "CP1",
  });
  for (const [id, firstName] of [[s1, "Awa"], [s2, "Ibrahim"]]) {
    db.tables.class_enrollments.push({
      id: `enrolment-${id}`, institution_id: db.legacyId,
      class_id: c1, student_id: id, end_date: null,
    });
    (db.tables.students ||= []).push({
      id, institution_id: db.legacyId, first_name: firstName,
      last_name: "Test", full_name: `${firstName} Test`, matricule: id,
    });
  }
  return db;
}

test("verified admin can save one class default with individual Arabic exceptions, no duplicate students", async () => {
  const db = setup();
  const handler = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const before = await handler.GET(request(`${api}?class_id=${c1}`));
  assert.equal(before.status, 200, JSON.stringify(await before.clone().json()));
  const data = await before.json();
  assert.equal(data.students.length, 2);
  assert.deepEqual(data.availableTracks, ["french", "arabic"]);
  const result = await handler.PUT(request(api, "PUT", {
    revision: data.revision, classId: c1,
    defaultTracks: ["french", "arabic"], overrides: { [s2]: ["arabic"] },
  }));
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  const read = await (await handler.GET(request(`${api}?class_id=${c1}`))).json();
  assert.deepEqual(read.defaultTracks, ["french", "arabic"]);
  assert.deepEqual(read.students.find(x => x.id === s2).tracks, ["arabic"]);
  assert.equal(db.tables.students.length, 2);
  assert.equal(db.tables.class_enrollments.length, 2);
  assert.equal(db.tables.institutions[0].settings_json.legacy_csca_fixture, true);
  assert.equal(db.calls.some(row => row.op !== "read" && row.table !== "institutions"), false);
});

test("conflicting revisions and a foreign/non-enrolled student are rejected without any writes", async () => {
  const db = setup();
  const handler = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const data = await (await handler.GET(request(api))).json();
  const before = db.calls.filter(row => row.op !== "read").length;
  const foreign = await handler.PUT(request(api, "PUT", {
    revision: data.revision, classId: c1,
    defaultTracks: ["arabic"], overrides: { [stranger]: ["french"] },
  }));
  assert.equal(foreign.status, 403);
  assert.equal(db.calls.filter(row => row.op !== "read").length, before);
  const invalidTrack = await handler.PUT(request(api, "PUT", {
    revision: data.revision, classId: c1,
    defaultTracks: ["english"], overrides: {},
  }));
  assert.equal(invalidTrack.status, 400);
  const saved = await handler.PUT(request(api, "PUT", {
    revision: data.revision, classId: c1,
    defaultTracks: ["french"], overrides: {},
  }));
  assert.equal(saved.status, 200);
  const stale = await handler.PUT(request(api, "PUT", {
    revision: data.revision, classId: c1,
    defaultTracks: ["arabic"], overrides: {},
  }));
  assert.equal(stale.status, 409);
  assert.deepEqual(db.tables.institutions[0].settings_json.school_student_programs_v1
    .years["2026-2027"].classes[c1].tracks, ["french"]);
});

test("existing schools and unauthorized actors cannot edit bilingual memberships", async () => {
  const ordinary = createMulticycleFixture();
  ordinary.tables.academic_years.push({
    institution_id: ordinary.legacyId, code: "2026-2027",
    is_current: true, start_date: "2026-09-01",
  });
  const ordinaryAdmin = createFixtureRouteLoader(ordinary, ordinary.legacyAdminId)(routePath);
  assert.equal((await ordinaryAdmin.GET(request(api))).status, 404);
  assert.equal(ordinary.calls.some(row => row.op !== "read"), false);

  const db = setup();
  const actors = [null, db.superId];
  for (const actor of actors) {
    const handler = createFixtureRouteLoader(db, actor)(routePath);
    const response = await handler.GET(request(api));
    assert.equal(response.status, actor ? 403 : 401);
  }
  assert.equal(db.calls.some(row => row.op !== "read"), false);
});

test("unrecognized Arabic school level needs explicit cycle assignment, never defaults to secondary", async () => {
  const db = setup();
  db.tables.classes[0].level = "Niveau arabe spécifique";
  const handler = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const read = await (await handler.GET(request(`${api}?class_id=${c1}`))).json();
  assert.equal(read.classes.find(row => row.id === c1).cycle, null);
  assert.deepEqual(read.availableTracks, []);
  const response = await handler.PUT(request(api, "PUT", {
    classId: c1, revision: read.revision,
    defaultTracks: ["arabic"], overrides: {},
  }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "class_cycle_requires_configuration");
  assert.equal(db.calls.some(row => row.op !== "read"), false);
});

test("one pupil appears in separate French and Arabic classes without a second administrative enrollment", async () => {
  const db = setup();
  const classArabic = "55555555-5555-4555-8555-555555555555";
  db.tables.classes.push({ id: classArabic, institution_id: db.legacyId,
    academic_year: "2026-2027", label: "CP1 — Arabe", level: "CP1" });
  const handler = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const first = await (await handler.GET(request(api))).json();
  const homeSaved = await handler.PUT(request(api, "PUT", {
    revision: first.revision, classId: c1, defaultTracks: ["french"], overrides: {},
  }));
  assert.equal(homeSaved.status, 200);
  const arabicBefore = await (await handler.GET(request(`${api}?class_id=${classArabic}`))).json();
  assert.deepEqual(arabicBefore.candidates.map(row => row.id).sort(), [s1, s2].sort());
  const linked = await handler.PUT(request(api, "PUT", {
    revision: arabicBefore.revision, classId: classArabic,
    defaultTracks: ["arabic"], overrides: {}, linkedStudentIds: [s1],
  }));
  assert.equal(linked.status, 200, JSON.stringify(await linked.clone().json()));
  const result = await (await handler.GET(request(`${api}?class_id=${classArabic}`))).json();
  assert.deepEqual(result.defaultTracks, ["arabic"]);
  assert.deepEqual(result.linkedStudentIds, [s1]);
  assert.equal(db.tables.class_enrollments.length, 2);
  assert.equal(db.tables.students.length, 2);
  const rejected = await handler.PUT(request(api, "PUT", {
    revision: result.revision, classId: classArabic, defaultTracks: ["arabic"],
    overrides: {}, linkedStudentIds: [stranger],
  }));
  assert.equal(rejected.status, 403);
  assert.equal(db.tables.class_enrollments.length, 2);
});

test("additional class must be at the same academic level", async () => {
  const db = setup();
  const other = "55555555-5555-4555-8555-555555555555";
  db.tables.classes.push({ id: other, institution_id: db.legacyId,
    academic_year: "2026-2027", label: "CE1 — Arabe", level: "CE1" });
  const handler = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const first = await (await handler.GET(request(api))).json();
  assert.equal((await handler.PUT(request(api, "PUT", {
    revision: first.revision, classId: c1, defaultTracks: ["french"], overrides: {},
  }))).status, 200);
  const next = await (await handler.GET(request(api))).json();
  const invalid = await handler.PUT(request(api, "PUT", {
    revision: next.revision, classId: other, defaultTracks: ["arabic"],
    overrides: {}, linkedStudentIds: [s1],
  }));
  assert.equal(invalid.status, 403);
});

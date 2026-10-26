import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const route = "src/app/api/admin/school-class-subjects/route.ts";
const url = "/api/admin/school-class-subjects";
const cFr = "11111111-1111-4111-8111-111111111111";
const cAr = "22222222-2222-4222-8222-222222222222";
const subjectFr = "33333333-3333-4333-8333-333333333333";
const subjectAr = "44444444-4444-4444-8444-444444444444";
const foreign = "55555555-5555-4555-8555-555555555555";
const req = (path, method = "GET", body) => new NextRequest("https://example.invalid" + path, {
  method, headers: { origin: "https://example.invalid", "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function setup() {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1 = {
    version: 1, enabled: true, enabledCycles: ["primary"],
    classCycleById: { [cFr]: "primary", [cAr]: "primary" },
    teachingTracksByCycle: { primary: ["french", "arabic"] },
    subjectTracksByCycle: { primary: { [subjectFr]: ["french"], [subjectAr]: ["arabic"] } },
    defaultView: "all",
  };
  db.tables.institutions[0].settings_json.school_student_programs_v1 = {
    version: 1, years: { "2026-2027": { classes: {
      [cFr]: { tracks: ["french"], students: {} },
      [cAr]: { tracks: ["arabic"], students: {} },
    } } },
  };
  db.tables.academic_years.push({
    id: "year-1", institution_id: db.legacyId, code: "2026-2027",
    is_current: true, start_date: "2026-09-14",
  });
  db.tables.classes.push(
    { id: cFr, institution_id: db.legacyId, academic_year: "2026-2027", label: "CP1 — Français", level: "CP1" },
    { id: cAr, institution_id: db.legacyId, academic_year: "2026-2027", label: "CP1 — Arabe", level: "CP1" },
  );
  db.tables.institution_subjects.push(
    { id: "active-fr", institution_id: db.legacyId, subject_id: subjectFr, is_active: true },
    { id: "active-ar", institution_id: db.legacyId, subject_id: subjectAr, is_active: true },
  );
  db.tables.subjects.push(
    { id: subjectFr, name: "Mathématiques" }, { id: subjectAr, name: "Hadith" },
  );
  return db;
}

test("school admin lists only subjects for the selected physical class teaching", async () => {
  const db = setup(), api = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const data = await (await api.GET(req(url + "?class_id=" + cAr))).json();
  assert.equal(data.academicYear, "2026-2027");
  assert.equal(data.classes.length, 2);
  assert.deepEqual(data.subjects.map(s => s.id), [subjectAr]);
  assert.deepEqual(data.selectedSubjectIds, []);
});
test("les matières du CP arabe sont préselectionnées depuis les affectations et le français est préservé", async () => {
  const db = setup();
  db.tables.class_teachers.push(
    { id: "assign-fr", institution_id: db.legacyId, class_id: cFr, subject_id: "active-fr", teacher_id: "teacher-fr", end_date: null },
    { id: "assign-ar", institution_id: db.legacyId, class_id: cAr, subject_id: "active-ar", teacher_id: "teacher-ar", end_date: null },
  );
  const api = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const before = await (await api.GET(req(url + "?class_id=" + cAr))).json();
  assert.deepEqual(before.selectedSubjectIds, [subjectAr]);
  const response = await api.PUT(req(url, "PUT", {
    revision: before.revision, classId: cAr, subjectIds: [subjectAr],
  }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const classes = db.tables.institutions[0].settings_json.school_class_subjects_v1.years["2026-2027"].classes;
  assert.deepEqual(classes[cAr], [subjectAr]);
  assert.deepEqual(classes[cFr], [subjectFr]);
});

test("saving Arabic class subjects preserves French class, unrelated settings, and history", async () => {
  const db = setup(), api = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const before = await (await api.GET(req(url + "?class_id=" + cAr))).json();
  const response = await api.PUT(req(url, "PUT", {
    revision: before.revision, classId: cAr, subjectIds: [subjectAr],
  }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const settings = db.tables.institutions[0].settings_json;
  assert.deepEqual(settings.school_class_subjects_v1.years["2026-2027"].classes[cAr], [subjectAr]);
  assert.deepEqual(settings.school_student_programs_v1.years["2026-2027"].classes[cAr].tracks, ["arabic"]);
  assert.equal(settings.legacy_csca_fixture, true);
  assert.equal(db.calls.some(call => call.op !== "read" && call.table !== "institutions"), false);
  const stale = await api.PUT(req(url, "PUT", {
    revision: before.revision, classId: cAr, subjectIds: [],
  }));
  assert.equal(stale.status, 409);
  assert.deepEqual(settings.school_class_subjects_v1.years["2026-2027"].classes[cAr], [subjectAr]);
});
test("foreign classes, cross-teaching subjects and inactive subjects fail closed", async () => {
  const db = setup(), api = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const before = await (await api.GET(req(url))).json();
  const invalid = [
    { classId: foreign, subjectIds: [subjectAr], expected: 404 },
    { classId: cAr, subjectIds: [subjectFr], expected: 400 },
    { classId: cAr, subjectIds: [foreign], expected: 400 },
    { classId: cAr, subjectIds: [subjectAr, subjectAr], expected: 400 },
  ];
  for (const item of invalid) {
    const result = await api.PUT(req(url, "PUT", {
      revision: before.revision, classId: item.classId, subjectIds: item.subjectIds,
    }));
    assert.equal(result.status, item.expected);
  }
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});
test("ordinary schools and unauthorized users cannot edit class curriculum", async () => {
  const legacy = createMulticycleFixture();
  const handler = createFixtureRouteLoader(legacy, legacy.legacyAdminId)(route);
  assert.equal((await handler.GET(req(url))).status, 404);
  const db = setup();
  assert.equal((await createFixtureRouteLoader(db, null)(route).GET(req(url))).status, 401);
  assert.equal((await createFixtureRouteLoader(db, db.superId)(route).GET(req(url))).status, 403);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const home = "11111111-1111-4111-8111-111111111111";
const arabic = "22222222-2222-4222-8222-222222222222";
const pupil = "33333333-3333-4333-8333-333333333333";
const outside = "44444444-4444-4444-8444-444444444444";
const routePath = "src/app/api/admin/classes/[id]/arabic-names/route.ts";
const context = () => ({ params: Promise.resolve({ id: arabic }) });
const request = updates => new NextRequest(`http://localhost:10000/api/admin/classes/${arabic}/arabic-names`, {
  method: "PATCH", headers: { origin: "https://mon-cahier.com", "content-type": "application/json" },
  body: JSON.stringify({ updates }),
});
function setup() {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json = {
    school_cycles_v1: { version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
      teachingTracksByCycle: { primary: ["arabic"], secondary: ["french"] } },
    school_student_programs_v1: { version: 1, years: { "2026-2027": { classes: {
      [home]: { tracks: ["french"], students: {} },
      [arabic]: { tracks: ["arabic"], students: {}, linkedStudentIds: [pupil] },
    } } } },
  };
  db.tables.classes = [
    { id: home, institution_id: db.legacyId, level: "6ème", academic_year: "2026-2027" },
    { id: arabic, institution_id: db.legacyId, level: "CP1", academic_year: "2026-2027" },
  ];
  db.tables.students = [{ id: pupil, institution_id: db.legacyId, matricule: "TEST-AR-01",
    first_name: "Élève", last_name: "Fictif", full_name_ar: "محمد تراوري" },
    { id: outside, institution_id: db.legacyId, first_name: "Hors", last_name: "Classe" }];
  db.tables.class_enrollments = [{ id: "home-enrollment", institution_id: db.legacyId,
    class_id: home, student_id: pupil, end_date: null }];
  return db;
}

test("Arabic spelling correction persists and is reloaded for a pupil in French secondary / Arabic primary", async () => {
  const db = setup();
  const before = structuredClone(db.tables);
  const loader = createFixtureRouteLoader(db, db.legacyAdminId);
  const response = await loader(routePath).PATCH(request([{ student_id: pupil, full_name_ar: "محمّد تراوري" }]), context());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(await response.json(), { ok: true, updated: 1 });
  const saved = db.tables.students[0];
  assert.deepEqual(saved, { ...before.students[0], full_name_ar: "محمّد تراوري" });
  const roster = await loader("src/lib/server/school-linked-class-roster.ts").loadLinkedClassEnrollments(
    db.service, db.legacyId, db.tables.classes[1], db.tables.institutions[0].settings_json);
  assert.equal(roster[0].students.full_name_ar, "محمّد تراوري");
  assert.deepEqual(db.tables.class_enrollments, before.class_enrollments);
  assert.deepEqual(db.tables.institutions, before.institutions);
  assert.equal(db.calls.some(call => call.op !== "read" && call.table !== "students"), false);
});

test("Arabic name corrections reject pupils outside the class and invalid spelling without any writes", async () => {
  for (const updates of [[{ student_id: outside, full_name_ar: "محمد" }],
    [{ student_id: pupil, full_name_ar: "French replacement" }]]) {
    const db = setup();
    const before = structuredClone(db.tables);
    const response = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).PATCH(request(updates), context());
    assert.ok([400, 403].includes(response.status));
    assert.deepEqual(db.tables, before);
    assert.equal(db.calls.some(call => call.op !== "read"), false);
  }
});

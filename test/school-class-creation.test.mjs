import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
const route = "src/app/api/admin/classes/bulk/route.ts";
function setup() {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json = { school_cycles_v1: { version: 1, enabled: true,
    enabledCycles: ["preschool", "primary", "secondary"], teachingTracksByCycle: { preschool: ["french"], primary: ["french", "arabic"], secondary: ["french"] } } };
  return db;
}
const request = body => new NextRequest("https://example.invalid/api/admin/classes/bulk", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ academic_year: "2026-2027", format: "alpha", count: 2, ...body }),
});
test("existing class creator handles CP1 and preschool without secondary series or duplicate program classes", async () => {
  const db = setup(); const handler = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  for (const [school_cycle, level] of [["primary", "CP1"], ["preschool", "GS"]]) {
    const result = await handler.POST(request({ school_cycle, level }));
    assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  }
  assert.equal(db.tables.classes.length, 4);
  assert.deepEqual(db.tables.classes.map(row => row.label), ["CP1A", "CP1B", "GSA", "GSB"]);
  assert.ok(db.tables.classes.every(row => row.official_track_code === null));
  assert.ok(db.tables.classes.every(row => row.institution_id === db.legacyId));
  assert.equal(db.calls.some(call => ["students", "grade_evaluations", "student_grades"].includes(call.table)), false);
});
test("the historical secondary class creation payload is still accepted", async () => {
  const db = createMulticycleFixture();
  const result = await createFixtureRouteLoader(db, db.legacyAdminId)(route).POST(request({ level: "6e" }));
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.equal(db.tables.classes.length, 2);
  assert.ok(db.tables.classes.every(row => row.official_track_code === "6eme"));
});
test("an opt-in school keeps primary classes and secondary alias resolution in the existing listing", async () => {
  const db = setup();
  db.tables.classes = [{ id: "class-1", institution_id: db.legacyId, academic_year: "2026-2027", label: "CP1A", level: "CP1" },
    { id: "class-2", institution_id: db.legacyId, academic_year: "2026-2027", label: "CP1B", level: "CP1" },
    { id: "class-3", institution_id: db.legacyId, academic_year: "2026-2027", label: "1D1", level: "1D" },
    { id: "class-4", institution_id: db.legacyId, academic_year: "2026-2027", label: "1eD1", level: "1eD" }];
  const response = await createFixtureRouteLoader(db, db.legacyAdminId)("src/app/api/admin/classes/route.ts").GET(
    new NextRequest("https://example.invalid/api/admin/classes?academic_year=2026-2027&school_cycle=all"));
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.items.filter(row => row.level === "CP1").length, 2);
  assert.equal(data.items.length, 3);
});
test("cycle, level, series and role mismatches cannot create early-cycle classes", async () => {
  for (const body of [{ school_cycle: "primary", level: "6e" }, { school_cycle: "preschool", level: "CP1" },
    { school_cycle: "primary", level: "CP1", official_track_code: "6eme" }]) {
    const db = setup();
    const result = await createFixtureRouteLoader(db, db.legacyAdminId)(route).POST(request(body));
    assert.equal(result.status, 400); assert.equal(db.tables.classes.length, 0);
  }
  const db = setup(); db.tables.user_roles = db.tables.user_roles.map(row => row.profile_id === db.legacyAdminId ? { ...row, role: "teacher" } : row);
  const denied = await createFixtureRouteLoader(db, db.legacyAdminId)(route).POST(request({ school_cycle: "primary", level: "CP1" }));
  assert.equal(denied.status, 403); assert.equal(db.tables.classes.length, 0);
});
test("the existing coefficient administration exposes primary levels and keeps its stored values", async () => {
  const db = setup(), subjectId = "11111111-1111-4111-8111-111111111111";
  db.tables.classes = [{ id: "class-primary", institution_id: db.legacyId, level: "CP1", label: "CP1A", education_type: "general_secondary" }];
  db.tables.institution_subjects = [{ id: "subject-link", institution_id: db.legacyId, subject_id: subjectId, is_active: true, subjects: { name: "Lecture" } }];
  db.tables.institution_subject_coeffs = [{ institution_id: db.legacyId, level: "CP1", subject_id: subjectId, coeff: 3, include_in_average: true }];
  const response = await createFixtureRouteLoader(db, db.legacyAdminId)("src/app/api/admin/institution/subject-coeffs/route.ts").GET(new NextRequest("https://example.invalid/api/admin/institution/subject-coeffs"));
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
  assert.ok(data.levels.some(row => row.level === "CP1" && row.education_label === "Primaire"));
  assert.equal(data.items.find(row => row.level === "CP1" && row.subject_id === subjectId).coeff, 3);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const routePath = "src/app/api/admin/classes/arabic-link/route.ts";
const baseUrl = "https://example.invalid/api/admin/classes/arabic-link";
const homeId = "11111111-1111-4111-8111-111111111111";
const arabicId = "22222222-2222-4222-8222-222222222222";
const arabicNextId = "33333333-3333-4333-8333-333333333333";
const studentId = "44444444-4444-4444-8444-444444444444";
const foreignId = "55555555-5555-4555-8555-555555555555";

function setup() {
  const db = createMulticycleFixture();
  const settings = db.tables.institutions[0].settings_json;
  settings.school_cycles_v1 = {
    version: 1, enabled: true, enabledCycles: ["primary"],
    teachingTracksByCycle: { primary: ["french", "arabic"] },
    classCycleById: {}, subjectTracksByCycle: {}, defaultView: "all",
  };
  settings.school_student_programs_v1 = {
    version: 1, years: { "2026-2027": { classes: {
      [homeId]: { tracks: ["french"], students: {} },
      [arabicId]: { tracks: ["arabic"], students: {} },
      [arabicNextId]: { tracks: ["arabic"], students: {} },
    } } },
  };
  for (const [id, label] of [
    [homeId, "CP1 Français"], [arabicId, "CP1 Arabe"],
    [arabicNextId, "CP1 Arabe B"],
  ]) {
    db.tables.classes.push({
      id, label, level: "CP1", institution_id: db.legacyId,
      academic_year: "2026-2027",
    });
  }
  db.tables.students.push({
    id: studentId, first_name: "Awa", last_name: "Kouadio",
    matricule: "EPC260001", institution_id: db.legacyId,
  });
  db.tables.class_enrollments.push({
    id: "enrollment-source", class_id: homeId, student_id: studentId,
    institution_id: db.legacyId, end_date: null,
  });
  return db;
}

const request = (classId, pupilId = studentId, matricule = "") => new NextRequest(baseUrl, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://example.invalid" },
  body: JSON.stringify({ class_id: classId, student_id: pupilId, matricule }),
});

test("Arabic add links an existing French pupil without an extra enrollment or finance mutation", async () => {
  const db = setup();
  const route = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const response = await route.POST(request(arabicId));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const result = await response.json();
  assert.equal(result.student.id, studentId);
  const classes = db.tables.institutions[0].settings_json.school_student_programs_v1.years["2026-2027"].classes;
  assert.deepEqual(classes[arabicId].linkedStudentIds, [studentId]);
  assert.equal(db.tables.class_enrollments.length, 1);
  assert.equal(db.tables.class_enrollments[0].class_id, homeId);
  assert.equal(db.calls.some(call => call.op !== "read" && call.table !== "institutions"), false);
  const repeat = await route.POST(request(arabicId));
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).already_present, true);
});

test("Transferring between Arabic classes only relocates the pedagogical link", async () => {
  const db = setup();
  const route = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  assert.equal((await route.POST(request(arabicId))).status, 200);
  const response = await route.POST(request(arabicNextId, "", "EPC260001"));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).transferred, true);
  const policies = db.tables.institutions[0].settings_json.school_student_programs_v1.years["2026-2027"].classes;
  assert.deepEqual(policies[arabicId].linkedStudentIds, []);
  assert.deepEqual(policies[arabicNextId].linkedStudentIds, [studentId]);
  assert.equal(db.tables.class_enrollments.length, 1);
  assert.equal(db.tables.class_enrollments[0].class_id, homeId);
});

test("Reject out-of-level, unconfigured, foreign and unauthorized links without writes", async () => {
  const db = setup();
  const route = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const before = () => db.calls.filter(row => row.op !== "read").length;
  const original = before();
  const absent = await route.POST(request(arabicId, foreignId));
  assert.equal(absent.status, 404);
  db.tables.classes.find(item => item.id === homeId).level = "CE1";
  const badLevel = await route.POST(request(arabicId));
  assert.equal(badLevel.status, 409);
  db.tables.classes.find(item => item.id === homeId).level = "CP1";
  db.tables.institutions[0].settings_json.school_student_programs_v1.years["2026-2027"].classes[arabicId].tracks = ["french"];
  assert.equal((await route.POST(request(arabicId))).status, 409);
  assert.equal(before(), original);
  assert.equal((await createFixtureRouteLoader(db, null)(routePath).POST(request(arabicId))).status, 401);
});

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
  (db.tables.students ||= []).push({
    id: studentId, first_name: "Awa", last_name: "Kouadio",
    matricule: "EPC260001", institution_id: db.legacyId,
  });
  db.tables.class_enrollments.push({
    id: "enrollment-source", class_id: homeId, student_id: studentId,
    institution_id: db.legacyId, end_date: null,
  });
  // Only this route uses the new service-only atomic CAS procedure.
  // Do not modify the global test fixture's behavior for other features.
  db.service.rpc = async (name, args) => {
    if (name !== "cas_school_student_programs_v1")
      return { data: null, error: { message: "Unsupported fixture RPC" } };
    db.calls.push({ table: "institutions", op: "update" });
    const school = db.tables.institutions.find(row => row.id === args.p_institution_id);
    if (!school || JSON.stringify(school.settings_json.school_student_programs_v1 ?? null)
      !== JSON.stringify(args.p_previous ?? null)) return { data: false, error: null };
    school.settings_json.school_student_programs_v1 = structuredClone(args.p_next);
    return { data: true, error: null };
  };
  return db;
}

const request = (classId, pupilId = studentId, matricule = "") => new NextRequest(baseUrl, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://example.invalid" },
  body: JSON.stringify({ class_id: classId, student_id: pupilId, matricule }),
});

test("Arabic add links an existing French pupil without an extra enrollment or finance mutation", async () => {
  const db = setup();
  db.tables.institutions[0].settings_json.other_large_setting = "x".repeat(65000);
  const route = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const response = await route.POST(request(arabicId));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const result = await response.json();
  assert.equal(result.student.id, studentId);
  const classes = db.tables.institutions[0].settings_json.school_student_programs_v1.years["2026-2027"].classes;
  assert.deepEqual(classes[arabicId].linkedStudentIds, [studentId]);
  assert.equal(db.tables.class_enrollments.length, 1);
  assert.equal(db.tables.class_enrollments[0].class_id, homeId);
  assert.equal(db.tables.institutions[0].settings_json.other_large_setting.length, 65000);
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

test("Reject cross-cycle, unconfigured, foreign and unauthorized links without writes", async () => {
  const db = setup();
  const route = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const before = () => db.calls.filter(row => row.op !== "read").length;
  const original = before();
  const absent = await route.POST(request(arabicId, foreignId));
  assert.equal(absent.status, 404);
  db.tables.classes.find(item => item.id === homeId).level = "6ème";
  const badCycle = await route.POST(request(arabicId));
  assert.equal(badCycle.status, 409);
  assert.equal((await badCycle.json()).error, "student_not_same_cycle_or_eligible_level");
  db.tables.classes.find(item => item.id === homeId).level = "CP1";
  db.tables.institutions[0].settings_json.school_student_programs_v1.years["2026-2027"].classes[arabicId].tracks = ["french"];
  assert.equal((await route.POST(request(arabicId))).status, 409);
  assert.equal(before(), original);
  assert.equal((await createFixtureRouteLoader(db, null)(routePath).POST(request(arabicId))).status, 401);
});

test("EPC: CP2 Arabic to CP1 Arabic preserves CP2 French and does not duplicate fees", async () => {
  const db = setup();
  db.tables.classes.find(row => row.id === homeId).level = "CP2";
  db.tables.classes.find(row => row.id === homeId).label = "CP2 — Français";
  db.tables.classes.find(row => row.id === arabicId).level = "CP2";
  db.tables.classes.find(row => row.id === arabicId).label = "CP2 — Arabe";
  db.tables.classes.find(row => row.id === arabicNextId).level = "CP1";
  db.tables.classes.find(row => row.id === arabicNextId).label = "CP1 — Arabe";
  const feeSnapshot = structuredClone(db.tables.school_fees || []);
  const handler = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const placed = await handler.POST(request(arabicId));
  assert.equal(placed.status, 200, JSON.stringify(await placed.clone().json()));
  const moved = await handler.POST(request(arabicNextId, "", "EPC260001"));
  assert.equal(moved.status, 200, JSON.stringify(await moved.clone().json()));
  const result = await moved.json();
  assert.equal(result.transferred, true);
  assert.equal(result.cross_level, true);
  assert.equal(result.french_level, "CP2");
  assert.equal(result.arabic_level, "CP1");
  const policies = db.tables.institutions[0].settings_json.school_student_programs_v1.years["2026-2027"].classes;
  assert.deepEqual(policies[arabicId].linkedStudentIds, []);
  assert.deepEqual(policies[arabicNextId].linkedStudentIds, [studentId]);
  assert.equal(db.tables.class_enrollments.length, 1);
  assert.equal(db.tables.class_enrollments[0].class_id, homeId);
  assert.deepEqual(db.tables.school_fees || [], feeSnapshot);
  assert.equal(db.calls.some(call => call.op !== "read" && call.table !== "institutions"), false);
});

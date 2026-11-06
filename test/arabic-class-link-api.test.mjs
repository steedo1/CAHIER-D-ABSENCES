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

const request = (classId, pupilId = studentId, matricule = "", action) => new NextRequest(baseUrl, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://example.invalid" },
  body: JSON.stringify({ class_id: classId, student_id: pupilId, matricule, action }),
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
  const placed = await handler.POST(request(arabicId, studentId, "", "add_teaching"));
  assert.equal(placed.status, 200, JSON.stringify(await placed.clone().json()));
  const moved = await handler.POST(request(arabicNextId, "", "EPC260001", "transfer_teaching"));
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

test("EPC: CM1 French and 5e Arabic share one dossier and one general headcount", async () => {
  const db = setup();
  const settings = db.tables.institutions[0].settings_json;
  settings.school_cycles_v1.enabledCycles.push("secondary");
  settings.school_cycles_v1.teachingTracksByCycle.secondary = ["french", "arabic"];
  const home = db.tables.classes.find(row => row.id === homeId);
  const previous = db.tables.classes.find(row => row.id === arabicId);
  const target = db.tables.classes.find(row => row.id === arabicNextId);
  Object.assign(home, { level: "CM1", label: "CM1 — Français" });
  Object.assign(previous, { level: "CM1", label: "CM1 — Arabe" });
  Object.assign(target, { level: "5ème", label: "5ème — Arabe" });
  db.tables.student_grades = [{ student_id: studentId, evaluation_id: "french-grade", score: 9 }];
  const protectedTables = structuredClone({
    enrollments: db.tables.class_enrollments, students: db.tables.students, grades: db.tables.student_grades,
  });
  const loader = createFixtureRouteLoader(db, db.legacyAdminId);
  const handler = loader(routePath);
  const transferWithoutArabicClass = await handler.POST(request(target.id, studentId, "", "transfer_teaching"));
  assert.equal(transferWithoutArabicClass.status, 409);
  assert.equal((await transferWithoutArabicClass.json()).error, "arabic_enrollment_required_for_transfer");
  assert.equal((await handler.POST(request(previous.id, studentId, "", "add_teaching"))).status, 200);
  const addWithExistingArabicClass = await handler.POST(request(target.id, studentId, "", "add_teaching"));
  assert.equal(addWithExistingArabicClass.status, 409);
  assert.equal((await addWithExistingArabicClass.json()).error, "arabic_enrollment_already_exists");
  db.tables.student_grades.push({ student_id: studentId, evaluation_id: "old-arabic-grade", score: 8 });
  protectedTables.grades.push({ student_id: studentId, evaluation_id: "old-arabic-grade", score: 8 });
  const moved = await handler.POST(request(target.id, studentId, "", "transfer_teaching"));
  assert.equal(moved.status, 200, JSON.stringify(await moved.clone().json()));
  assert.equal((await moved.json()).cross_cycle, true);
  const { loadLinkedClassEnrollments } = loader("src/lib/server/school-linked-class-roster.ts");
  assert.deepEqual(await loadLinkedClassEnrollments(db.service, db.legacyId, previous, settings), []);
  assert.deepEqual((await loadLinkedClassEnrollments(db.service, db.legacyId, target, settings)).map(row => row.student_id), [studentId]);
  const { expandPedagogicalEnrollments, readStudentProgramSettings } = loader("src/lib/school-student-programs.ts");
  const expanded = expandPedagogicalEnrollments(settings.school_cycles_v1,
    readStudentProgramSettings(settings).years["2026-2027"],
    [{ ...home, cycle: "primary" }, { ...previous, cycle: "primary" }, { ...target, cycle: "secondary" }],
    db.tables.class_enrollments);
  assert.deepEqual(expanded.map(row => row.class_id), [home.id, target.id]);
  assert.equal(new Set(expanded.map(row => row.student_id)).size, 1);
  assert.deepEqual({
    enrollments: db.tables.class_enrollments, students: db.tables.students, grades: db.tables.student_grades,
  }, protectedTables);
  assert.equal(db.calls.some(call => call.op !== "read" && call.table !== "institutions"), false);
});

const renderRequest = (origin, classId = arabicNextId, forwarded = {}) => new NextRequest(
  "http://localhost:10000/api/admin/classes/arabic-link", {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...forwarded },
    body: JSON.stringify({ class_id: classId, student_id: studentId }),
  },
);

test("Render: CP2 Arabic to CP1 Arabic works from both official domains behind TLS proxy", async () => {
  for (const origin of ["https://mon-cahier.com", "https://www.mon-cahier.com"]) {
    const db = setup();
    db.tables.classes.find(row => row.id === homeId).level = "CP2";
    db.tables.classes.find(row => row.id === arabicId).level = "CP2";
    const policies = db.tables.institutions[0].settings_json.school_student_programs_v1.years["2026-2027"].classes;
    policies[arabicId].linkedStudentIds = [studentId];
    const enrollments = structuredClone(db.tables.class_enrollments);
    const handler = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
    const response = await handler.POST(renderRequest(origin));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.transferred, true);
    assert.equal(body.cross_level, true);
    const saved = db.tables.institutions[0].settings_json.school_student_programs_v1.years["2026-2027"].classes;
    assert.deepEqual(saved[arabicId].linkedStudentIds, []);
    assert.deepEqual(saved[arabicNextId].linkedStudentIds, [studentId]);
    assert.deepEqual(db.tables.class_enrollments, enrollments);
    assert.equal(db.calls.some(call => call.op !== "read" && call.table !== "institutions"), false);
    const repeat = await handler.POST(renderRequest(origin));
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).already_present, true);
  }
});

test("Render: Arabic transfers reject foreign origins even with forged proxy headers", async () => {
  for (const origin of ["https://evil.invalid", "null", "https://mon-cahier.com.evil.invalid"]) {
    const db = setup();
    const before = structuredClone(db.tables);
    const handler = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
    const response = await handler.POST(renderRequest(origin, arabicNextId, {
      host: "evil.invalid", "x-forwarded-host": "evil.invalid", "x-forwarded-proto": "https",
    }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "invalid_origin");
    assert.deepEqual(db.tables, before);
    assert.equal(db.calls.length, 0);
  }
});

test("Render: official origin does not bypass authentication or institution access", async () => {
  const db = setup();
  const anonymous = await createFixtureRouteLoader(db, null)(routePath)
    .POST(renderRequest("https://mon-cahier.com"));
  assert.equal(anonymous.status, 401);
  db.tables.profiles.find(row => row.id === db.legacyAdminId).institution_id = foreignId;
  const wrongInstitution = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath)
    .POST(renderRequest("https://mon-cahier.com"));
  assert.equal(wrongInstitution.status, 403);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});


test("French and Arabic primary/secondary cycles are independent in both directions", async () => {
  for (const [frenchLevel, arabicLevel, oldArabicLevel] of [
    ["6ème", "CP1", "6ème"], ["CP2", "6ème", "CP1"],
  ]) {
    const db = setup();
    const settings = db.tables.institutions[0].settings_json;
    settings.school_cycles_v1.enabledCycles = ["primary", "secondary"];
    settings.school_cycles_v1.teachingTracksByCycle.secondary = ["french", "arabic"];
    db.tables.classes.find(row => row.id === homeId).level = frenchLevel;
    db.tables.classes.find(row => row.id === arabicId).level = oldArabicLevel;
    db.tables.classes.find(row => row.id === arabicNextId).level = arabicLevel;
    settings.school_student_programs_v1.years["2026-2027"].classes[arabicId].linkedStudentIds = [studentId];
    const enrollment = structuredClone(db.tables.class_enrollments);
    const students = structuredClone(db.tables.students);
    const handler = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
    const response = await handler.POST(renderRequest("https://mon-cahier.com"));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.cross_cycle, true);
    assert.equal(body.transferred, true);
    assert.equal(body.french_level, frenchLevel);
    assert.equal(body.arabic_level, arabicLevel);
    const policies = settings.school_student_programs_v1.years["2026-2027"].classes;
    assert.deepEqual(policies[arabicId].linkedStudentIds, []);
    assert.deepEqual(policies[arabicNextId].linkedStudentIds, [studentId]);
    const classroom = db.tables.classes.find(row => row.id === arabicNextId);
    const loader = createFixtureRouteLoader(db, db.legacyAdminId);
    const roster = await loader("src/lib/server/school-linked-class-roster.ts")
      .loadLinkedClassEnrollments(db.service, db.legacyId, classroom, settings);
    assert.deepEqual(roster.map(row => row.student_id), [studentId]);
    assert.deepEqual(db.tables.class_enrollments, enrollment);
    assert.deepEqual(db.tables.students, students);
    assert.equal(db.calls.some(call => call.op !== "read" && call.table !== "institutions"), false);
  }
});

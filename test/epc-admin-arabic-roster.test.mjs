import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const route = "src/app/api/admin/students/route.ts";
const home = "11111111-1111-4111-8111-111111111111";
const arabic = "22222222-2222-4222-8222-222222222222";
const first = "33333333-3333-4333-8333-333333333333";
const second = "44444444-4444-4444-8444-444444444444";
const endpoint = (suffix = "") =>
  new NextRequest(`https://example.invalid/api/admin/students?academic_year=all${suffix}`);

function setup() {
  const db = createMulticycleFixture();
  db.tables.classes.push(
    { id: home, label: "CP1 — Français", code: "CP1-FR", level: "CP1", academic_year: "2026-2027", institution_id: db.legacyId },
    { id: arabic, label: "CP1 — Arabe", code: "CP1-AR", level: "CP1", academic_year: "2026-2027", institution_id: db.legacyId },
  );
  const a = { id: first, first_name: "Malick", last_name: "ABDOUL", full_name: "ABDOUL Malick", full_name_ar: "عبد الملك", matricule: "EPC260001", institution_id: db.legacyId };
  const b = { id: second, first_name: "Daouda", last_name: "ARAMA", full_name: "ARAMA Daouda", full_name_ar: "أراما داود", matricule: "EPC260002", institution_id: db.legacyId };
  db.tables.students = [a, b];
  for (const student of [a, b]) db.tables.class_enrollments.push({
    institution_id: db.legacyId, student_id: student.id, class_id: home,
    start_date: "2026-09-01", end_date: null,
    students: student, classes: db.tables.classes[0],
  });
  db.tables.institutions[0].settings_json = {
    school_cycles_v1: { enabled:true, version:1,
      enabledCycles: ["primary"], teachingTracksByCycle: { primary: ["french", "arabic"] },
      classCycleById: { [home]: "primary", [arabic]: "primary" } },
    school_student_programs_v1: { version:1, years: { "2026-2027": {
      classes: {
        [home]: { tracks: ["french"], students: {} },
        [arabic]: { tracks: ["arabic"], students: {}, linkedStudentIds: [first, second] },
      },
    } } },
  };
  return db;
}

test("selected Arabic admin roster shows linked identities without adding duplicate physical enrollments", async () => {
  const db = setup();
  const handler = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const french = await handler.GET(endpoint(`&class_id=${home}`));
  assert.equal(french.status, 200, JSON.stringify(await french.clone().json()));
  assert.equal((await french.json()).items.length, 2);
  const arabicResult = await handler.GET(endpoint(`&class_id=${arabic}`));
  assert.equal(arabicResult.status, 200, JSON.stringify(await arabicResult.clone().json()));
  const data = await arabicResult.json();
  assert.equal(data.items.length, 2);
  assert.ok(data.items.every(s => s.class_id === arabic && s.is_pedagogical_link));
  assert.deepEqual(data.items.map(s => s.full_name_ar).sort(), ["عبد الملك", "أراما داود"].sort());
  assert.deepEqual(data.items.map(s => s.matricule).sort(), ["EPC260001", "EPC260002"]);
  assert.equal(db.tables.class_enrollments.length, 2);
  assert.equal(db.tables.students.length, 2);
  assert.equal(db.calls.filter(x => x.op !== "read").length, 0);
});

test("unfiltered student API remains one row per physically enrolled student and does not query teaching links", async () => {
  const db = setup();
  const handler = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const r = await handler.GET(endpoint());
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const data = await r.json();
  assert.equal(data.items.length, 2);
  assert.ok(data.items.every(s => !s.is_pedagogical_link));
  assert.equal(db.calls.filter(x => x.table === "institutions").length, 0);
});

test("unauthenticated actor cannot retrieve an Arabic class roster", async () => {
  const db = setup();
  const handler = createFixtureRouteLoader(db, null)(route);
  const response = await handler.GET(endpoint(`&class_id=${arabic}`));
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});

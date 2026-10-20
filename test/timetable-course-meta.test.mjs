import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

function setup() {
  const db = createMulticycleFixture();
  const institution_id = db.legacyId;
  db.tables.academic_years.push({ institution_id, code: "2026-2027", is_current: true });
  db.tables.classes.push(
    ...["1a", "2a"].map((id) => ({ id, label: id.toUpperCase(), institution_id, academic_year: "2026-2027", education_type: "general_secondary" })),
    { id: "technical", label: "Technique", institution_id, academic_year: "2026-2027", education_type: "technical_secondary" },
    { id: "old", label: "Ancienne", institution_id, academic_year: "2025-2026", education_type: "general_secondary" },
    { id: "foreign", label: "Autre établissement", institution_id: "stranger", academic_year: "2026-2027", education_type: "general_secondary" },
  );
  db.tables.profiles.push({ id: "teacher", institution_id, display_name: "M. BROU BONI ARMEL" });
  db.tables.institution_subjects.push({ id: "math", institution_id, custom_name: "Mathématiques" });
  db.tables.teacher_timetables = db.tables.classes.map((row) => ({
    institution_id: row.institution_id, class_id: row.id, weekday: 1, period_id: "p1", subject_id: "math", teacher_id: "teacher",
  }));
  db.tables.institution_periods = [{ id: "p1", institution_id, weekday: 1, period_no: 1, start_time: "10:15", end_time: "11:10" }];
  // Le cours existe toujours mais son ancienne affectation n'est plus active.
  db.tables.class_teachers.push({ institution_id, class_id: "1a", subject_id: "math", teacher_id: "teacher", end_date: "2026-10-01" });
  const route = createFixtureRouteLoader(db, db.legacyAdminId)("src/app/api/admin/timetables/meta/route.ts");
  const get = (query) => route.GET(new NextRequest(`https://school.invalid/api/admin/timetables/meta?${query}`));
  return { db, get };
}

test("les cours sont consultables sans choisir de professeur ni de classe, avec leurs vrais libellés", async () => {
  const { db, get } = setup();
  const response = await get("education_type=general_secondary");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.occupancy.map((row) => row.class_id).sort(), ["1a", "2a"]);
  assert.equal(body.occupancy[0].teacher_name, "M. BROU BONI ARMEL");
  assert.equal(body.occupancy[0].subject_label, "Mathématiques");
  assert.ok(body.teachers.some((row) => row.id === "teacher"));
  assert.ok(body.subjects.some((row) => row.id === "math"));
  assert.equal(db.calls.some((row) => row.op !== "read"), false);
});

test("la consultation des créneaux reste bornée à la classe, à l'enseignement, à l'année et à l'établissement", async () => {
  const { get } = setup();
  const body = await (await get("education_type=general_secondary&class_id=1a")).json();
  assert.deepEqual(body.occupancy.map((row) => row.class_id), ["1a"]);
  const foreign = await (await get("education_type=general_secondary&class_id=foreign")).json();
  assert.deepEqual(foreign.occupancy, []);
  assert.deepEqual(foreign.teachers, []);
  const technical = await (await get("education_type=technical_secondary")).json();
  assert.deepEqual(technical.occupancy.map((row) => row.class_id), ["technical"]);
});

test("un grand emploi du temps est chargé intégralement au-delà de la limite d'une page", async () => {
  const { db, get } = setup();
  const row = db.tables.teacher_timetables[0];
  db.tables.teacher_timetables.push(...Array.from({ length: 1004 }, (_, index) => ({ ...row, period_id: `extra-${index}` })));
  const response = await get("education_type=general_secondary&class_id=1a");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.occupancy.length, 1005);
  assert.equal(db.calls.filter((call) => call.table === "teacher_timetables").length, 3);
});

test("les droits administratifs restent exigés avant toute lecture des emplois du temps", async () => {
  const { db } = setup();
  const route = createFixtureRouteLoader(db, "unknown")("src/app/api/admin/timetables/meta/route.ts");
  const response = await route.GET(new NextRequest("https://school.invalid/api/admin/timetables/meta"));
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const route = "src/app/api/admin/school-class-subjects/route.ts";
const url = "https://example.invalid/api/admin/school-class-subjects";
const cFr = "11111111-1111-4111-8111-111111111111";
const cAr = "22222222-2222-4222-8222-222222222222";
const subj = i => `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`;
const request = (method, body, search = "") => new NextRequest(url + search, {
  method, headers: { origin: "https://example.invalid", "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

function setup() {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1 = {
    version: 1, enabled: true, enabledCycles: ["primary"],
    classCycleById: { [cFr]: "primary", [cAr]: "primary" },
    teachingTracksByCycle: { primary: ["french", "arabic"] },
    subjectTracksByCycle: { primary: {
      [subj(1)]: ["french"], [subj(2)]: ["french"], [subj(3)]: ["french"],
      [subj(4)]: ["french"], [subj(5)]: ["arabic"],
    } },
  };
  db.tables.institutions[0].settings_json.school_student_programs_v1 = {
    version: 1, years: { "2026-2027": { classes: {
      [cFr]: { tracks: ["french"], students: {} },
      [cAr]: { tracks: ["arabic"], students: {} },
    } } },
  };
  db.tables.institutions[0].settings_json.franco_arabic_reports_v1 = {
    version: 1, enabled: true, engine: "specialized", format: "separate", scales: [
      { cycle: "primary", track: "arabic", level: "CP1", maxScore: 20 },
    ], coefficients: [],
  };
  db.tables.academic_years.push({ id: "year-1", institution_id: db.legacyId,
    code: "2026-2027", is_current: true, start_date: "2026-09-14" });
  db.tables.classes.push(
    { id: cFr, institution_id: db.legacyId, academic_year: "2026-2027", label: "CP1 Français", level: "CP1" },
    { id: cAr, institution_id: db.legacyId, academic_year: "2026-2027", label: "CP1 Arabe", level: "CP1" },
  );
  for (const [i,name] of [[1,"Lecture"],[2,"Écriture"],[3,"Mathématiques"],[4,"Informatique"],[5,"Hadith"]]) {
    db.tables.institution_subjects.push({ institution_id: db.legacyId, subject_id: subj(i), is_active: true });
    db.tables.subjects.push({ id: subj(i), name });
  }
  db.tables.class_teachers.push({ class_id: cFr, subject_id: subj(1), teacher_id: "teacher-preserved" });
  db.tables.institutions[0].settings_json.school_class_subjects_v1 = { version: 1,
    years: { "2026-2027": { classes: { [cFr]: [subj(4)] } } } };
  return db;
}

test("CI preview is read only and reports absent, recognized and extra school subjects", async () => {
  const db = setup(), api = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const revision = (await (await api.GET(request("GET", null, `?class_id=${cFr}`))).json()).revision;
  const result = await api.POST(request("POST", { action: "preview_ci_primary_french", classId: cFr, revision }));
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.preview.matches.length, 3);
  assert.equal(data.preview.missing.length, 8);
  assert.deepEqual(data.preview.newlyAssociated, [subj(1), subj(2), subj(3)]);
  assert.deepEqual(data.preview.existingExtras, [subj(4)]);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

test("CI apply reuses existing class curricula, preserves teachers and Arabic settings", async () => {
  const db = setup(), api = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const revision = (await (await api.GET(request("GET", null, `?class_id=${cFr}`))).json()).revision;
  const resp = await api.POST(request("POST", { action: "apply_ci_primary_french", classId: cFr, revision }));
  assert.equal(resp.status, 200, JSON.stringify(await resp.clone().json()));
  const saved = db.tables.institutions[0].settings_json;
  assert.deepEqual(saved.school_class_subjects_v1.years["2026-2027"].classes[cFr],
    [subj(4), subj(1), subj(2), subj(3)]);
  assert.deepEqual(saved.school_class_subjects_v1.years["2026-2027"].ciPrimaryFrenchClasses, [cFr]);
  assert.equal(saved.franco_arabic_reports_v1.scales.find(x => x.track === "french").maxScore, 10);
  assert.equal(saved.franco_arabic_reports_v1.scales.find(x => x.track === "arabic").maxScore, 20);
  assert.deepEqual(db.tables.class_teachers, [
    { class_id: cFr, subject_id: subj(1), teacher_id: "teacher-preserved" },
  ]);
  assert.equal(db.calls.some(call => call.op !== "read" && call.table !== "institutions"), false);
  const current = await (await api.GET(request("GET", null, `?class_id=${cFr}`))).json();
  assert.equal(current.ciPrimaryFrenchApplied, true);
  const manual = await api.PUT(request("PUT", {
    revision: current.revision, classId: cFr, subjectIds: [subj(4), subj(1), subj(2), subj(3)],
  }));
  assert.equal(manual.status, 200);
  assert.deepEqual(saved.school_class_subjects_v1.years["2026-2027"].ciPrimaryFrenchClasses, [cFr]);
});

test("CI reference cannot be applied to Arabic or with a stale revision", async () => {
  const db = setup(), api = createFixtureRouteLoader(db, db.legacyAdminId)(route);
  const before = (await (await api.GET(request("GET", null, `?class_id=${cFr}`))).json()).revision;
  const other = await api.POST(request("POST", {
    action: "apply_ci_primary_french", classId: cAr, revision: before,
  }));
  assert.equal(other.status, 400);
  const stale = await api.POST(request("POST", {
    action: "apply_ci_primary_french", classId: cFr, revision: "stale",
  }));
  assert.equal(stale.status, 409);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

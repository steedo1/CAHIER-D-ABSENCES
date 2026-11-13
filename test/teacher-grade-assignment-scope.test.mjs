import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { cls, evaluationPath, math, pupil0, req, setup, teacher, year } from "./helpers/primary-event-fixture.mjs";

test("teacher assignments exclude historical, future, ended and foreign rows and deduplicate active pairs", async () => {
  const db = setup("CP1", false);
  db.tables.institutions[0].settings_json = {};
  const classroom = db.tables.classes[0];
  classroom.level = "3e";
  const oldClass = { ...classroom, id: "historical", academic_year: "2025-2026" };
  db.tables.classes.push(oldClass);
  const otherSubject = "99999999-9999-4999-8999-999999999999";
  db.tables.subjects.push({ id: otherSubject, name: "EDHC" });
  db.tables.institution_subjects.push({ id: "edhc", institution_id: db.legacyId,
    subject_id: otherSubject, is_active: true, custom_name: "Éducation civique" });
  const assignment = db.tables.class_teachers[0];
  db.tables.class_teachers.push(
    { ...assignment, id: "duplicate" },
    { ...assignment, id: "active-second-discipline", subject_id: "edhc" },
    { ...assignment, id: "historical", class_id: oldClass.id },
    { ...assignment, id: "other-teacher", teacher_id: db.legacyAdminId },
    { ...assignment, id: "foreign", institution_id: "another-school" },
  );
  const classes = db.teacher("src/app/api/grades/classes/route.ts");
  const response = await classes.GET(req("/api/grades/classes"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const { items } = await response.json();
  assert.deepEqual(items.map(item => [item.class_id, item.subject_id, item.academic_year]),
    [[cls, otherSubject, year], [cls, math, year]]);
  assert.equal(items[0].subject_name, "Éducation civique");
  assert.equal(db.calls.filter(call => call.table === "class_teachers").length, 1);
  assert.equal(db.calls.filter(call => call.table === "academic_years").length, 1);

  db.tables.class_teachers = [
    { ...assignment, start_date: "9999-01-01" },
    { ...assignment, end_date: "2026-08-02" },
  ];
  assert.deepEqual((await (await classes.GET(req("/api/grades/classes"))).json()).items, []);
});

test("secondary teacher can list pupils, save and publish only their own assigned evaluations", async () => {
  const db = setup("CP1", false);
  db.tables.institutions[0].settings_json = {};
  db.tables.institution_grade_publication_settings[0].require_admin_validation = false;
  db.tables.classes[0].level = "3e";
  const oldClass = { ...db.tables.classes[0], id: "historical", academic_year: "2025-2026" };
  db.tables.classes.push(oldClass);
  db.tables.class_teachers.push({ ...db.tables.class_teachers[0], class_id: oldClass.id });
  const unassigned = "99999999-9999-4999-8999-999999999999";
  db.tables.subjects.push({ id: unassigned, name: "EDHC" });
  db.tables.institution_subjects.push({ id: "edhc", institution_id: db.legacyId, subject_id: unassigned, is_active: true });
  const route = db.teacher(evaluationPath);
  const endpoint = "/api/teacher/grades/evaluations";
  const create = (class_id, subject_id) => route.POST(req(endpoint, {
    class_id, subject_id, eval_date: "2026-10-01", eval_kind: "devoir", scale: 20, coeff: 1,
  }));
  const roster = await db.teacher("src/app/api/teacher/roster/route.ts").GET(req(`/api/teacher/roster?class_id=${cls}`));
  assert.equal(roster.status, 200);
  assert.equal((await roster.json()).items.length, 2);
  assert.equal((await create(cls, unassigned)).status, 403);
  assert.equal((await create(oldClass.id, math)).status, 403);
  const response = await create(cls, math);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const evaluation = (await response.json()).item;
  const get = (classId, subjectId) => route.GET(req(`${endpoint}?class_id=${classId}&subject_id=${subjectId}`));
  assert.equal((await get(cls, unassigned)).status, 403);
  assert.equal((await get(oldClass.id, math)).status, 403);
  assert.equal((await (await get(cls, math)).json()).items.length, 1);

  const otherEvaluation = { ...evaluation, id: "other-teacher", teacher_id: db.legacyAdminId };
  db.tables.grade_evaluations.push(otherEvaluation);
  const save = (id, prefix = "/api/teacher/grades") => db.teacher(`src/app${prefix}/scores/bulk/route.ts`).POST(
    req(`${prefix}/scores/bulk`, { evaluation_id: id, items: [{ student_id: pupil0, score: 14 }] }));
  const publish = id => route.PATCH(req(endpoint, { evaluation_id: id, is_published: true }, "PATCH"));
  assert.equal((await save(otherEvaluation.id)).status, 403);
  assert.equal((await save(otherEvaluation.id, "/api/grades")).status, 403);
  assert.equal((await publish(otherEvaluation.id)).status, 403);
  const saved = await save(evaluation.id);
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const published = await publish(evaluation.id);
  assert.equal(published.status, 200, JSON.stringify(await published.clone().json()));
  assert.equal((await published.json()).item.is_published, true);

  db.tables.class_teachers[0].end_date = "2026-08-02";
  assert.equal((await save(evaluation.id)).status, 403);
  assert.equal((await publish(evaluation.id)).status, 403);
  for (const prefix of ["/api/teacher/grades", "/api/grades"]) {
    const scores = db.teacher(`src/app${prefix}/scores/route.ts`);
    assert.equal((await scores.GET(req(`${prefix}/scores?evaluation_id=${evaluation.id}`))).status, 403);
  }
  assert.equal(db.tables.student_grades.length, 1);
  assert.equal(db.tables.class_enrollments.length, 2);
});

test("current teacher options match a read-only CSCA snapshot when supplied", {
  skip: !process.env.CSCA_ASSIGNMENT_SNAPSHOT,
}, async () => {
  const snapshot = JSON.parse(readFileSync(process.env.CSCA_ASSIGNMENT_SNAPSHOT, "utf8"));
  const db = setup("CP1", false);
  const institution_id = snapshot.classes[0].institution_id;
  Object.assign(db.tables, snapshot, {
    institutions: [{ id: institution_id, settings_json: {} }],
    academic_years: [{ institution_id, code: year, is_current: true }],
  });
  const teacherIds = new Set(snapshot.class_teachers.map(row => row.teacher_id));
  for (const teacherId of teacherIds) {
    db.users.set(teacherId, { user: db.user(teacherId, "audit@example.invalid") });
    db.tables.profiles.push({ id: teacherId, institution_id });
    db.tables.user_roles.push({ profile_id: teacherId, institution_id, role: "teacher" });
    const classes = createFixtureRouteLoader(db, teacherId)("src/app/api/grades/classes/route.ts");
    const response = await classes.GET(req("/api/grades/classes"));
    assert.equal(response.status, 200);
    const { items } = await response.json();
    const expected = snapshot.class_teachers.filter(row => row.teacher_id === teacherId &&
      snapshot.classes.some(item => item.id === row.class_id && item.academic_year === year))
      .map(row => `${row.class_id}|${snapshot.institution_subjects.find(item => item.id === row.subject_id).subject_id}`);
    assert.deepEqual(items.map(item => `${item.class_id}|${item.subject_id}`).sort(), expected.sort());
    assert.ok(items.every(item => item.academic_year === year));
  }
  assert.equal(teacherIds.size, 4);
});

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server.js";
import { createPedagogicalFixture } from "./helpers/pedagogical-fixture.mjs";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { CI_PRIMARY_FRENCH_REFERENCE, ciPrimaryFrenchDenominator } from "../src/lib/primary-french-reference-ci.ts";

const cFr = "33333333-3333-4333-8333-333333333333", cAr = "33333333-3333-4333-8333-444444444444";
const teacherFr = "55555555-5555-4555-8555-555555555555", teacherAr = "66666666-6666-4666-8666-666666666666";
const subjectId = i => `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`;
const institutionSubjectId = i => `88888888-8888-4888-8888-${String(i).padStart(12, "0")}`;
const period = "44444444-4444-4444-8444-444444444444";
const req = (path, body) => new NextRequest("https://example.invalid" + path, body ? {
  method: "POST", headers: { origin: "https://example.invalid", "content-type": "application/json" }, body: JSON.stringify(body),
} : {});
function setup(level) {
  const db = createPedagogicalFixture({ count: 1 });
  const settings = db.tables.institutions[0].settings_json;
  settings.franco_arabic_reports_v1.scales = ["french", "arabic"].map(track => ({ cycle: "primary", level, track, maxScore: 10 }));
  settings.franco_arabic_reports_v1.primarySubjectScales = [
    { cycle: "primary", level, track: "arabic", subjectId: subjectId(7), maxScore: 50 },
    { cycle: "primary", level, track: "arabic", subjectId: subjectId(12), maxScore: 20 },
  ];
  settings.school_cycles_v1.classCycleById = { [cFr]: "primary", [cAr]: "primary" };
  settings.school_cycles_v1.subjectTracksByCycle.primary = Object.fromEntries(CI_PRIMARY_FRENCH_REFERENCE.map((_, i) => [subjectId(i + 1), ["french"]]));
  settings.school_cycles_v1.subjectTracksByCycle.primary[subjectId(7)] = ["french", "arabic"];
  settings.school_cycles_v1.subjectTracksByCycle.primary[subjectId(12)] = ["arabic"];
  settings.school_student_programs_v1 = { version: 1, years: { "2026-2027": { classes: {
    [cFr]: { tracks: ["french"], students: {} }, [cAr]: { tracks: ["arabic"], students: {} },
  } } } };
  settings.school_class_subjects_v1 = { version: 1, years: { "2026-2027": {
    classes: { [cFr]: CI_PRIMARY_FRENCH_REFERENCE.map((_, i) => subjectId(i + 1)), [cAr]: [subjectId(7), subjectId(12)] },
    ciPrimaryFrenchClasses: [cFr],
  } } };
  Object.assign(db.tables.institutions[0], { logo_url: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E",
    phone: "0700000000", email: "ecole@example.invalid", regional_direction: "DRENA Dimbokro", country_name: "République de Côte d’Ivoire",
    country_motto: "Union – Discipline – Travail", ministry_name: "MINISTÈRE DE L’ÉDUCATION NATIONALE ET DE L’ALPHABÉTISATION" });
  db.tables.classes = [
    { ...db.tables.classes[0], level, label: level + " Français", head_teacher_id: teacherFr },
    { ...db.tables.classes[0], id: cAr, level, label: level + " Arabe", head_teacher_id: teacherAr },
  ];
  db.tables.subjects = [...CI_PRIMARY_FRENCH_REFERENCE.map((row, i) => ({ id: subjectId(i + 1), name: row.label })), { id: subjectId(12), name: "Coran" }];
  db.tables.institution_subjects = db.tables.subjects.map((subject, i) => ({ id: institutionSubjectId(i + 1), subject_id: subject.id,
    institution_id: db.legacyId, is_active: true, custom_name: null, subjects: subject }));
  db.tables.institution_subjects.unshift({ id: "foreign", subject_id: subjectId(7), institution_id: "foreign-school", is_active: true, custom_name: "Matière étrangère" });
  db.tables.class_teachers = db.tables.classes.flatMap(cls => settings.school_class_subjects_v1.years["2026-2027"].classes[cls.id]
    .map(id => ({ class_id: cls.id, subject_id: db.tables.institution_subjects.find(s => s.institution_id === db.legacyId && s.subject_id === id).id,
      teacher_id: cls.head_teacher_id, institution_id: db.legacyId, end_date: null, classes: cls })));
  for (const id of [teacherFr, teacherAr]) {
    db.users.set(id, { user: db.user(id, `${id}@example.invalid`) });
    db.tables.profiles.push({ id, institution_id: db.legacyId, display_name: id === teacherFr ? "Instituteur français" : "Maître arabe" });
    db.tables.user_roles.push({ profile_id: id, institution_id: db.legacyId, role: "teacher" });
  }
  db.tables.academic_years = [{ institution_id: db.legacyId, code: "2026-2027", is_current: true }];
  db.tables.grade_evaluations = []; db.tables.grade_published_scores = [];
  db.tables.institution_subject_coeffs = []; db.tables.institution_level_subjects = [];
  Object.assign(db.tables.class_enrollments[0].students, { birth_place: "Dimbokro", photo_path: "private/test.jpg", photo_updated_at: "2026-10-01T00:00:00Z" });
  db.tables.class_enrollments.push({ ...db.tables.class_enrollments[0], id: "arabic-enrollment", class_id: cAr });
  return db;
}
async function postEvaluation(db, actor, classId, instSubjectId, scale) {
  const response = await createFixtureRouteLoader(db, actor)("src/app/api/teacher/grades/evaluations/route.ts").POST(req("/api/teacher/grades/evaluations", {
    class_id: classId, subject_id: instSubjectId, eval_kind: "composition", eval_date: "2026-10-01", grading_period_id: period, scale, coeff: 1,
  }));
  return { status: response.status, ...(await response.json()) };
}
for (const level of ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]) test(`${level}: actual teacher selector and write API use subject barèmes and isolate shared mathematics`, async () => {
  const db = setup(level);
  const loader = createFixtureRouteLoader(db, teacherFr);
  const options = await (await loader("src/app/api/grades/classes/route.ts").GET(req("/api/grades/classes"))).json();
  assert.equal(options.items.length, 11);
  for (const [i, row] of CI_PRIMARY_FRENCH_REFERENCE.entries()) {
    const option = options.items.find(item => item.subject_id === institutionSubjectId(i + 1));
    const denominator = ciPrimaryFrenchDenominator(level, row.code);
    assert.equal(option?.subject_name, row.label);
    assert.equal(option?.teaching_track, "french");
    assert.equal(option?.configured_scale, denominator);
    const created = await postEvaluation(db, teacherFr, cFr, institutionSubjectId(i + 1), denominator);
    assert.equal(created.status, 200, JSON.stringify(created));
    assert.equal(created.item.subject_id, subjectId(i + 1), "persist the canonical ID");
    assert.equal(created.item.scale, denominator);
  }
  const arOptions = await (await createFixtureRouteLoader(db, teacherAr)("src/app/api/grades/classes/route.ts").GET(req("/api/grades/classes"))).json();
  assert.deepEqual(arOptions.items.map(item => item.configured_scale).sort((a,b) => a-b), [20,50]);
  const created = await postEvaluation(db, teacherAr, cAr, institutionSubjectId(7), 50);
  assert.equal(created.status, 200, JSON.stringify(created));
  assert.equal((await postEvaluation(db, teacherAr, cAr, institutionSubjectId(7), 10)).status, 400);
  assert.equal((await postEvaluation(db, teacherFr, cAr, institutionSubjectId(7), 50)).status, 403);
  assert.equal((await postEvaluation(db, teacherAr, cAr, institutionSubjectId(1), 10)).status, 409);
});

test("Arabic subject barèmes feed the real bulletin, ignore blanks, preserve zero and fetch logo/identity/teacher", async () => {
  const db = setup("CM1");
  for (const [index, scale, score] of [[7,50,25], [12,20,0]]) {
    const created = await postEvaluation(db, teacherAr, cAr, institutionSubjectId(index), scale);
    assert.equal(created.status, 200, JSON.stringify(created));
    const evaluation = db.tables.grade_evaluations.find(row => row.id === created.item.id);
    const teacher = createFixtureRouteLoader(db, teacherAr);
    const saved = await teacher("src/app/api/teacher/grades/scores/bulk/route.ts").POST(req("/api/teacher/grades/scores/bulk", {
      evaluation_id: evaluation.id, items: [{ student_id: "student-0", score }],
    }));
    assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
    const published = await teacher("src/lib/grades/publication.ts").publishEvaluationOfficially({
      evaluationId: evaluation.id, actorProfileId: teacherAr, queuePush: false,
    });
    assert.equal(published.ok, true, JSON.stringify(published));
    assert.equal(published.official_rows, 1);
  }
  const load = createFixtureRouteLoader(db, db.legacyAdminId);
  const response = await load("src/app/api/admin/grades/bulletin/route.ts").GET(req(`/api/admin/grades/bulletin?class_id=${cAr}&from=2026-09-01&to=2026-12-15&academic_year=2026-2027`));
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  const report = body.specialized.documents[0];
  assert.equal(report.programReadiness.arabic, true, JSON.stringify(report.problems));
  assert.equal(report.document.french, undefined);
  assert.equal(report.document.arabic.generalAverage, 3.57, "25/70 * 10, keeping a real 0/20");
  assert.deepEqual(report.document.arabic.subjects.map(row => [row.average,row.denominator]).sort(), [[0,20],[25,50]].sort());
  assert.equal(report.document.arabic.teacherName, "Maître arabe");
  assert.equal(report.document.student.birthPlace, "Dimbokro");
  assert.match(report.document.student.photoUrl, /^\/api\/media\/student-photo\/student-0/);
  assert.equal(body.specialized.school.logoUrl, db.tables.institutions[0].logo_url);
  assert.equal(body.specialized.school.phone, "0700000000");
  assert.equal(report.document.school.logoUrl, undefined, "the large logo is not repeated per pupil");
  const Component = load("src/components/bulletins/SpecializedBulletinPanel.tsx").default;
  const html = renderToStaticMarkup(React.createElement(Component, { data: body.specialized, onBack() {}, onPrint: async () => {} }));
  assert.match(html, /Logo de l’établissement/); assert.match(html, /DRENA Dimbokro/);
  assert.match(html, /0700000000/); assert.match(html, /Maître arabe/); assert.match(html, /0,00\/20/);
  assert.match(html, /25,00\/70/); assert.doesNotMatch(html, /Coef\./);
});

test("once Arabic subject barèmes are configured, an absent scale cannot fall back to /10", async () => {
  const db = setup("CP1");
  db.tables.institutions[0].settings_json.franco_arabic_reports_v1.primarySubjectScales.pop();
  const result = await postEvaluation(db, teacherAr, cAr, institutionSubjectId(12), 10);
  assert.equal(result.status, 409); assert.equal(result.error, "primary_scale_not_configured");
  assert.equal(db.tables.grade_evaluations.length, 0);
});


test("linked Arabic pupil appears in the teacher and paper rosters and can be graded without duplicate enrollment", async () => {
  const db = setup("CP1");
  const settings = db.tables.institutions[0].settings_json;
  const linkedId = "99999999-9999-4999-8999-999999999999";
  for (const row of db.tables.class_enrollments) { row.student_id = linkedId; row.students.id = linkedId; }
  settings.school_student_programs_v1.years["2026-2027"].classes[cAr].linkedStudentIds = [linkedId];
  db.tables.class_enrollments = db.tables.class_enrollments.filter(row => row.class_id === cFr);
  db.tables.students = [structuredClone(db.tables.class_enrollments[0].students)];
  const before = structuredClone(db.tables.class_enrollments);
  const teacher = createFixtureRouteLoader(db, teacherAr);
  const response = await teacher("src/app/api/teacher/roster/route.ts").GET(req(`/api/teacher/roster?class_id=${cAr}`));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).items[0].id, linkedId);
  const roster = await teacher("src/lib/server/primary-class-roster.ts").loadPrimaryClassRoster(db.service, db.legacyId, db.tables.classes[1], settings);
  assert.equal(roster.subjects.length, 2); assert.equal(roster.linkedEnrollments[0].student_id, linkedId);
  const created = await postEvaluation(db, teacherAr, cAr, institutionSubjectId(12), 20);
  const otherTeacher = createFixtureRouteLoader(db, teacherFr)("src/app/api/teacher/grades/scores/bulk/route.ts");
  const forbiddenEdit = await otherTeacher.POST(req("/api/teacher/grades/scores/bulk", {
    evaluation_id: created.item.id, items: [{ student_id: linkedId, score: 20 }],
  }));
  assert.equal(forbiddenEdit.status, 403, "another teacher cannot edit this evaluation");
  const scores = teacher("src/app/api/teacher/grades/scores/bulk/route.ts");
  const saved = await scores.POST(req("/api/teacher/grades/scores/bulk", {
    evaluation_id: created.item.id, items: [{ student_id: linkedId, score: 18 }],
  }));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const denied = await scores.POST(req("/api/teacher/grades/scores/bulk", {
    evaluation_id: created.item.id, items: [{ student_id: "foreign-student", score: 10 }],
  }));
  assert.equal(denied.status, 403); assert.equal(db.tables.student_grades.length, 1);
  assert.deepEqual(db.tables.class_enrollments, before);
  db.tables.classes[0].level = "CM2";
  const stale = await teacher("src/app/api/teacher/roster/route.ts").GET(req(`/api/teacher/roster?class_id=${cAr}`));
  assert.equal(stale.status, 409, "stale level cannot authorize a linked pupil");
});

test("classic schools retain their existing RLS-authorized grade-write rights", async () => {
  const db = setup("CP1");
  db.tables.institutions[0].settings_json = { legacy_school: true };
  db.tables.profiles.find(row => row.id === teacherFr).institution_id = null;
  const helper = createFixtureRouteLoader(db, teacherFr)("src/lib/server/school-linked-class-roster.ts");
  assert.equal(await helper.specializedGradeStudentsAllowed(db.service, teacherFr, cFr, ["student-0"], teacherAr), true);
  db.tables.institutions[0].settings_json = setup("CP1").tables.institutions[0].settings_json;
  assert.equal(await helper.specializedGradeStudentsAllowed(db.service, teacherFr, cFr, ["student-0"], teacherAr), false);
});

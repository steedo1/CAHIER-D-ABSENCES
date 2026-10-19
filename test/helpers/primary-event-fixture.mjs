import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { createPedagogicalFixture } from "./pedagogical-fixture.mjs";
import { createFixtureRouteLoader } from "./multicycle-fixture.mjs";
const year = "2026-2027", cls = "33333333-3333-4333-8333-333333333333";
const pupil0 = "99999999-9999-4999-8999-000000000000", pupil1 = "99999999-9999-4999-8999-111111111111";
const teacher = "55555555-5555-4555-8555-555555555555";
const math = "11111111-1111-4111-8111-111111111111";
const calendarPath = "src/app/api/admin/institution/primary-evaluation-events/route.ts";
const evaluationPath = "src/app/api/teacher/grades/evaluations/route.ts";
const bulletinPath = "src/app/api/admin/grades/bulletin/route.ts";
const req = (path, body, method = "POST") => new NextRequest("https://fixture.invalid" + path, body === undefined ? {} : {
  method, headers: { "content-type": "application/json", origin: "https://fixture.invalid" }, body: JSON.stringify(body),
});
function setup(level = "CP1", bilingual = true) {
  const db = createPedagogicalFixture({ bilingual });
  db.simulatePrimaryLegacyNotificationTrigger = true;
  db.tables.class_enrollments.forEach((row, i) => { row.student_id = i ? pupil1 : pupil0; row.students.id = row.student_id; });
  const settings = db.tables.institutions[0].settings_json;
  const tracks = bilingual ? ["french", "arabic"] : ["french"];
  settings.school_cycles_v1.subjectTracksByCycle.primary[math] = tracks;
  settings.franco_arabic_reports_v1.scales = tracks.map(track => ({ cycle: "primary", level, track, maxScore: 10 }));
  settings.franco_arabic_reports_v1.primarySubjectScales = bilingual ? [{ cycle: "primary", level, track: "arabic", subjectId: math, maxScore: 20 }] : undefined;
  settings.school_class_subjects_v1 = { version: 1, years: { [year]: { classes: { [cls]: db.tables.subjects.map(s => s.id) }, ciPrimaryFrenchClasses: [cls] } } };
  settings.school_student_programs_v1 = { version: 1, years: { [year]: { classes: {
    [cls]: { tracks, students: { [pupil1]: ["french"] } },
  } } } };
  db.tables.classes[0].level = level;
  db.tables.classes[0].head_teacher_id = teacher;
  db.tables.institution_level_subjects.forEach(s => { s.level_code = level; });
  db.tables.institution_subject_coeffs.forEach(s => { s.level = level; });
  const event = (code, kind, date, label = code) => ({ code, kind, date, label, levels: [level], tracks, printBulletin: true });
  db.events = [event("DEC", "official", "2026-12-10", "Composition de décembre"), event("FEV", "official", "2027-02-04"),
    event("AVR", "official", "2027-04-06"), event("NIV1", "internal", "2026-12-03", "Évaluation de niveau"),
    event("NIV2", "internal", "2027-01-28", "Évaluation de niveau")];
  db.events.push(level === "CM2" ? event("BLANC", "mock", "2027-05-20", "Examen blanc") : event("PASS", "passage", "2027-06-03", "Composition de passage"));
  settings.primary_evaluation_events_v1 = { version: 1, years: { [year]: { events: db.events } } };
  db.users.set(teacher, { user: db.user(teacher, "teacher@example.invalid") });
  db.tables.profiles.push({ id: teacher, institution_id: db.legacyId, display_name: "Instituteur titulaire" });
  db.tables.user_roles.push({ profile_id: teacher, institution_id: db.legacyId, role: "teacher" });
  db.tables.class_teachers = [{ id: "assignment", teacher_id: teacher, institution_id: db.legacyId, class_id: cls, subject_id: math, end_date: null, classes: db.tables.classes[0] }];
  db.tables.academic_years = [{ institution_id: db.legacyId, code: year, is_current: true }];
  db.tables.institution_grade_publication_settings = [{ institution_id: db.legacyId, require_admin_validation: true, auto_push_on_publish: false }];
  db.tables.grade_periods = []; db.tables.grade_evaluations = []; db.tables.grade_published_scores = [];
  db.teacher = createFixtureRouteLoader(db, teacher);
  db.admin = createFixtureRouteLoader(db, db.legacyAdminId);
  db.scale = track => track === "arabic" ? 20 : level.startsWith("CM") ? 50 : 10;
  return db;
}
async function create(db, code, track = "french", overrides = {}) {
  const event = db.events.find(e => e.code === code);
  const response = await db.teacher(evaluationPath).POST(req("/api/teacher/grades/evaluations", {
    class_id: cls, subject_id: math, eval_kind: "devoir", scale: db.scale(track), coeff: 1,
    primary_event_code: code, teaching_track: track, eval_date: "2026-10-01", ...overrides,
  }));
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.item.eval_date, event?.date || overrides.eval_date || "2026-10-01");
  assert.equal(data.item.grading_period_id, null);
  return data.item;
}
async function publish(db, code, track, ratio) {
  const ev = await create(db, code, track);
  const items = (track === "arabic" ? [pupil0] : [pupil0, pupil1]).map((student_id, i) => ({ student_id, score: Math.max(0, db.scale(track) * (ratio - i / 10)) }));
  const saved = await db.teacher("src/app/api/teacher/grades/scores/bulk/route.ts").POST(req("/api/teacher/grades/scores/bulk", { evaluation_id: ev.id, items }));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const result = await db.teacher("src/lib/grades/publication.ts").publishEvaluationOfficially({ evaluationId: ev.id, actorProfileId: teacher, queuePush: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.official_rows, items.length);
  return ev;
}
async function report(db, code) {
  const response = await db.admin(bulletinPath).GET(req(`/api/admin/grades/bulletin?${new URLSearchParams({ class_id: cls, academic_year: year, primary_event_code: code })}`));
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
}

export { setup, create, publish, report, req, calendarPath, year, cls, math, teacher, pupil0, pupil1, evaluationPath };

import { createPedagogicalFixture as setup } from "./helpers/pedagogical-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { NextRequest } from "next/server.js";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const routePath = "src/app/api/admin/grades/bulletin/route.ts";
const french = "11111111-1111-4111-8111-111111111111";
const arabic = "22222222-2222-4222-8222-222222222222";
const classId = "33333333-3333-4333-8333-333333333333";
const url = () => new NextRequest(`https://example.invalid/api/admin/grades/bulletin?class_id=${classId}&from=2026-09-01&to=2026-12-15&academic_year=2026-2027`);



test("the existing bulletin endpoint produces a configured ordinary primary bulletin from published marks", async () => {
  const db = setup({ bilingual: false });
  const before = structuredClone(db.tables);
  const response = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const data = await response.json();
  assert.equal(data.specialized.documents[0].document.french.generalAverage, 8);
  assert.equal(data.specialized.documents[0].document.arabic, undefined);
  assert.equal(data.specialized.documents[0].ready, true);
  assert.deepEqual(db.tables, { ...db.tables, ...before });
  assert.equal(db.calls.some(call => call.op !== "read"), false);
  assert.equal(db.calls.some(call => call.table === "student_grades"), false);
});
test("one identity has independent means and ranks without cloning students or scores", async () => {
  const db = setup();
  // Arabic order differs from French order: each program must rank independently.
  db.tables.grade_published_scores.find(row => row.student_id === "student-1" && row.subject_id === arabic).score = 18;
  const response = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
  const student = data.specialized.documents[0];
  assert.equal(student.document.student.id, student.studentId);
  assert.equal(student.document.french.generalAverage, 8);
  assert.equal(student.document.arabic.generalAverage, 12);
  assert.equal(student.document.french.rank, 1); assert.equal(student.document.arabic.rank, 2);
  assert.equal("generalAverage" in student.document, false);
  assert.equal(data.specialized.documents.length, 2);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});
test("the saved model for one cycle drives real printable variants, never grades", async () => {
  const db = setup();
  const reports = db.tables.institutions[0].settings_json.franco_arabic_reports_v1;
  reports.formatsByCycle = { primary: "combined", secondary: "separate" };
  const response = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.specialized.format, "combined");
  assert.equal(body.specialized.documents[0].document.french.generalAverage, 8);
  assert.equal(body.specialized.documents[0].document.arabic.generalAverage, 16);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

test("shared subjects are blocked rather than counted in both program results", async () => {
  const db = setup();
  db.tables.institutions[0].settings_json.school_cycles_v1.subjectTracksByCycle.primary[french] = ["french", "arabic"];
  const data = await (await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url())).json();
  const student = data.specialized.documents[0];
  assert.equal(student.ready, false);
  assert.equal(student.document.french.generalAverage, null);
  assert.equal(student.document.arabic.generalAverage, null);
  assert.ok(student.problems.includes("shared_subject_requires_program_specific_evaluations"));
});

test("real secondary curriculum, scales and coefficients match level aliases without adding unrelated subjects", async () => {
  const db = setup(), settings = db.tables.institutions[0].settings_json;
  settings.school_cycles_v1.enabledCycles = ["secondary"];
  settings.school_cycles_v1.teachingTracksByCycle = { secondary: ["french", "arabic"] };
  settings.school_cycles_v1.subjectTracksByCycle = { secondary: settings.school_cycles_v1.subjectTracksByCycle.primary };
  settings.franco_arabic_reports_v1.scales.forEach(row => { row.cycle = "secondary"; row.level = "6ème"; });
  db.tables.classes[0].level = "6e";
  db.tables.institution_level_subjects.forEach(row => { row.level_code = "6EME"; });
  db.tables.institution_subject_coeffs.forEach(row => { row.level = "6eme"; });
  const unrelated = "55555555-5555-4555-8555-555555555555";
  db.tables.institution_subjects.push({ id: "unrelated", institution_id: db.legacyId, subject_id: unrelated, is_active: true, subjects: { name: "Autre programme" } });
  db.tables.institution_subject_coeffs.push({ institution_id: db.legacyId, level: null, subject_id: unrelated, coeff: 99, include_in_average: true });
  settings.school_cycles_v1.subjectTracksByCycle.secondary[unrelated] = ["french"];
  const response = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
  const row = data.specialized.documents[0];
  assert.equal(row.ready, true); assert.equal(row.document.french.generalAverage, 8);
  assert.deepEqual(row.document.french.subjects.map(subject => subject.id), [french]);
  assert.deepEqual(row.programReadiness, { french: true, arabic: true });
  db.tables.institution_level_subjects.forEach(item => { item.level_code = "5eme"; });
  const missing = await (await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url())).json();
  assert.equal(missing.specialized.documents[0].ready, false);
  assert.equal(missing.specialized.documents[0].document.french.generalAverage, null);
  assert.deepEqual(missing.specialized.documents[0].document.french.subjects, []);
});

test("program rankings preserve independent ties and exclude incomplete results", async () => {
  const db = setup({ count: 5 });
  db.tables.grade_published_scores.forEach(row => {
    const index = Number(row.student_id.split("-")[1]);
    row.score = row.subject_id === french ? [9, 8, 8, 6, null][index] : [12, 18, 12, 6, 0][index];
  });
  const data = await (await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url())).json();
  const rows = data.specialized.documents.sort((a, b) => a.studentId.localeCompare(b.studentId));
  assert.deepEqual(rows.map(row => row.document.french.rank), [1, 2, 2, 4, null]);
  assert.deepEqual(rows.map(row => row.document.arabic.rank), [2, 1, 2, 4, 5]);
  assert.deepEqual(rows[4].programReadiness, { french: false, arabic: true });
});

test("invalid explicitly specialized settings cannot silently fall back to an official historical bulletin", async () => {
  const db = setup(), reports = db.tables.institutions[0].settings_json.franco_arabic_reports_v1;
  reports.scales.push({ ...reports.scales[0], level: "cp1", maxScore: 20 });
  const response = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "SPECIALIZED_CONFIGURATION_INVALID");
  assert.equal(db.calls.some(call => call.table === "grade_published_scores"), false);
});
test("drafts, old publication versions and foreign periods never feed specialized results", async () => {
  for (const change of [db => { db.tables.grade_evaluations[0].is_published = false; },
    db => { db.tables.grade_published_scores[0].publication_version = 1; },
    db => { db.tables.grade_evaluations[0].grading_period_id = "foreign-period"; }]) {
    const db = setup(); change(db);
    const data = await (await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url())).json();
    assert.equal(data.specialized.documents[0].document.french.generalAverage, null);
  }
});
test("untrusted engine/track/institution parameters cannot grant access or force the historical engine", async () => {
  const db = setup();
  const foreign = { id: "foreign-admin", institution_id: "foreign-school" };
  db.users.set(foreign.id, { user: db.user(foreign.id, "foreign@example.invalid") });
  db.tables.profiles.push(foreign);
  db.tables.user_roles.push({ profile_id: foreign.id, institution_id: foreign.institution_id, role: "admin" });
  const denied = await createFixtureRouteLoader(db, foreign.id)(routePath).GET(url()); assert.equal(denied.status, 403);
  const request = new NextRequest(url().url + "&engine=legacy&teaching_track=foreign&institution_id=foreign-school");
  const own = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(request);
  assert.equal((await own.json()).specialized.engine, "specialized");
  const unauthenticated = await createFixtureRouteLoader(db, null)(routePath).GET(url()); assert.equal(unauthenticated.status, 401);
});
test("Supabase read count grows by pages, not by student or program", async () => {
  const counts = [];
  for (const count of [2, 120]) {
    const db = setup({ count });
    const response = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    counts.push(db.calls.length);
  }
  assert.equal(counts[0], counts[1]); assert.ok(counts[0] <= 12, `Unexpected read count: ${counts}`);
});
test("historical bulletin averages, subject calculations and ranks match the starting commit", async () => {
  const original = execFileSync("git", ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, "show", `6d6799fe7c0e39de011b417b99179f4b00bc1fe4:${routePath}`], { encoding: "utf8" });
  for (const name of ["CSCA", "Dieudonné", "Notre Dame"]) {
    const baselineDb = setup({ specialized: false, name });
    const currentDb = setup({ specialized: false, name });
    const before = await createFixtureRouteLoader(baselineDb, baselineDb.legacyAdminId, new Map([[routePath, original]]))(routePath).GET(url());
    const after = await createFixtureRouteLoader(currentDb, currentDb.legacyAdminId)(routePath).GET(url());
    assert.equal(before.status, 200, `${name} baseline: ${JSON.stringify(await before.clone().json())}`);
    assert.equal(after.status, 200, `${name} current: ${JSON.stringify(await after.clone().json())}`);
    const baseline = await before.json(), current = await after.json();
    assert.ok(baseline.items.length > 0);
    assert.ok(baseline.items.some(row => typeof row.general_avg === "number"), JSON.stringify(baseline.items));
    const results = data => data.items.map(row => ({ student_id: row.student_id, general_avg: row.general_avg,
      per_subject: row.per_subject, rank: row.rank, annual_avg: row.annual_avg, annual_rank: row.annual_rank }));
    assert.deepEqual(results(current), results(baseline), `${name}: historical results changed`);
    assert.equal(current.specialized, undefined);
    assert.equal(currentDb.calls.length, baselineDb.calls.length, "Historical selection adds no Supabase queries");
  }
});

test("a student follows both French and Arabic classes with one identity in the specialized engine", async () => {
  const db = setup();
  const frenchClass = "77777777-7777-4777-8777-777777777777";
  const virtualStudent = "88888888-8888-4888-8888-888888888888";
  db.tables.classes.push({
    id: frenchClass, institution_id: db.legacyId, academic_year: "2026-2027",
    level: "CP1", label: "CP1 Français", education_type: "general_secondary",
  });
  db.tables.class_enrollments.push({
    id: "single-home-enrollment", institution_id: db.legacyId,
    class_id: frenchClass, student_id: virtualStudent, end_date: null,
    students: { id: virtualStudent, institution_id: db.legacyId, full_name: "Élève lié" },
  });
  db.tables.students = [{
    id: virtualStudent, institution_id: db.legacyId,
    full_name: "Élève lié", first_name: "Élève", last_name: "Lié",
    matricule: "EPC-TEST", birthdate: null,
  }];
  db.tables.institutions[0].settings_json.school_student_programs_v1 = {
    version: 1, years: { "2026-2027": { classes: {
      [frenchClass]: { tracks: ["french"], students: {} },
      [classId]: { tracks: ["arabic"], students: {}, linkedStudentIds: [virtualStudent] },
    } } },
  };
  const response = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const document = (await response.json()).specialized;
  assert.deepEqual(document.programs, ["arabic"]);
  const linked = document.documents.find(row => row.studentId === virtualStudent);
  assert.ok(linked, "linked pupil must be present in the Arabic bulletin");
  assert.equal(linked.document.arabic.classSize, 3);
  assert.equal(linked.document.french, undefined);
  assert.equal(db.tables.class_enrollments.filter(row => row.student_id === virtualStudent).length, 1);
  assert.equal(db.calls.some(row => row.op !== "read"), false);
});

test("explicit class-level subjects prevent another Arabic/French level's subjects from leaking into its bulletin", async () => {
  const db = setup();
  db.tables.institutions[0].settings_json.school_student_programs_v1 = {
    version: 1, years: { "2026-2027": { classes: {
      [classId]: { tracks: ["french"], students: {} },
    } } },
  };
  db.tables.institutions[0].settings_json.school_class_subjects_v1 = {
    version: 1, years: { "2026-2027": { classes: { [classId]: [french] } } },
  };
  const api = createFixtureRouteLoader(db, db.legacyAdminId)(routePath);
  const response = await api.GET(url());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const data = await response.json();
  assert.deepEqual(data.specialized.programs, ["french"]);
  assert.ok(data.specialized.documents[0].ready);
  assert.deepEqual(data.specialized.documents[0].document.french.subjects.map(row => row.id), [french]);
  assert.equal(data.specialized.documents[0].document.arabic, undefined);
  assert.equal(db.calls.some(row => row.op !== "read"), false);
});

test("a class explicitly missing its curriculum never produces an official-looking completed bulletin", async () => {
  const db = setup();
  db.tables.institutions[0].settings_json.school_student_programs_v1 = {
    version: 1, years: { "2026-2027": { classes: {
      [classId]: { tracks: ["french"], students: {} },
    } } },
  };
  db.tables.institutions[0].settings_json.school_class_subjects_v1 = {
    version: 1, years: { "2026-2027": { classes: {} } },
  };
  const data = await (await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url())).json();
  assert.equal(data.specialized.documents[0].ready, false);
  assert.equal(data.specialized.documents[0].document.french.generalAverage, null);
  assert.ok(data.specialized.documents[0].problems.includes("class_curriculum_not_configured"));
});

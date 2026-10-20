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




test("the Correspondant Fichier reads French/Arabic bulletins without altering grades or school data", async () => {
  const db = setup();
  const id = "fixture-correspondant";
  db.users.set(id, { user: db.user(id, "correspondant@example.invalid") });
  db.tables.profiles.push({ id, institution_id: db.legacyId });
  db.tables.user_roles.push({ profile_id: id, institution_id: db.legacyId, role: "file_correspondent" });
  db.tables.institutions[0].settings_json.franco_arabic_reports_v1.formatsByCycle = { primary: "combined" };
  const before = structuredClone(db.tables);
  const response = await createFixtureRouteLoader(db, id)(routePath).GET(url());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const data = await response.json();
  assert.equal(data.specialized.engine, "specialized");
  assert.equal(data.specialized.cycle, "primary");
  assert.equal(data.specialized.format, "combined");
  assert.equal(data.specialized.documents.length, 2);
  assert.equal(data.specialized.documents[0].document.french.generalAverage, 8);
  assert.equal(data.specialized.documents[0].document.arabic.generalAverage, 12);
  assert.deepEqual(db.tables, before);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

test("a Correspondant Fichier from another school cannot retrieve specialized bulletins", async () => {
  const db = setup();
  const id = "fixture-foreign-correspondant";
  db.users.set(id, { user: db.user(id, "foreign-correspondant@example.invalid") });
  db.tables.profiles.push({ id, institution_id: "foreign-school" });
  db.tables.user_roles.push({ profile_id: id, institution_id: "foreign-school", role: "file_correspondent" });
  const response = await createFixtureRouteLoader(db, id)(routePath).GET(url());
  assert.equal(response.status, 403);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

test("primary bulletins ignore published devoirs and older written interrogations", async () => {
  const db = setup();
  const template = db.tables.grade_evaluations[0];
  for (const [id, kind, title] of [
    ["legacy-devoir", "devoir", "Devoir"],
    ["legacy-interro", "interro_ecrite", "Interrogation écrite"],
  ]) {
    db.tables.grade_evaluations.push({
      ...template, id, eval_kind: kind, title, is_published: true,
      publication_status: "published",
    });
    db.tables.grade_published_scores.push({
      ...db.tables.grade_published_scores[0],
      id: "score-" + id, evaluation_id: id, score: 10,
    });
  }
  const result = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
  assert.equal(result.status, 200);
  const row = (await result.json()).specialized.documents[0];
  assert.equal(row.document.french.generalAverage, 8);
  assert.equal(row.document.arabic.generalAverage, 12);
  assert.equal(row.ready, true);
});
test("missing composition is incomplete, never an invented zero or an old devoir average", async () => {
  const db = setup();
  db.tables.grade_evaluations[0].eval_kind = "devoir";
  db.tables.grade_evaluations[0].title = "Devoir";
  const result = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
  assert.equal(result.status, 200);
  const row = (await result.json()).specialized.documents[0];
  assert.equal(row.document.french.generalAverage, null);
  assert.equal(row.document.arabic.generalAverage, 12);
  assert.equal(row.programReadiness.french, false);
  assert.equal(row.ready, false);
});


const PRIMARY_LEVELS = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"];

for (const level of PRIMARY_LEVELS) {
  test(`primary ${level}: French and Arabic compositions retain independent means, ranks, configured scales and period`, async () => {
    const db = setup();
    const configs = db.tables.institutions[0].settings_json.franco_arabic_reports_v1;
    db.tables.classes[0].level = level;
    db.tables.institution_level_subjects.forEach(row => { row.level_code = level; });
    db.tables.institution_subject_coeffs.forEach(row => { row.level = level; });
    configs.scales.forEach(row => { row.level = level; });
    // A published devoir has a score, but is NEVER part of the official bulletin.
    db.tables.grade_evaluations.push({
      ...db.tables.grade_evaluations[0], id: `homework-${level}`,
      eval_kind: "devoir", title: "Devoir", grading_period_id: db.tables.grade_periods[0].id,
    });
    db.tables.grade_published_scores.push({
      ...db.tables.grade_published_scores[0], id: `homework-score-${level}`,
      evaluation_id: `homework-${level}`, score: 0,
    });
    // A valid composition in another period cannot contaminate this report.
    db.tables.grade_evaluations.push({
      ...db.tables.grade_evaluations[1], id: `other-period-${level}`,
      grading_period_id: "99999999-9999-4999-8999-999999999999",
    });
    db.tables.grade_published_scores.push({
      ...db.tables.grade_published_scores[1], id: `other-score-${level}`,
      evaluation_id: `other-period-${level}`, score: 0,
    });
    const response = await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url());
    assert.equal(response.status, 200, `${level}: ${JSON.stringify(await response.clone().json())}`);
    const result = (await response.json()).specialized;
    assert.equal(result.cycle, "primary");
    assert.deepEqual(result.programs, ["french", "arabic"]);
    assert.equal(result.documents.length, 2);
    const first = result.documents.find(row => row.studentId === "student-0");
    const second = result.documents.find(row => row.studentId === "student-1");
    assert.ok(first && second, `${level}: two pupils`);
    assert.deepEqual(first.programReadiness, { french: true, arabic: true });
    assert.equal(first.document.french.generalAverage, 8);
    assert.equal(first.document.arabic.generalAverage, 12);
    assert.equal(first.document.french.denominator, 10);
    assert.equal(first.document.arabic.denominator, 20);
    assert.equal(first.document.french.rank, 1);
    assert.equal(first.document.arabic.rank, 1);
    assert.equal(second.document.french.rank, 2);
    assert.equal(second.document.arabic.rank, 2);
    assert.equal("generalAverage" in first.document, false, `${level}: no combined mean`);
    assert.equal(db.calls.some(call => call.op !== "read"), false, `${level}: read-only bulletin`);
  });
}

test("teacher class selector resolves all six primary levels and their separately assigned French/Arabic subjects", async () => {
  const db = setup();
  const teacherId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  db.users.set(teacherId, { user: db.user(teacherId, "teacher-primary@example.invalid") });
  db.tables.profiles.push({ id: teacherId, institution_id: db.legacyId });
  db.tables.user_roles.push({ profile_id: teacherId, institution_id: db.legacyId, role: "teacher" });
  const schoolSettings = db.tables.institutions[0].settings_json;
  schoolSettings.school_student_programs_v1 = { version: 1, years: { "2026-2027": { classes: {} } } };
  schoolSettings.franco_arabic_reports_v1.scales = [];
  db.tables.classes = [];
  db.tables.class_teachers = [];
  for (const [index, level] of PRIMARY_LEVELS.entries()) {
    const classUuid = `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`;
    db.tables.classes.push({ id: classUuid, label: `${level} unique`, level, academic_year: "2026-2027",
      institution_id: db.legacyId, education_type: "general_secondary" });
    schoolSettings.school_student_programs_v1.years["2026-2027"].classes[classUuid] = {
      tracks: ["french", "arabic"], students: {},
    };
    for (const [subjectId, track, maxScore] of [[french, "french", 10], [arabic, "arabic", 20]]) {
      db.tables.class_teachers.push({ institution_id: db.legacyId, class_id: classUuid,
        subject_id: subjectId, teacher_id: teacherId, end_date: null,
        classes: db.tables.classes.at(-1) });
      schoolSettings.franco_arabic_reports_v1.scales.push({ cycle: "primary", level, track, maxScore });
    }
  }
  const teacherRoute = createFixtureRouteLoader(db, teacherId)("src/app/api/grades/classes/route.ts");
  const response = await teacherRoute.GET(new NextRequest("https://example.invalid/api/grades/classes"));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const payload = await response.json();
  assert.equal(payload.mode, "teacher");
  assert.equal(payload.items.length, 12);
  for (const level of PRIMARY_LEVELS) {
    const choices = payload.items.filter(item => item.level === level);
    assert.equal(choices.length, 2, `${level}: two subject-specific choices`);
    const frenchRow = choices.find(item => item.subject_id === french);
    const arabicRow = choices.find(item => item.subject_id === arabic);
    assert.equal(frenchRow?.school_cycle, "primary", `${level}: French in primary`);
    assert.equal(arabicRow?.school_cycle, "primary", `${level}: Arabic in primary`);
    assert.equal(frenchRow?.teaching_track, "french", `${level}: French assigned subject`);
    assert.equal(arabicRow?.teaching_track, "arabic", `${level}: Arabic assigned subject`);
    assert.equal(frenchRow?.configured_scale, 10, `${level}: configured French scale`);
    assert.equal(arabicRow?.configured_scale, 20, `${level}: configured Arabic scale`);
  }
});
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
  assert.equal(body.specialized.documents[0].document.arabic.generalAverage, 12);
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
  assert.equal(row.ready, true);
  assert.equal(row.document.french.generalAverage, 16, "historical secondary engine normalizes /10 grades onto /20");
  assert.equal(row.document.french.denominator, 20);
  assert.deepEqual(row.document.french.subjects.map(subject => subject.id), [french]);
  assert.equal(row.document.french.subjects[0].coefficient, 2, "use historical secondary coefficient");
  assert.deepEqual(row.programReadiness, { french: true, arabic: true });
  db.tables.institution_level_subjects.forEach(item => { item.level_code = "5eme"; });
  const missing = await (await createFixtureRouteLoader(db, db.legacyAdminId)(routePath).GET(url())).json();
  assert.equal(missing.specialized.documents[0].ready, false, "Arabic specialized curriculum still requires correct level");
  assert.equal(missing.specialized.documents[0].document.french.generalAverage, 16,
    "French MUST still use historical secondary data even when Arabic specialized curriculum is incomplete");
  assert.equal(missing.specialized.documents[0].programReadiness.french, true);
  assert.equal(missing.specialized.documents[0].programReadiness.arabic, false);
});

test("secondary French franco-arabe exactly reproduces the historical engine for an ordinary school and CSCA", async () => {
  for (const name of ["EPC Dimbokro", "CSCA"]) {
    const specializedDb = setup({ name });
    const baselineDb = setup({ specialized: false, name });
    const configs = specializedDb.tables.institutions[0].settings_json;
    configs.school_cycles_v1.enabledCycles = ["secondary"];
    configs.school_cycles_v1.teachingTracksByCycle = { secondary: ["french", "arabic"] };
    configs.school_cycles_v1.subjectTracksByCycle = {
      secondary: configs.school_cycles_v1.subjectTracksByCycle.primary,
    };
    specializedDb.tables.classes[0].level = "6e";
    specializedDb.tables.institution_subject_coeffs.forEach(row => { row.level = "6eme"; });
    specializedDb.tables.institution_level_subjects.forEach(row => { row.level_code = "6eme"; });
    configs.franco_arabic_reports_v1.scales.forEach(row => {
      row.cycle = "secondary"; row.level = "6e"; row.maxScore = 20;
    });
    const removeArabic = table => table.filter(row =>
      !("subject_id" in row) || row.subject_id === french);
    baselineDb.tables.subjects = baselineDb.tables.subjects.filter(row => row.id === french);
    for (const table of ["institution_subjects", "institution_subject_coeffs",
      "institution_level_subjects", "grade_evaluations", "grade_published_scores"]) {
      baselineDb.tables[table] = removeArabic(baselineDb.tables[table]);
    }
    const specialized = await createFixtureRouteLoader(specializedDb, specializedDb.legacyAdminId)(routePath).GET(url());
    const baseline = await createFixtureRouteLoader(baselineDb, baselineDb.legacyAdminId)(routePath).GET(url());
    assert.equal(specialized.status, 200, name + JSON.stringify(await specialized.clone().json()));
    assert.equal(baseline.status, 200, name + JSON.stringify(await baseline.clone().json()));
    const { specialized: report } = await specialized.json();
    const historical = await baseline.json();
    const legacyByStudent = new Map(historical.items.map(item => [item.student_id, item]));
    for (const row of report.documents) {
      const exact = legacyByStudent.get(row.studentId);
      assert.ok(exact, name + " historical student must be present");
      assert.equal(row.document.french.generalAverage, exact.general_avg, name + " mean");
      assert.equal(row.document.french.rank, exact.rank, name + " rank");
      assert.equal(row.document.french.historicalSecondary.conductAverage, exact.conduct_avg, name + " conduct");
      assert.equal(row.document.french.historicalSecondary.annualAverage, exact.annual_avg, name + " annual");
      assert.deepEqual(row.document.french.subjects.map(subject => ({
        id: subject.id, average: subject.average,
      })), (exact.per_subject || []).map(subject => ({
        id: subject.subject_id, average: subject.avg20,
      })), name + " subject results must be identical");
      assert.ok(row.document.arabic, "Arabic remains its own independent engine");
    }
    assert.equal(specializedDb.calls.some(call => call.op !== "read"), false);
    assert.equal(baselineDb.calls.some(call => call.op !== "read"), false);
  }
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
  // One additional batch reads teachers for the entire class, never per pupil.
  assert.equal(counts[0], counts[1]); assert.ok(counts[0] <= 13, `Unexpected read count: ${counts}`);
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

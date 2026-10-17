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

import assert from "node:assert/strict";
import test from "node:test";
import { setup, create, report, req, cls, math, teacher, pupil0, pupil1, evaluationPath } from "./helpers/primary-event-fixture.mjs";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const classActor = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
function login(db, role) {
  if (role === "teacher") return db.teacher;
  db.users.set(classActor, { user: db.user(classActor, "class@example.invalid") });
  db.tables.profiles.push({ id: classActor, institution_id: db.legacyId });
  db.tables.user_roles.push({ profile_id: classActor, institution_id: db.legacyId, role: "class_device" });
  db.tables.classes[0].class_device_auth_user_id = classActor;
  return createFixtureRouteLoader(db, classActor);
}
const pathFor = role => role === "teacher" ? "/api/teacher/grades/scores/bulk" : "/api/grades/scores/bulk";

for (const role of ["teacher", "class_device"]) for (const bilingual of [true, false]) {
  for (const level of ["CP1", "CM1"]) test(`${role}, ${level}, bilingual=${bilingual}: one save feeds the real bulletin and corrections retain history`, async () => {
    const db = setup(level, bilingual), load = login(db, role);
    // Use the actual account's creation handler, including French-only class accounts.
    const response = await load(evaluationPath).POST(req("/api/teacher/grades/evaluations", {
      class_id: cls, subject_id: math, eval_kind: "composition", scale: db.scale("french"),
      coeff: 1, primary_event_code: "DEC", teaching_track: "french",
    }));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const ev = (await response.json()).item, endpoint = pathFor(role);
    if (role === "class_device") {
      const alias = db.tables.institution_subjects.find(s => s.subject_id === math);
      db.tables.class_teachers[0].subject_id = alias.id;
    }
    const save = items => load(`src/app${endpoint}/route.ts`).POST(req(endpoint, { evaluation_id: ev.id, items }));
    const first = await save([{ student_id: pupil0, score: db.scale("french") * 0.8 }, { student_id: pupil1, score: db.scale("french") * 0.6 }]);
    assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
    const payload = await first.json();
    assert.equal(payload.publication?.is_published, true);
    const bulletin = (await report(db, "DEC")).specialized.documents.find(row => row.studentId === pupil0).document.french;
    assert.equal(bulletin.generalAverage, 8);
    assert.equal(bulletin.rank, 1);
    assert.equal(bulletin.subjects.find(s => s.average !== null).classAverage, db.scale("french") * 0.7);
    const corrected = await save([{ student_id: pupil0, score: 0 }]);
    assert.equal(corrected.status, 200, JSON.stringify(await corrected.clone().json()));
    assert.ok((await corrected.json()).publication.publication_version > payload.publication.publication_version);
    assert.equal((await report(db, "DEC")).specialized.documents.find(row => row.studentId === pupil0).document.french.generalAverage, 0);
    assert.ok(db.tables.grade_published_scores.some(s => s.evaluation_id === ev.id && !s.is_current));
  });
}

for (const role of ["teacher", "class_device"]) test(`${role}: primary save resumes a legacy submission but retains PIN and pupil checks`, async () => {
  const db = setup("CP1", false), load = login(db, role), ev = await create(db, "DEC");
  db.tables.grade_evaluations[0].publication_status = "submitted";
  const endpoint = pathFor(role), save = student => load(`src/app${endpoint}/route.ts`).POST(req(endpoint, {
    evaluation_id: ev.id, items: [{ student_id: student, score: 8 }],
  }));
  db.tables.grade_evaluation_locks = [{ evaluation_id: ev.id, is_locked: true }];
  assert.equal((await save(pupil0)).status, 423);
  assert.equal(db.tables.grade_published_scores.length, 0);
  db.tables.grade_evaluation_locks[0].is_locked = false;
  assert.equal((await save("ffffffff-ffff-4fff-8fff-ffffffffffff")).status, 403);
  const saved = await save(pupil0);
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  assert.equal((await saved.json()).publication?.is_published, true);
});

test("secondary Enregistrer still saves a draft without publishing", async () => {
  const db = setup(), ev = await create(db, "DEC");
  db.tables.institutions[0].settings_json.school_cycles_v1.enabled = false;
  db.tables.classes[0].level = "6e";
  const saved = await db.teacher("src/app/api/teacher/grades/scores/bulk/route.ts").POST(req("/api/teacher/grades/scores/bulk", {
    evaluation_id: ev.id, items: [{ student_id: pupil0, score: 8 }],
  }));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).publication, null);
  assert.equal(db.tables.grade_published_scores.length, 0);
  assert.equal(db.tables.grade_evaluations[0].is_published, false);
});

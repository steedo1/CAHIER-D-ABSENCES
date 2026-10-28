import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

import { setup, create, publish, report, req, calendarPath, year, cls, math, teacher, pupil0, pupil1, evaluationPath } from "./helpers/primary-event-fixture.mjs";

for (const level of ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"]) test(`${level}: dated creation → scores → official publication → independent French/Arabic event reports`, async () => {
  const db = setup(level);
  const options = await (await db.teacher("src/app/api/grades/classes/route.ts").GET(req("/api/grades/classes"))).json();
  assert.deepEqual(options.items.filter(s => s.subject_id === math).map(s => [s.teaching_track, s.configured_scale]).sort(), [["arabic",20],["french",db.scale("french")]]);
  for (const track of ["french", "arabic"]) {
    await publish(db, "DEC", track, track === "french" ? 0.8 : 0.4);
    await publish(db, "NIV1", track, 1);
    await publish(db, "NIV2", track, 0);
    await publish(db, "DEVOIR", track, 1);
  }
  const result = await report(db, "DEC");
  const student = result.specialized.documents.find(d => d.studentId === pupil0);
  assert.equal(student.document.french.generalAverage, 8);
  assert.equal(student.document.arabic.generalAverage, 4);
  assert.equal(student.document.arabic.classSize, 1);
  assert.equal(student.document.french.classSize, 2);
  assert.equal(student.document.french.rank, 1); assert.equal(student.document.arabic.rank, 1);
  assert.equal(student.document.arabic.subjects.length, 2, "configured subjects stay visible, blanks do not affect the average");
  assert.equal(student.document.arabic.subjects.filter(subject => subject.average !== null).length, 1);
  assert.equal(student.document.french.primaryAnnual, undefined);
  assert.equal(result.specialized.documents.find(d => d.studentId === pupil1).document.arabic, undefined);
  assert.equal((await report(db, "NIV2")).specialized.documents[0].document.arabic.generalAverage, 0, "a real zero remains graded");
  if (level === "CM2") {
    await publish(db, "BLANC", "french", 0.9);
    const mock = await report(db, "BLANC");
    assert.equal(mock.specialized.documents[0].document.french.primaryAnnual, undefined);
    return;
  }
  for (const track of ["french", "arabic"]) {
    await publish(db, "FEV", track, track === "french" ? 0.6 : 0.2);
    await publish(db, "AVR", track, track === "french" ? 0.7 : 0.3);
    await publish(db, "PASS", track, track === "french" ? 0.8 : 0.4);
  }
  const annual = (await report(db, "PASS")).specialized.documents[0];
  assert.deepEqual(annual.document.french.primaryAnnual.ordinary.map(e => e.average), [8,6,7]);
  assert.equal(annual.document.french.primaryAnnual.annualAverage, 7.67);
  assert.equal(annual.document.arabic.primaryAnnual.annualAverage, 3.67);
  assert.equal(annual.document.french.primaryAnnual.decision, "ADMIS");
  assert.equal(annual.document.arabic.primaryAnnual.decision, "AVIS DU CONSEIL DES MAÎTRES REQUIS");
  assert.equal(annual.ready, true);
});

test("French-only primary calendar, homework without a period and concurrent settings writes", async () => {
  const db = setup("CP1", false), api = db.admin(calendarPath);
  const loaded = await (await api.GET(req(`/api/admin/institution/primary-evaluation-events?academic_year=${year}`))).json();
  assert.deepEqual(loaded.tracks, ["french"]);
  const payload = { academic_year: year, events: db.events, revision: loaded.revision };
  db.tables.institutions[0].settings_json.finance = { preserved: true };
  assert.equal((await api.PUT(req("/api/admin/institution/primary-evaluation-events", payload, "PUT"))).status, 409);
  payload.revision = (await (await api.GET(req(`/api/admin/institution/primary-evaluation-events?academic_year=${year}`))).json()).revision;
  const saved = await api.PUT(req("/api/admin/institution/primary-evaluation-events", payload, "PUT"));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  assert.deepEqual(db.tables.institutions[0].settings_json.finance, { preserved: true });
  db.tables.institutions[0].settings_json.primary_evaluation_events_v1.years[year].events = [];
  await create(db, "DEVOIR", "french", { eval_date: "2026-11-17" });
  const rows = await (await db.teacher(evaluationPath).GET(req(`/api/teacher/grades/evaluations?class_id=${cls}&subject_id=${math}&teaching_track=french`))).json();
  assert.equal(rows.primary_event_catalog_enabled, true); assert.deepEqual(rows.primary_events, []);
});

test("large EPC settings allow a primary composition label update without a long JSONB URL", async () => {
  const db = setup("CP1", true);
  db.tables.institutions[0].settings_json.unrelatedLargeSettings = { preserve: "z".repeat(25000) };
  const originalFrom = db.service.from;
  db.service.from = table => {
    const query = originalFrom(table);
    if (table === "institutions") {
      const originalEq = query.eq.bind(query);
      query.eq = (field, value) => {
        if (field === "settings_json" && typeof value === "string" && value.length > 8000) {
          throw new Error("oversized full-document HTTP filter");
        }
        return originalEq(field, value);
      };
    }
    return query;
  };
  const api = db.admin(calendarPath);
  const loaded = await (await api.GET(req(`/api/admin/institution/primary-evaluation-events?academic_year=${year}`))).json();
  const renamed = loaded.events.map(event => event.code === "DEC"
    ? { ...event, label: "Composition n° 1 de l'EPC" } : event);
  const response = await api.PUT(req("/api/admin/institution/primary-evaluation-events",
    { academic_year: year, revision: loaded.revision, events: renamed }, "PUT"));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(db.tables.institutions[0].settings_json.unrelatedLargeSettings.preserve.length, 25000);
  const latest = await (await api.GET(req(`/api/admin/institution/primary-evaluation-events?academic_year=${year}`))).json();
  assert.equal(latest.events.find(event => event.code === "DEC").label, "Composition n° 1 de l'EPC");
  assert.equal((await api.PUT(req("/api/admin/institution/primary-evaluation-events",
    { academic_year: year, revision: loaded.revision, events: renamed }, "PUT"))).status, 409);
});

test("server dates, publication identity, repeated event selection and used calendar protection", async () => {
  const db = setup(), ev = await create(db, "DEC");
  assert.equal((await create(db, "DEC", "french", { eval_date: "2030-01-01" })).id, ev.id);
  assert.equal(db.tables.grade_evaluations.length, 1, "no duplicate column or double-counting");
  const foreign = await db.teacher(evaluationPath).POST(req("/api/teacher/grades/evaluations", { class_id: "foreign", eval_kind: "devoir", scale: 10, primary_event_code: "DEC", teaching_track: "french" }));
  assert.equal(foreign.status, 403);
  for (const changes of [{ scale: 0 }, { scale: 101 }, { coeff: 2 }, { primary_event_code: "UNKNOWN" }, { teaching_track: "bogus" }]) {
    const response = await db.teacher(evaluationPath).POST(req("/api/teacher/grades/evaluations", { class_id: cls, subject_id: math, eval_kind: "devoir", scale: 10, coeff: 1, primary_event_code: "DEC", teaching_track: "french", ...changes }));
    assert.ok(response.status >= 400);
  }
  const api = db.admin(calendarPath), rev = (await (await api.GET(req(`/api/admin/institution/primary-evaluation-events?academic_year=${year}`))).json()).revision;
  const events = db.events.map(e => e.code === "DEC" ? { ...e, date: "2026-12-11" } : e);
  assert.equal((await api.PUT(req("/api/admin/institution/primary-evaluation-events", { academic_year: year, revision: rev, events }, "PUT"))).status, 409);
  const unauthorized = createFixtureRouteLoader(db, teacher)(calendarPath);
  assert.equal((await unauthorized.PUT(req("/api/admin/institution/primary-evaluation-events", { academic_year: year, revision: rev, events: db.events }, "PUT"))).status, 403);
  assert.equal((await api.GET(req(`/api/admin/institution/primary-evaluation-events?academic_year=${year}&class_id=foreign`))).status, 404);
});

test("missing, unpublished, duplicate or stale compositions never invent an annual result", async () => {
  const db = setup();
  for (const code of ["DEC","FEV","PASS"]) await publish(db, code, "french", 0.8);
  let row = (await report(db, "PASS")).specialized.documents[0];
  assert.equal(row.document.french.primaryAnnual.annualAverage, null);
  await publish(db, "AVR", "french", 0.8);
  assert.equal((await report(db, "PASS")).specialized.documents[0].document.french.primaryAnnual.annualAverage, 8);
  const evaluation = db.tables.grade_evaluations.find(e => e.title.includes(":DEC:"));
  evaluation.publication_status = "draft"; evaluation.is_published = false;
  assert.equal((await report(db, "PASS")).specialized.documents[0].document.french.primaryAnnual.annualAverage, null);
  evaluation.publication_status = "published"; evaluation.is_published = true;
  db.tables.grade_evaluations.push({ ...evaluation, id: "duplicate" });
  assert.equal((await report(db, "PASS")).specialized.documents[0].document.french.primaryAnnual.annualAverage, null);
  db.tables.grade_evaluations.pop(); evaluation.eval_date = "2026-12-11";
  assert.equal((await report(db, "PASS")).specialized.documents[0].document.french.primaryAnnual.annualAverage, null);
});

test("a French-only pupil cannot receive Arabic marks; changing teaching filters the actual roster and columns", async () => {
  const db = setup();
  const fr = await create(db, "DEC", "french"), ar = await create(db, "DEC", "arabic");
  assert.notEqual(fr.id, ar.id);
  const roster = await db.teacher("src/app/api/teacher/roster/route.ts").GET(req(`/api/teacher/roster?class_id=${cls}&teaching_track=arabic`));
  assert.deepEqual((await roster.json()).items.map(s => s.id), [pupil0]);
  const forbidden = await db.teacher("src/app/api/teacher/grades/scores/bulk/route.ts").POST(req("/api/teacher/grades/scores/bulk", { evaluation_id: ar.id, items: [{ student_id: pupil1, score: 10 }] }));
  assert.equal(forbidden.status, 403);
  for (const [track, expected] of [["french",fr.id],["arabic",ar.id]]) {
    const data = await (await db.teacher(evaluationPath).GET(req(`/api/teacher/grades/evaluations?class_id=${cls}&subject_id=${math}&teaching_track=${track}`))).json();
    assert.deepEqual(data.items.map(e => e.id), [expected]);
  }
});


test("dated subject averages read only the selected official snapshot and teaching, without a period", async () => {
  const db = setup("CM1");
  for (const [code,track,ratio] of [["DEC","french",0.8],["DEC","arabic",0.3],["NIV1","french",1]]) await publish(db, code, track, ratio);
  const api = db.teacher("src/app/api/teacher/grades/averages/route.ts");
  const response = await api.GET(req(`/api/teacher/grades/averages?class_id=${cls}&subject_id=${math}&primary_event_code=DEC&teaching_track=french&academic_year=${year}`));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const data = await response.json();
  assert.equal(data.items.find(row => row.student_id === pupil0).average, 16, "existing /20 display = 40/50, unrelated internal marks ignored");
  assert.equal(data.meta.grades_source, "grade_published_scores");
  assert.equal(data.meta.evaluations, 1);
});

test("Franco-Arabic teacher publication queues only the official parent snapshot once", async () => {
  const db = setup();
  // La direction a activé explicitement les notifications push.
  db.tables.institution_grade_publication_settings[0].auto_push_on_publish = true;
  const ev = await create(db, "DEC", "arabic");
  // Only dispatch transport is isolated; real publication and queue code run.
  const overrides = new Map([["src/lib/push-dispatch.ts", "export async function triggerPushDispatch(){ return true; }"]]);
  const load = createFixtureRouteLoader(db, teacher, overrides);
  const stored = db.tables.grade_evaluations.find(row => row.id === ev.id);
  stored.class = { ...db.tables.classes[0] }; stored.subject = { id: math, name: "Mathématiques" };
  db.tables.students = [db.tables.class_enrollments[0].students];
  db.tables.student_guardians = [{ id: "guardian", student_id: pupil0, guardian_profile_id: "parent", notifications_enabled: true }];
  const saved = await load("src/app/api/teacher/grades/scores/bulk/route.ts").POST(req("/api/teacher/grades/scores/bulk", { evaluation_id: ev.id, items: [{ student_id: pupil0, score: 0 }] }));
  assert.equal(saved.status, 200);

  const published = await load(evaluationPath).PATCH(req("/api/teacher/grades/evaluations", { evaluation_id: ev.id, is_published: true }, "PATCH"));
  assert.equal(published.status, 200, JSON.stringify(await published.clone().json()));
  assert.equal(db.tables.grade_evaluations[0].publication_status, "published", "no admin approval despite legacy validation=true");
  assert.equal(db.tables.notifications_queue.filter(row => row.status === "pending").length, 1);
  const notification = db.tables.notifications_queue.find(row => row.status === "pending");
  assert.equal(notification.profile_id, "parent");
  assert.equal(notification.payload.score, 0);
  assert.equal(notification.payload.evaluation.label, "Composition de décembre");
  assert.equal(notification.payload.evaluation.teaching_track, "arabic");
  await load("src/lib/push/grades.ts").queueGradeNotificationsForEvaluation(ev.id);
  assert.equal(db.tables.notifications_queue.filter(row => row.status === "pending").length, 1, "an official snapshot already queued is not duplicated");
});


test("Franco-Arabic school with disabled push does not notify parents on publication", async () => {
  const db = setup();
  db.tables.institution_grade_publication_settings[0].auto_push_on_publish = false;
  const ev = await create(db, "DEC", "french");
  const saved = await db.teacher("src/app/api/teacher/grades/scores/bulk/route.ts")
    .POST(req("/api/teacher/grades/scores/bulk", {
      evaluation_id: ev.id, items: [{ student_id: pupil0, score: 8 }],
    }));
  assert.equal(saved.status, 200);
  const published = await db.teacher(evaluationPath).PATCH(
    req("/api/teacher/grades/evaluations", {
      evaluation_id: ev.id, is_published: true,
    }, "PATCH"));
  assert.equal(published.status, 200);
  assert.equal(db.tables.grade_evaluations[0].publication_status, "published");
  assert.equal(db.tables.notifications_queue.filter(row => row.status === "pending").length, 0,
    "the administrative push switch must be respected");
});

test("concurrent creation cannot duplicate the same event/subject/teaching", async () => {
  const db = setup();
  const [first,second] = await Promise.all([create(db,"DEC"),create(db,"DEC")]);
  assert.equal(first.id,second.id);
  assert.equal(db.tables.grade_evaluations.length,1);
});

test("French-only primary retains its existing administrator validation policy", async () => {
  const db = setup("CP1",false), ev = await create(db,"DEC");
  const result = await db.teacher(evaluationPath).PATCH(req("/api/teacher/grades/evaluations",{evaluation_id:ev.id,is_published:true},"PATCH"));
  assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
  assert.equal(db.tables.grade_evaluations[0].publication_status,"submitted");
  assert.equal(db.tables.grade_published_scores.length,0);
});

test("CP2: teacher may enter /30 over the configured default and the published bulletin uses /30", async () => {
  const db = setup("CP2");
  const ev = await create(db, "DEC", "french", { scale: 30 });
  assert.equal(ev.scale, 30);
  assert.equal(db.tables.grade_evaluations[0].scale, 60);
  assert.match(db.tables.grade_evaluations[0].title, /:S30$/);
  const stored = db.tables.grade_evaluations[0];
  stored.class = { ...db.tables.classes[0] };
  stored.subject = { id: math, name: "Mathématiques" };
  db.tables.students = [db.tables.class_enrollments[0].students];
  const loader = createFixtureRouteLoader(db, teacher);
  const saved = await loader("src/app/api/teacher/grades/scores/bulk/route.ts")
    .POST(req("/api/teacher/grades/scores/bulk", {
      evaluation_id: ev.id, items: [{ student_id: pupil0, score: 24 }],
    }));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const published = await loader(evaluationPath).PATCH(
    req("/api/teacher/grades/evaluations", { evaluation_id: ev.id, is_published: true }, "PATCH"));
  assert.equal(published.status, 200, JSON.stringify(await published.clone().json()));
  assert.equal(db.tables.grade_published_scores[0].scale, 30);
  assert.equal(db.tables.grade_published_scores[0].score, 24);
  const bulletin = (await report(db, "DEC")).specialized.documents[0].document.french;
  assert.equal(bulletin.generalAverage, 8);
  assert.equal(bulletin.subjects.find(s => s.average !== null).denominator, 30);
});

test("actual production scale CHECK: /50 keeps raw points, displayed scales and official snapshots without DDL", async () => {
  const db = setup("CM1");
  db.tables.institution_grade_publication_settings[0].auto_push_on_publish = true;
  const ev = await create(db,"DEC","french");
  assert.equal(ev.scale,50);
  const stored = db.tables.grade_evaluations[0];
  assert.equal(stored.scale,60,"a value allowed by the existing production constraint");
  assert.match(stored.title,/:S50$/);
  const loader = createFixtureRouteLoader(db,teacher,new Map([["src/lib/push-dispatch.ts","export async function triggerPushDispatch(){return true;}"]]));
  stored.class = {...db.tables.classes[0]};stored.subject={id:math,name:"Mathématiques"};
  db.tables.students=[db.tables.class_enrollments[0].students];
  const saved = await loader("src/app/api/teacher/grades/scores/bulk/route.ts").POST(req("/api/teacher/grades/scores/bulk",{evaluation_id:ev.id,items:[{student_id:pupil0,score:37.25}]}));
  assert.equal(saved.status,200);
  assert.equal(db.tables.student_grades[0].score,37.25,"raw marks are not rescaled or rounded away");

  const published=await loader(evaluationPath).PATCH(req("/api/teacher/grades/evaluations",{evaluation_id:ev.id,is_published:true},"PATCH"));
  assert.equal(published.status,200,JSON.stringify(await published.clone().json()));
  assert.equal(db.tables.grade_published_scores[0].scale,50);
  assert.equal(db.tables.grade_published_scores[0].score,37.25);
  assert.equal((await report(db,"DEC")).specialized.documents[0].document.french.generalAverage,7.45);
  const active=db.tables.notifications_queue.filter(row=>row.status==="pending");
  assert.equal(active.length,1,"only the official graded pupil, without the SQL trigger's false missed mark");
  assert.equal(active[0].profile_id,null,"matricule-linked student devices remain eligible without a guardian account");
  assert.equal(active[0].payload.evaluation.scale,50);
  assert.equal(active[0].payload.score,37.25);
  assert.ok(db.tables.notifications_queue.filter(row=>row.status==="error").length>=2,"legacy trigger rows retained, not deleted");
  const listed=await (await db.teacher(evaluationPath).GET(req(`/api/teacher/grades/evaluations?class_id=${cls}&subject_id=${math}&teaching_track=french`))).json();
  assert.equal(listed.items[0].scale,50);
  const reader=db.teacher("src/lib/grades/primary-notification-policy.ts");
  const legacy={id:"trigger-race",payload:{kind:"grade_missing",evaluation:{id:ev.id}}};
  const secondary={id:"secondary",payload:{kind:"grade",evaluation:{id:"secondary-eval"}}};
  const canonical={id:"canonical",payload:{kind:"grade",evaluation:{id:ev.id},publication:{source:"grade_published_scores"}}};
  const result=await reader.filterPrimaryOfficialNotifications(db.service,[legacy,secondary,canonical]);
  assert.deepEqual(result.map(row=>row.id),["secondary","canonical"],"a worker that picked legacy primary rows during publication still cannot deliver them");
});


test("EPC CP1 class-device shares configured compositions and publishes each grade save", async () => {
  const db = setup("CP1", true);
  const classDevice = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  db.users.set(classDevice, { user: db.user(classDevice, "class-cp1@example.invalid") });
  db.tables.profiles.push({ id: classDevice, institution_id: db.legacyId, display_name: "CP1 français" });
  db.tables.user_roles.push({ profile_id: classDevice, institution_id: db.legacyId, role: "class_device" });
  db.tables.classes[0].class_device_auth_user_id = classDevice;
  const classLogin = createFixtureRouteLoader(db, classDevice);
  const evalRoute = classLogin(evaluationPath);
  const listed = await evalRoute.GET(req(`/api/teacher/grades/evaluations?class_id=${cls}&subject_id=${math}&teaching_track=french`));
  assert.equal(listed.status, 200, JSON.stringify(await listed.clone().json()));
  const catalog = await listed.json();
  assert.equal(catalog.primary_event_catalog_enabled, true);
  assert.ok(catalog.primary_events.some(event => event.code === "DEC" && event.date === "2026-12-10"));

  const created = await evalRoute.POST(req("/api/teacher/grades/evaluations", {
    class_id: cls, subject_id: math, eval_kind: "composition", scale: db.scale("french"),
    coeff: 1, primary_event_code: "DEC", teaching_track: "french", eval_date: "2026-10-01",
  }));
  assert.equal(created.status, 200, JSON.stringify(await created.clone().json()));
  const evaluation = (await created.json()).item;
  assert.equal(evaluation.teacher_id, teacher, "the real teacher owns the evaluation");
  assert.equal(evaluation.eval_date, "2026-12-10");

  const gradeApi = classLogin("src/app/api/grades/scores/bulk/route.ts");
  const first = await gradeApi.POST(req("/api/grades/scores/bulk", {
    evaluation_id: evaluation.id, items: [{ student_id: pupil0, score: 7 }],
  }));
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
  const firstPayload = await first.json();
  assert.equal(firstPayload.publication?.is_published, true);
  assert.equal(db.tables.grade_evaluations[0].publication_status, "published");

  const second = await gradeApi.POST(req("/api/grades/scores/bulk", {
    evaluation_id: evaluation.id, items: [{ student_id: pupil1, score: 9 }],
  }));
  assert.equal(second.status, 200, JSON.stringify(await second.clone().json()));
  const secondPayload = await second.json();
  assert.equal(secondPayload.publication?.is_published, true);
  assert.ok(secondPayload.publication.publication_version > firstPayload.publication.publication_version);
  assert.equal(db.tables.student_grades.filter(g => g.evaluation_id === evaluation.id).length, 2);
  const after = await evalRoute.GET(req(`/api/teacher/grades/evaluations?class_id=${cls}&subject_id=${math}&teaching_track=french`));
  assert.ok((await after.json()).items.some(ev => ev.id === evaluation.id));

  const outOfScope = await evalRoute.GET(req(`/api/teacher/grades/evaluations?class_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&subject_id=${math}&teaching_track=french`));
  assert.equal(outOfScope.status, 403);
});


test("EPC class-device can remove an unused opened primary note, but cannot erase marks or official history", async () => {
  const db = setup("CP1", true);
  const classDevice = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  db.users.set(classDevice, { user: db.user(classDevice, "cp1-delete@example.invalid") });
  db.tables.profiles.push({ id: classDevice, institution_id: db.legacyId });
  db.tables.user_roles.push({ profile_id: classDevice, institution_id: db.legacyId, role: "class_device" });
  db.tables.classes[0].class_device_auth_user_id = classDevice;
  const route = createFixtureRouteLoader(db, classDevice)("src/app/api/grades/evaluations/route.ts");
  const remove = id => route.DELETE(req("/api/grades/evaluations", { evaluation_id: id }, "DELETE"));

  const opened = await create(db, "DEC", "french");
  assert.equal(db.tables.grade_evaluations.length, 1);
  const deleted = await remove(opened.id);
  assert.equal(deleted.status, 200, JSON.stringify(await deleted.clone().json()));
  assert.equal(db.tables.grade_evaluations.length, 0, "only the opened draft grade column is removed");
  assert.equal(db.events.length, 6, "school evaluation calendar is not modified");

  const entered = await create(db, "NIV1", "french");
  db.tables.student_grades = [{ evaluation_id: entered.id, student_id: pupil0, score: 8 }];
  const protectedWithScore = await remove(entered.id);
  assert.equal(protectedWithScore.status, 423);
  assert.equal((await protectedWithScore.json()).error, "primary_evaluation_has_scores");
  assert.equal(db.tables.grade_evaluations.length, 1);
  assert.equal(db.tables.student_grades.length, 1, "entered pupil grade remains untouched");

  db.tables.student_grades = [];
  db.tables.grade_published_scores = [{
    id: "historical-primary-grade", evaluation_id: entered.id,
    student_id: pupil0, score: 8, is_current: false,
  }];
  const protectedHistory = await remove(entered.id);
  assert.equal(protectedHistory.status, 423);
  assert.equal((await protectedHistory.json()).error, "primary_evaluation_has_official_history");
  assert.equal(db.tables.grade_published_scores.length, 1, "historical official score remains untouched");

  db.tables.grade_published_scores = [];
  const otherDevice = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  db.users.set(otherDevice, { user: db.user(otherDevice, "foreign-device@example.invalid") });
  db.tables.profiles.push({ id: otherDevice, institution_id: db.legacyId });
  db.tables.user_roles.push({ profile_id: otherDevice, institution_id: db.legacyId, role: "class_device" });
  const otherRoute = createFixtureRouteLoader(db, otherDevice)("src/app/api/grades/evaluations/route.ts");
  const forbidden = await otherRoute.DELETE(req("/api/grades/evaluations", { evaluation_id: entered.id }, "DELETE"));
  assert.equal(forbidden.status, 403, JSON.stringify(await forbidden.clone().json()));
  assert.equal(db.tables.grade_evaluations.length, 1);
});


test("EPC class-device deletion maps institution_subjects ids to canonical subjects ids safely", async () => {
  const db = setup("CP1", true);
  const classDevice = "dddddddd-dddd-4ddd-8ddd-cccccccccccc";
  db.users.set(classDevice, { user: db.user(classDevice, "scoped-delete@example.invalid") });
  db.tables.profiles.push({ id: classDevice, institution_id: db.legacyId });
  db.tables.user_roles.push({ profile_id: classDevice, institution_id: db.legacyId, role: "class_device" });
  db.tables.classes[0].class_device_auth_user_id = classDevice;
  const route = createFixtureRouteLoader(db, classDevice)("src/app/api/grades/evaluations/route.ts");
  const remove = id => route.DELETE(req("/api/grades/evaluations", { evaluation_id: id }, "DELETE"));

  const opened = await create(db, "NIV1", "french");
  const matchingAlias = db.tables.institution_subjects.find(row =>
    row.institution_id === db.legacyId && row.subject_id === math);
  assert.ok(matchingAlias);
  assert.notEqual(matchingAlias.id, math, "teacher assignment uses institution subject id");
  db.tables.class_teachers[0].subject_id = matchingAlias.id;
  const deleted = await remove(opened.id);
  assert.equal(deleted.status, 200, JSON.stringify(await deleted.clone().json()));
  assert.equal(db.tables.grade_evaluations.length, 0);

  // Another discipline's assignment must never authorize deletion.
  db.tables.class_teachers[0].subject_id = math;
  const foreignSubject = db.tables.subjects.find(row => row.id !== math);
  assert.ok(foreignSubject);
  const wrong = await create(db, "NIV2", "french");
  db.tables.grade_evaluations.find(row => row.id === wrong.id).subject_id = foreignSubject.id;
  const blocked = await remove(wrong.id);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, "class_device_subject_forbidden");
  assert.equal(db.tables.grade_evaluations.length, 1);
});

test("EPC primary teacher corrects a published note without unpublishing or deleting history", async () => {
  const db = setup("CP1", true);
  const evaluation = await publish(db, "DEC", "french", 0.7);
  const previousVersion = db.tables.grade_evaluations.find(row => row.id === evaluation.id).publication_version;
  const route = db.teacher("src/app/api/teacher/grades/scores/bulk/route.ts");

  const correction = await route.POST(req("/api/teacher/grades/scores/bulk", {
    evaluation_id: evaluation.id, items: [{ student_id: pupil0, score: 9.5 }],
  }));
  assert.equal(correction.status, 200, JSON.stringify(await correction.clone().json()));
  const result = await correction.json();
  assert.equal(result.publication?.is_published, true);
  assert.equal(result.publication.publication_version, previousVersion + 1);
  const current = db.tables.grade_published_scores.filter(row =>
    row.evaluation_id === evaluation.id && row.is_current);
  assert.equal(current.find(row => row.student_id === pupil0)?.score, 9.5);
  assert.equal(db.tables.grade_published_scores.some(row =>
    row.evaluation_id === evaluation.id && !row.is_current), true,
    "the previous official version is archived, not deleted");

  const outsider = "aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaa";
  db.users.set(outsider, { user: db.user(outsider, "outsider@example.invalid") });
  db.tables.profiles.push({ id: outsider, institution_id: db.legacyId });
  db.tables.user_roles.push({ profile_id: outsider, institution_id: db.legacyId, role: "teacher" });
  const foreign = await createFixtureRouteLoader(db, outsider)(
    "src/app/api/teacher/grades/scores/bulk/route.ts"
  ).POST(req("/api/teacher/grades/scores/bulk", {
    evaluation_id: evaluation.id, items: [{ student_id: pupil0, score: 3 }],
  }));
  assert.ok([403, 423].includes(foreign.status), "a different teacher cannot change the published note");
  assert.equal(db.tables.student_grades.find(row =>
    row.evaluation_id === evaluation.id && row.student_id === pupil0)?.score, 9.5);
});

test("French-only primary teachers also save corrections directly into the bulletin", async () => {
  const db = setup("CP1", false);
  const evaluation = await create(db, "DEC", "french");
  const row = db.tables.grade_evaluations.find(item => item.id === evaluation.id);
  row.is_published = true;
  row.publication_status = "published";
  const attempt = await db.teacher("src/app/api/teacher/grades/scores/bulk/route.ts")
    .POST(req("/api/teacher/grades/scores/bulk", {
      evaluation_id: evaluation.id, items: [{ student_id: pupil0, score: 3 }],
    }));
  assert.equal(attempt.status, 200, JSON.stringify(await attempt.clone().json()));
  assert.equal((await attempt.json()).publication?.is_published, true);
  assert.equal(db.tables.grade_published_scores.find(score => score.is_current)?.score, 3);
});


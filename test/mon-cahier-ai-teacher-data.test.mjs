import assert from "node:assert/strict";
import test from "node:test";
import { harness, institution, year, classes } from "./helpers/mon-cahier-ai-fixture.mjs";
const schoolClass = classes[0];
const question = { classe: null, niveau: null, enseignant: null, discipline: null, jours: 7 };
const readTeachers = harness().load("src/lib/mon-cahier-ai/teacher-data.ts").readTeachers;
const summarizeBulletin = harness().load("src/lib/mon-cahier-ai/official-bulletin.ts").summarizeBulletin;
function database(tables) { const app = harness({ tables }); return { db: app.db, calls: app.calls }; }

function teacherHarness() {
  const { db, calls } = database({
    user_roles: [
      { profile_id: "t1", institution_id: institution, role: "teacher" }, { profile_id: "t2", institution_id: institution, role: "teacher" },
      { profile_id: "foreign", institution_id: "school-b", role: "teacher" },
    ],
    profiles: [{ id: "t1", display_name: "Kouadio Alain" }, { id: "t2", display_name: "Kouadio Paul" }, { id: "foreign", display_name: "Étranger" }],
    class_teachers: [
      { id: "1", institution_id: institution, teacher_id: "t1", class_id: "a3", subject_id: "math", end_date: null, instsub: { subj: { name: "Mathématiques" } } },
      { id: "2", institution_id: institution, teacher_id: "t2", class_id: "old", subject_id: "math", end_date: null, instsub: { subj: { name: "Mathématiques" } } },
    ],
    teacher_timetables: [{ id: "slot", institution_id: institution, teacher_id: "t1", class_id: "a3", weekday: 1, period_id: "p1" }],
    institution_periods: [{ id: "p1", institution_id: institution, start_time: "07:15", end_time: "08:10" }],
    teacher_sessions: [
      { id: "current", institution_id: institution, teacher_id: "t1", class_id: "a3", started_at: "2026-10-16T08:00:00Z", actual_call_at: null, ended_at: null },
      { id: "old-class", institution_id: institution, teacher_id: "t1", class_id: "old", started_at: "2026-10-16T08:00:00Z", actual_call_at: "2026-10-16T08:05:00Z" },
      { id: "old-day", institution_id: institution, teacher_id: "t1", class_id: "a3", started_at: "2026-10-14T08:00:00Z", actual_call_at: "2026-10-14T08:05:00Z" },
    ], subjects: [],
  });
  return { calls, read: q => readTeachers({ srv: db, institutionId: institution, academicYear: year, referenceDate: "2026-10-16", classes: [schoolClass], question: { ...question, consultation: "enseignants", classe: null, detail: "affectations", ...q } }) };
}
test("teacher questions use authorized current assignments and timetable without contact data", async () => {
  const { read, calls } = teacherHarness();
  const result = await read({ classe: "3e3", discipline: "maths" });
  assert.equal(result.enseignants_correspondants, 1);
  assert.equal(result.enseignants[0].nom, "Kouadio Alain");
  assert.deepEqual(result.enseignants[0].affectations, [{ classe: "3e3", discipline: "Mathématiques" }]);
  assert.equal(result.enseignants[0].creneaux_programmes[0].debut, "07:15");
  assert.ok(calls.every(c => !/email|phone|telephone/.test(c.columns || "")));
  assert.ok(!calls.some(c => c.table === "teacher_sessions"));
});
test("ambiguous teacher names ask for clarification instead of selecting an arbitrary person", async () => {
  const { read } = teacherHarness(); const result = await read({ enseignant: "M. Kouadio" });
  assert.match(result.precision_necessaire, /Plusieurs/); assert.equal(result.noms.length, 2);
});
test("teacher activity separates started sessions from timestamped calls and excludes other classes or days", async () => {
  const { read } = teacherHarness(); const result = await read({ enseignant: "Kouadio Alain", detail: "appels", jours: 1 });
  assert.equal(result.enseignants[0].activite.seances_demarrees, 1);
  assert.equal(result.enseignants[0].activite.appels_horodates, 0);
  assert.match(result.limite, /ne prouve pas une absence/);
});


test("official facts reject empty placeholder zeros and never send names or predicted success to the model", () => {
  const result = summarizeBulletin({ ok: true, items: [
    { student_id: "empty", full_name: "PRIVATE-A", general_avg: 0, general_avg_status: "empty", coverage: { has_academic_grade: false } },
    { student_id: "zero", full_name: "PRIVATE-B", general_avg: 0, coverage_is_complete: true },
    { student_id: "partial", full_name: "PRIVATE-C", general_avg: 12, coverage_is_complete: false },
  ] }, schoolClass);
  assert.equal(result.facts.moyennes_disponibles, 2);
  assert.equal(result.facts.eleves_sans_moyenne, 1);
  assert.equal(result.facts.moyenne_des_moyennes_disponibles_sur_20, 6);
  assert.equal(result.facts.moyennes_avec_matieres_manquantes, 1);
  assert.equal(result.follow[0].general_avg_20, 0);
  assert.equal(result.follow[0].p_success, null);
  assert.doesNotMatch(JSON.stringify(result.facts), /PRIVATE|student_id|p_success/);
});

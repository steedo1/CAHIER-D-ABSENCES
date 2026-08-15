import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("LOT3B Cloud: le push relais accepte student_grade sans dépendre de l'emploi du temps", async () => {
  const cloud = await read("src/lib/relay-cloud-sync.ts");

  assert.match(cloud, /operation\.entity_type === "student_grade"/);
  assert.match(cloud, /async function applyStudentGrade/);
  assert.match(cloud, /classDeviceMayAccessClass/);
  assert.match(cloud, /\.from\("class_teachers"\)/);
  assert.match(cloud, /\.from\("class_enrollments"\)/);
  assert.match(cloud, /\.from\("grade_periods"\)/);
  assert.match(cloud, /\.from\("grade_evaluation_locks"\)/);
  assert.match(cloud, /\.from\("student_grades"\)/);

  const start = cloud.indexOf("async function applyStudentGrade");
  const end = cloud.indexOf("async function applyOperation", start);
  const gradeSlice = cloud.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(gradeSlice, /teacher_timetables/);
  assert.doesNotMatch(gradeSlice, /period_id.*timetable/i);
});

test("LOT3B Cloud: identité et portée de l'opération sont vérifiées avant l'écriture", async () => {
  const cloud = await read("src/lib/relay-cloud-sync.ts");

  assert.match(cloud, /grade_actor_kind_mismatch/);
  assert.match(cloud, /grade_institution_mismatch/);
  assert.match(cloud, /student_grade_evaluation_mismatch/);
  assert.match(cloud, /student_grade_period_mismatch/);
  assert.match(cloud, /student_grade_identity_conflict/);
  assert.match(cloud, /operation_id_reused_with_different_payload/);
});


test("LOT3B Cloud: une evaluation legacy est comparee avec la matiere d'etablissement normalisee", async () => {
  const cloud = await read("src/lib/relay-cloud-sync.ts");

  assert.match(cloud, /async function relayGradeSubjectId/);
  assert.match(cloud, /\.from\("institution_subjects"\)/);
  assert.match(cloud, /grade_subject_scope_lookup_failed/);
  assert.match(cloud, /grade_subject_scope_ambiguous/);
  assert.match(cloud, /relay_subject_id: await relayGradeSubjectId/);

  const actorStart = cloud.indexOf("async function assertRelayGradeActor");
  const actorEnd = cloud.indexOf("async function assertRelayGradeEditable", actorStart);
  const actorSlice = cloud.slice(actorStart, actorEnd);
  assert.ok(actorStart >= 0 && actorEnd > actorStart);
  assert.match(actorSlice, /evaluation\.relay_subject_id \|\| evaluation\.subject_id/);

  const gradeStart = cloud.indexOf("async function applyStudentGrade");
  const gradeEnd = cloud.indexOf("async function applyOperation", gradeStart);
  const gradeSlice = cloud.slice(gradeStart, gradeEnd);
  assert.ok(gradeStart >= 0 && gradeEnd > gradeStart);
  assert.match(gradeSlice, /evaluation\.relay_subject_id \|\| evaluation\.subject_id/);
});

test("LOT3B LAN: l'API d'écriture et la capacité dédiée sont exposées", async () => {
  const [server, contract] = await Promise.all([
    read("desktop/relay/src/server.mts"),
    read("desktop/relay/src/schedule-contract.mts"),
  ]);

  assert.match(server, /\/v1\/grades\/score-operations/);
  assert.match(server, /secureGradeScoreOperation/);
  assert.match(contract, /grades_score_write_v1:\s*true/);
});

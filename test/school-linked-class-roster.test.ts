import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Fixture utility is deliberately JavaScript-only.
import { createMulticycleFixture } from "./helpers/multicycle-fixture.mjs";
import { loadLinkedClassEnrollments } from "../src/lib/server/school-linked-class-roster";

const french = "11111111-1111-4111-8111-111111111111";
const arabic = "22222222-2222-4222-8222-222222222222";
const wrong = "33333333-3333-4333-8333-333333333333";
const valid = "44444444-4444-4444-8444-444444444444";
const removed = "55555555-5555-4555-8555-555555555555";
const different = "66666666-6666-4666-8666-666666666666";

test("a stale Arabic CP2 link never hides valid pupils or creates another enrollment", async () => {
  const db = createMulticycleFixture();
  const settings = db.tables.institutions[0].settings_json;
  settings.school_cycles_v1 = {
    enabled: true, version: 1, enabledCycles: ["primary"],
    teachingTracksByCycle: { primary: ["french", "arabic"] },
    classCycleById: {}, subjectTracksByCycle: {}, defaultView: "all",
  };
  settings.school_student_programs_v1 = { version: 1, years: {
    "2026-2027": { classes: {
      [french]: { tracks: ["french"], students: {} },
      [arabic]: { tracks: ["arabic"], students: {},
        linkedStudentIds: [valid, removed, different] },
      [wrong]: { tracks: ["french"], students: {} },
    } },
  } };
  for (const [id, label, level] of [
    [french, "CP2 — Français", "CP2"], [arabic, "CP2 — Arabe", "CP2"],
    [wrong, "CE1 — Français", "CE1"],
  ]) db.tables.classes.push({ id, label, level,
    academic_year: "2026-2027", institution_id: db.legacyId });
  db.tables.students ||= [];
  for (const id of [valid, different]) db.tables.students.push({
    id, institution_id: db.legacyId, first_name: "Pupil", last_name: "Test",
    full_name: "Pupil Test", matricule: id,
  });
  for (const [id, classId] of [[valid, french], [different, wrong]]) {
    db.tables.class_enrollments.push({
      id: "enrol-" + id, student_id: id, class_id: classId,
      institution_id: db.legacyId, start_date: "2026-09-14", end_date: null,
    });
  }
  const before = db.tables.class_enrollments.length;
  const rows = await loadLinkedClassEnrollments(db.service, db.legacyId, {
    id: arabic, academic_year: "2026-2027", level: "CP2",
  }, settings);
  assert.deepEqual(rows.map(row => row.student_id), [valid]);
  assert.equal(db.tables.class_enrollments.length, before);
  assert.equal(db.calls.every((call: { op: string }) => call.op === "read"), true);
});

test("a stale-only Arabic class yields an empty roster without inventing pupils", async () => {
  const db = createMulticycleFixture();
  const settings = db.tables.institutions[0].settings_json;
  settings.school_cycles_v1 = { version: 1, enabled: true, enabledCycles: ["primary"],
    teachingTracksByCycle: { primary: ["french", "arabic"] } };
  settings.school_student_programs_v1 = { version: 1, years: {
    "2026-2027": { classes: { [arabic]: {
      tracks: ["arabic"], students: {}, linkedStudentIds: [removed],
    } } },
  } };
  const roster = await loadLinkedClassEnrollments(db.service, db.legacyId, {
    id: arabic, level: "CP2", academic_year: "2026-2027",
  }, settings);
  assert.deepEqual(roster, []);
  assert.equal(db.tables.class_enrollments.length, 0);
});

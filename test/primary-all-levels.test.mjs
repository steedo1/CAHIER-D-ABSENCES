import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createPedagogicalFixture } from "./helpers/pedagogical-fixture.mjs";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { inferSchoolCycleFromLevel, parseSchoolCyclesSettings,
  resolveSchoolCycleForClass } from "../src/lib/school-cycles.ts";
import { parseFrancoArabicReportsSettings,
  getConfiguredScoringScale } from "../src/lib/franco-arabic-reporting.ts";
import { resolvePrimaryTeachingTrack,
  encodePrimaryEvaluation, isPrimaryComposition } from "../src/lib/grades/primary-evaluation-kind.ts";

const LEVELS = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"];
const FRENCH = "11111111-1111-4111-8111-111111111111";
const ARABIC = "22222222-2222-4222-8222-222222222222";
const CLASS_ID = "33333333-3333-4333-8333-333333333333";
const PATH = "src/app/api/admin/grades/bulletin/route.ts";
const url = () => new NextRequest(`https://example.invalid/api/admin/grades/bulletin?class_id=${CLASS_ID}&from=2026-09-01&to=2026-12-15&academic_year=2026-2027`);

for (const level of LEVELS) {
  test(`tout le primaire ${level} : enseignants français et arabe, compositions et bulletin indépendants`, async () => {
    const db = createPedagogicalFixture();
    const settings = db.tables.institutions[0].settings_json;
    db.tables.classes[0].level = level;
    for (const entry of settings.franco_arabic_reports_v1.scales) entry.level = level;
    for (const entry of db.tables.institution_subject_coeffs) entry.level = level;
    for (const entry of db.tables.institution_level_subjects) entry.level_code = level;

    const school = parseSchoolCyclesSettings(settings);
    const reporting = parseFrancoArabicReportsSettings(settings);
    assert.equal(inferSchoolCycleFromLevel(level), "primary");
    assert.equal(resolveSchoolCycleForClass(db.tables.classes[0], school), "primary");
    assert.equal(getConfiguredScoringScale(reporting, "primary", level, "french"), 10);
    assert.equal(getConfiguredScoringScale(reporting, "primary", level, "arabic"), 20);

    // The same class offers BOTH teachings; it is the teacher's assigned
    // subject, never a guessed class language, that resolves the programme.
    const classTracks = ["french", "arabic"];
    assert.equal(resolvePrimaryTeachingTrack({
      offeredTracks: classTracks, classTracks,
      subjectTracks: school.subjectTracksByCycle.primary[FRENCH],
    }), "french");
    assert.equal(resolvePrimaryTeachingTrack({
      offeredTracks: classTracks, classTracks,
      subjectTracks: school.subjectTracksByCycle.primary[ARABIC],
    }), "arabic");
    assert.equal(resolvePrimaryTeachingTrack({
      offeredTracks: classTracks, classTracks, subjectTracks: undefined,
    }), null);

    // Old written interrogations must not become official compositions.
    assert.equal(isPrimaryComposition({eval_kind:"interro_ecrite", title:"Interrogation écrite"}), false);
    assert.equal(isPrimaryComposition(encodePrimaryEvaluation("composition")), true);

    // Ignore extra published homework even if it carries a high score.
    for (const [id, subject_id] of [["extra-homework-fr", FRENCH], ["extra-homework-ar", ARABIC]]) {
      db.tables.grade_evaluations.push({
        ...db.tables.grade_evaluations.find(item => item.subject_id === subject_id),
        id, eval_kind: "devoir", title: "Devoir", is_published: true,
      });
      db.tables.grade_published_scores.push({
        ...db.tables.grade_published_scores.find(row => row.subject_id === subject_id),
        id: "score-" + id, evaluation_id: id, score: subject_id === FRENCH ? 10 : 20,
      });
    }
    const response = await createFixtureRouteLoader(db, db.legacyAdminId)(PATH).GET(url());
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const result = (await response.json()).specialized;
    assert.equal(result.cycle, "primary");
    assert.deepEqual(result.programs, ["french", "arabic"]);
    assert.equal(result.documents.length, 2);
    const first = result.documents[0];
    assert.equal(first.document.french.generalAverage, 8, "French homework must not affect composition");
    assert.equal(first.document.arabic.generalAverage, 12, "Arabic homework must not affect composition");
    // Only a scored subject is printed on the primary document; there must be
    // no blank phantom rows, while grading catalogs remain unchanged.
    assert.ok(first.document.french.subjects.length > 0);
    assert.ok(first.document.arabic.subjects.length > 0);
    assert.ok(first.document.french.subjects.every(row => row.average !== null));
    assert.ok(first.document.arabic.subjects.every(row => row.average !== null));
    assert.equal(first.programReadiness.french, true);
    assert.equal(first.programReadiness.arabic, true);
    assert.equal(first.document.french.rank, 1);
    assert.equal(first.document.arabic.rank, 1);
    assert.equal(db.calls.some(call => call.op !== "read"), false);
  });
}

test("class/subject teaching resolution rejects ambiguous and cross-program assignments", () => {
  const both = ["french", "arabic"];
  assert.equal(resolvePrimaryTeachingTrack({
    offeredTracks: both, classTracks: both, subjectTracks: both,
  }), null);
  assert.equal(resolvePrimaryTeachingTrack({
    offeredTracks: both, classTracks: ["french"], subjectTracks: ["arabic"],
  }), null);
  assert.equal(resolvePrimaryTeachingTrack({
    offeredTracks: both, classTracks: ["arabic"], subjectTracks: undefined,
  }), "arabic");
});

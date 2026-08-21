import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCouncilYearDecisionUpsert,
  COUNCIL_YEAR_DECISION_CONTRACT,
  readCouncilYearDecision,
} from "../src/lib/end-of-year-decisions.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const baseInput = {
  student_id: "11111111-1111-4111-8111-111111111111",
  institution_id: "22222222-2222-4222-8222-222222222222",
  academic_year: "2026-2027",
  class_id: "33333333-3333-4333-8333-333333333333",
  annual_rank: 27,
  author_id: "44444444-4444-4444-8444-444444444444",
  recorded_at: "2027-06-30T18:30:00.000Z",
  period: {
    id: "55555555-5555-4555-8555-555555555555",
    code: "T3",
    from: "2027-04-01",
    to: "2027-06-30",
    is_last: true,
  },
};

test("P2.3B stockage: student_year_decisions conserve proposition, dérogation et audit", () => {
  const built = buildCouncilYearDecisionUpsert({
    ...baseInput,
    annual_average: 9.8,
    council_decision: "ADMIS",
    reason: "Avis favorable unanime du conseil.",
    state: "validated",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  assert.equal(built.payload.decision_label, "ADMIS");
  assert.equal(built.payload.decision_type, "admitted");
  assert.equal(built.payload.is_repeater_next_year, false);
  assert.equal(built.payload.decided_by, baseInput.author_id);
  assert.equal(built.payload.decided_at, baseInput.recorded_at);
  assert.equal(built.payload.notes, "Avis favorable unanime du conseil.");
  assert.equal(built.payload.metadata_json.contract, COUNCIL_YEAR_DECISION_CONTRACT);
  assert.equal(built.payload.metadata_json.automatic_proposal, "REDOUBLE");
  assert.equal(built.payload.metadata_json.council_decision, "ADMIS");
  assert.equal(built.payload.metadata_json.official_decision, "ADMIS");
  assert.equal(built.payload.metadata_json.annual_average_used, 9.8);
  assert.equal(built.payload.metadata_json.base_annual_average, 9.8);
  assert.equal(built.payload.metadata_json.council_adjustment, 0.2);
  assert.equal(built.payload.metadata_json.official_annual_average, 10);
  assert.equal(built.payload.metadata_json.is_derogation, true);
  assert.equal(built.payload.metadata_json.annual_rank_used, baseInput.annual_rank);
  assert.equal("annual_rank" in built.payload, false);
});

test("P2.3B stockage: un brouillon n'est jamais officiel", () => {
  const built = buildCouncilYearDecisionUpsert({
    ...baseInput,
    annual_average: 10.15,
    council_decision: "REDOUBLE",
    reason: "Décision à confirmer.",
    state: "draft",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.payload.decision_label, "ADMIS");
  assert.equal(built.payload.decided_by, null);
  assert.equal(built.payload.decided_at, null);
  assert.equal(built.payload.metadata_json.council_adjustment, 0);
  assert.equal(built.payload.metadata_json.official_annual_average, 10.15);

  const read = readCouncilYearDecision(
    {
      id: "decision-a",
      student_id: baseInput.student_id,
      notes: built.payload.notes,
      metadata_json: built.payload.metadata_json,
      updated_at: baseInput.recorded_at,
    },
    10.15,
  );
  assert.equal(read.council_decision, "REDOUBLE");
  assert.equal(read.council_state, "draft");
  assert.equal(read.official_decision, "ADMIS");
  assert.equal(read.official_source, "automatic");
  assert.equal(read.official_annual_average, 10.15);
});

test("P2.3B stockage: le repêchage en brouillon n'altère pas la moyenne officielle", () => {
  const built = buildCouncilYearDecisionUpsert({
    ...baseInput,
    annual_average: 9.8,
    council_decision: "ADMIS",
    reason: "Avis en cours de validation.",
    state: "draft",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.payload.metadata_json.council_adjustment, 0.2);
  assert.equal(built.payload.metadata_json.official_annual_average, 9.8);
  assert.equal(built.payload.metadata_json.state, "draft");
  assert.equal(built.payload.decided_by, null);
  assert.equal(built.payload.decided_at, null);
});

test("P2.3B stockage: une dérogation divergente sans motif est refusée", () => {
  const built = buildCouncilYearDecisionUpsert({
    ...baseInput,
    annual_average: 9.8,
    council_decision: "ADMIS",
    reason: "",
    state: "validated",
  });
  assert.equal(built.ok, false);
  assert.equal(built.error, "MOTIVE_REQUIRED");
  assert.equal(built.payload, null);
});

test("P2.3B stockage: revenir à la proposition retire la dérogation", () => {
  const built = buildCouncilYearDecisionUpsert({
    ...baseInput,
    annual_average: 9.8,
    council_decision: "REDOUBLE",
    reason: "",
    state: "validated",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.payload.metadata_json.is_derogation, false);

  const read = readCouncilYearDecision(
    {
      id: "decision-clear",
      student_id: baseInput.student_id,
      metadata_json: built.payload.metadata_json,
    },
    9.8,
  );
  assert.equal(read.council_decision, null);
  assert.equal(read.official_decision, "REDOUBLE");
  assert.equal(read.official_source, "automatic");
  assert.equal(read.council_adjustment, 0);
  assert.equal(read.official_annual_average, 9.8);
});

test("P2.3B stockage: 9.99 est repêché exactement à 10.00", () => {
  const built = buildCouncilYearDecisionUpsert({
    ...baseInput,
    annual_average: 9.99,
    council_decision: "ADMIS",
    reason: "Repêchage validé.",
    state: "validated",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;

  assert.equal(built.payload.metadata_json.base_annual_average, 9.99);
  assert.equal(built.payload.metadata_json.automatic_proposal, "REDOUBLE");
  assert.equal(built.payload.metadata_json.council_adjustment, 0.01);
  assert.equal(built.payload.metadata_json.official_annual_average, 10);

  const read = readCouncilYearDecision(
    {
      id: "decision-999",
      student_id: baseInput.student_id,
      metadata_json: built.payload.metadata_json,
      decided_by: baseInput.author_id,
      decided_at: baseInput.recorded_at,
    },
    8.5,
  );
  assert.equal(read.base_annual_average, 9.99);
  assert.equal(read.council_adjustment, 0.01);
  assert.equal(read.official_annual_average, 10);
  assert.equal(read.official_decision, "ADMIS");
  assert.equal(read.author_id, baseInput.author_id);
});

test("P2.3B API: isolation école/classe, dernière période et stockage existant", async () => {
  const route = await source(
    "src/app/api/admin/notes/conseil-classe/year-decisions/route.ts",
  );
  assert.match(route, /\.eq\("institution_id", scope\.institutionId\)/);
  assert.match(route, /String\(classRow\.institution_id \|\| ""\) !== input\.institutionId/);
  assert.match(route, /\.eq\("current_class_id", scope\.classId\)/);
  assert.match(route, /\.eq\("class_id", scope\.classId\)/);
  assert.match(route, /"NOT_LAST_PERIOD"/);
  assert.match(route, /"VALIDATED_STATE_REQUIRED"/);
  assert.match(route, /MAX_DECISIONS_PER_REQUEST = 200/);
  assert.match(route, /student_year_decisions/);
  assert.doesNotMatch(route, /attendance_marks|attendance_call|teacher_sessions/);
});

test("P2.3B UI: section fin d'année, distinction séparée et bulletin officiel aligné", async () => {
  const [council, bulletinPage, activeBulletinPage, bulletinRoute] = await Promise.all([
    source("src/app/admin/notes/conseil-classe/page.tsx"),
    source("src/app/admin/notes/bulletins/page.tsx"),
    source("src/app/admin/bulletins/page.tsx"),
    source("src/app/api/admin/grades/bulletin/route.ts"),
  ]);

  assert.match(council, /isLastSelectedPeriod && annualDecisionRows\.length > 0/);
  assert.match(council, /Décisions de fin d’année/);
  assert.match(council, /Proposition Mon Cahier/);
  assert.match(council, /Moyenne annuelle calculée/);
  assert.match(council, /Ajustement Conseil/);
  assert.match(council, /Moyenne annuelle officielle/);
  assert.match(council, /Brouillon — non officiel/);
  assert.match(council, /Distinction annuelle/);
  assert.match(council, /row\.conductOn20/);
  assert.match(council, /row\.annual_avg/);
  assert.match(council, /row\.annual_rank/);
  assert.doesNotMatch(council, /annualDecisionLabel/);

  assert.match(bulletinRoute, /attachOfficialEndOfYearDecisions/);
  assert.match(bulletinRoute, /student_year_decisions/);
  assert.match(bulletinRoute, /item\.annual_avg = decision\.official_annual_average/);
  assert.match(bulletinPage, /item\.end_of_year_decision\?\.official_decision/);
  assert.match(bulletinPage, /proposeEndOfYearDecision\(annualAvgOn20\)/);
  assert.match(bulletinPage, /Moyenne annuelle officielle/);
  assert.match(activeBulletinPage, /item\.end_of_year_decision\?\.official_source === "council"/);
  assert.match(activeBulletinPage, /Moyenne annuelle officielle/);
});

test("P2.3B non-régression: aucune migration ou mutation Attendance ajoutée", async () => {
  const [engine, adapter, route] = await Promise.all([
    source("packages/academic-engine/src/index.mjs"),
    source("src/lib/end-of-year-decisions.mjs"),
    source("src/app/api/admin/notes/conseil-classe/year-decisions/route.ts"),
  ]);
  const combined = `${engine}\n${adapter}\n${route}`;
  assert.doesNotMatch(combined, /absence_minutes\s*\/\s*60/);
  assert.doesNotMatch(combined, /from\(["']student_grades["']\).*\.(insert|update|upsert|delete)/s);
  assert.doesNotMatch(combined, /attendance-operations|teacher_sessions|attendance_call/);
  assert.doesNotMatch(combined, /local_dirty/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateAnnualAverage,
  calculateClassicConduct,
  calculateCompositeConduct,
  calculateCouncilMentions,
  calculateGeneralAverage,
  calculateSubjectAverage,
  canManageEndOfYearDecision,
  competitionRanks,
  denseRanks,
  normalizeScoreTo20,
  proposeEndOfYearDecision,
  resolveEndOfYearDecision,
} from "../packages/academic-engine/src/index.mjs";
import { goldenFixtures } from "../packages/academic-engine/test/golden-fixtures.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("P2.3 caractérisation: les golden restent ancrés aux implémentations Cloud actuelles", async () => {
  const [averages, teacherAverages, bulletin, conduct, council] = await Promise.all([
    source("src/app/api/grades/averages/route.ts"),
    source("src/app/api/teacher/grades/averages/route.ts"),
    source("src/app/api/admin/grades/bulletin/route.ts"),
    source("src/app/api/admin/conduite/averages/route.ts"),
    source("src/app/admin/notes/conseil-classe/page.tsx"),
  ]);

  for (const current of [averages, teacherAverages]) {
    assert.match(current, /const normalized = \(score \/ scale\) \* 20/);
    assert.match(current, /const useComponentModel[\s\S]+componentCoeffMap\.size > 0/);
    assert.match(current, /const ranks = denseRanks\(rows\.map\(sortKey\)\)/);
    assert.match(current, /const afterBonus = clamp\(avg20 \+ b, 0, 20\)/);
  }
  assert.match(bulletin, /general_avg = sumCoeffGen > 0 \? cleanNumber\(sumGen \/ sumCoeffGen, 4\) : null/);
  assert.match(bulletin, /sum \+= avg \* pm\.w/);
  assert.match(bulletin, /currentRank = position/);
  assert.match(conduct, /assRules\.lateness_points_per_late \* tardyCount/);
  assert.match(conduct, /applyInstitutionConductPolicyToStudent/);
  assert.match(council, /const felicitationMin = isCsca \? 15 : 14/);
  assert.match(council, /if \(ratio <= 0\.4\) sanction = "blameConduct"/);
});

test("P2.3 golden: score /20, toutes les notes et coefficients multiples", () => {
  assert.equal(normalizeScoreTo20(8, 10), 16);
  assert.deepEqual(
    calculateSubjectAverage(goldenFixtures.complete_weighted_subject.input),
    goldenFixtures.complete_weighted_subject.expected,
  );
});

test("P2.3 golden: note manquante partielle et absence de note NC", () => {
  assert.deepEqual(
    calculateSubjectAverage(goldenFixtures.missing_and_nc.partial_input),
    goldenFixtures.missing_and_nc.partial_expected,
  );
  assert.deepEqual(
    calculateSubjectAverage(goldenFixtures.missing_and_nc.nc_input),
    goldenFixtures.missing_and_nc.nc_expected,
  );
});

test("P2.3 golden: composantes à deux étages", () => {
  assert.deepEqual(
    calculateSubjectAverage(goldenFixtures.components.input),
    goldenFixtures.components.expected,
  );
});

test("P2.3 golden: ajustement borné et matière non classante", () => {
  assert.deepEqual(
    calculateSubjectAverage(
      goldenFixtures.adjustment_and_non_ranking_subject.adjusted_subject_input,
    ),
    goldenFixtures.adjustment_and_non_ranking_subject.adjusted_subject_expected,
  );
  assert.deepEqual(
    calculateGeneralAverage(
      goldenFixtures.adjustment_and_non_ranking_subject.general_input,
    ),
    goldenFixtures.adjustment_and_non_ranking_subject.general_expected,
  );
});

test("P2.3 golden: égalité de rang — compétition et dense restent explicitement distincts", () => {
  assert.deepEqual(
    competitionRanks(goldenFixtures.rank_tie.input),
    goldenFixtures.rank_tie.competition_expected,
  );
  assert.deepEqual(
    denseRanks(goldenFixtures.rank_tie.input),
    goldenFixtures.rank_tie.dense_expected,
  );
});

test("P2.3 golden: conduite classique et conduite composite", () => {
  assert.deepEqual(
    calculateClassicConduct(goldenFixtures.conduct.classic_input),
    goldenFixtures.conduct.classic_expected,
  );
  assert.equal(
    calculateCompositeConduct(goldenFixtures.conduct.composite_input),
    goldenFixtures.conduct.composite_expected,
  );

  const withComplementaryMinutes = calculateClassicConduct({
    ...goldenFixtures.conduct.classic_input,
    absence_minutes: 360,
  });
  assert.deepEqual(
    withComplementaryMinutes,
    goldenFixtures.conduct.classic_expected,
    "absence_minutes reste complémentaire; absence_count demeure l'unité métier",
  );
});

test("P2.3 golden: cas annuel pondéré et partiel", () => {
  assert.deepEqual(
    calculateAnnualAverage(goldenFixtures.annual.input),
    goldenFixtures.annual.expected,
  );
});

test("P2.3B golden: proposition automatique de fin d'année", () => {
  for (const fixture of goldenFixtures.end_of_year_decisions.automatic) {
    assert.equal(
      proposeEndOfYearDecision(fixture.annual_average),
      fixture.expected,
    );
  }
  assert.equal(
    canManageEndOfYearDecision({ is_last_period: false, annual_average: 15 }),
    false,
  );
  assert.equal(
    canManageEndOfYearDecision({ is_last_period: true, annual_average: null }),
    false,
  );
  assert.equal(
    canManageEndOfYearDecision({ is_last_period: true, annual_average: 15 }),
    true,
  );
});

test("P2.3B golden: décision et repêchage annuel officiel", () => {
  for (const fixture of goldenFixtures.end_of_year_decisions.overrides) {
    const result = resolveEndOfYearDecision(fixture);
    assert.equal(result.ok, true);
    assert.equal(result.official_decision, fixture.expected_official);
    assert.equal(result.base_annual_average, fixture.annual_average);
    assert.equal(result.council_adjustment, fixture.expected_adjustment);
    assert.equal(
      result.official_annual_average,
      fixture.expected_official_average,
    );
    assert.equal(result.override_applied, fixture.expected_override_applied);
  }

  const automatic = resolveEndOfYearDecision({ annual_average: 9.8 });
  assert.equal(automatic.official_decision, "REDOUBLE");
  assert.equal(automatic.official_source, "automatic");
  assert.equal(automatic.council_adjustment, 0);
  assert.equal(automatic.official_annual_average, 9.8);

  const refused = resolveEndOfYearDecision({
    annual_average: 9.8,
    council_override: { decision: "ADMIS", reason: "", state: "validated" },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "MOTIVE_REQUIRED");
  assert.equal(refused.official_decision, "REDOUBLE");
  assert.equal(refused.council_adjustment, 0);
  assert.equal(refused.official_annual_average, 9.8);
});

test("P2.3 golden: mentions de conseil actuelles", () => {
  assert.deepEqual(
    calculateCouncilMentions(goldenFixtures.council_mentions.input),
    goldenFixtures.council_mentions.expected,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildPreschoolBooklet, type PreschoolObservation } from "../src/lib/preschool-assessments";
const competencies = [{ id: "competency", label: "Compétence validée par l’école", domain: "Domaine validé" }];
const observation: PreschoolObservation = { studentId: "one", periodId: "period", track: "arabic",
  competencyId: "competency", attainment: "developing", observation: "Observation pédagogique fictive." };
test("preschool booklets use observations without scores, coefficients, rank or averages", () => {
  const result = buildPreschoolBooklet({ studentId: "one", periodId: "period", track: "arabic", competencies, observations: [observation] });
  assert.equal(result.competencies[0].attainment, "developing");
  for (const key of ["generalAverage", "combinedAverage", "rank", "coefficient", "score"]) assert.equal(key in result, false);
});
test("one administrative identity can have two separate preschool program booklets", () => {
  const result = buildPreschoolBooklet({ studentId: "one", periodId: "period", track: "french", competencies,
    observations: [observation, { ...observation, studentId: "foreign" }, { ...observation, periodId: "old" }] });
  assert.equal(result.competencies[0].attainment, "not_observed");
  assert.equal(result.competencies[0].observation, "");
});
test("duplicate observations and missing catalogs require correction", () => {
  assert.equal(buildPreschoolBooklet({ studentId: "one", periodId: "period", track: "arabic", competencies, observations: [observation, observation] }).status, "invalid");
  assert.equal(buildPreschoolBooklet({ studentId: "one", periodId: "period", track: "arabic", competencies: [], observations: [] }).status, "invalid");
});

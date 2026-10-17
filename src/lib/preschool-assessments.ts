import type { TeachingTrack } from "./school-cycles";

/** No numeric score, coefficient, class rank or average in a preschool booklet. */
export const PRESCHOOL_ATTAINMENT = ["not_observed", "emerging", "developing", "acquired"] as const;
export type PreschoolAttainment = typeof PRESCHOOL_ATTAINMENT[number];
export type PreschoolCompetency = { id: string; label: string; domain: string };
export type PreschoolObservation = {
  studentId: string; periodId: string; track: TeachingTrack;
  competencyId: string; attainment: PreschoolAttainment; observation: string;
};

/** Pure preparation only. The school supplies the validated competency catalog. */
export function buildPreschoolBooklet(input: {
  studentId: string; periodId: string; track: TeachingTrack;
  competencies: readonly PreschoolCompetency[];
  observations: readonly PreschoolObservation[];
}) {
  const problems: string[] = [];
  const catalog = new Map<string, PreschoolCompetency>();
  for (const competency of input.competencies) {
    if (!competency.id || !competency.label.trim() || !competency.domain.trim() || catalog.has(competency.id)) {
      problems.push("invalid_or_duplicate_competency");
    } else catalog.set(competency.id, competency);
  }
  if (!catalog.size) problems.push("competency_catalog_required");
  if (!input.studentId || !input.periodId) problems.push("student_and_period_required");
  const observations = new Map<string, PreschoolObservation>();
  for (const observation of input.observations) {
    if (observation.studentId !== input.studentId || observation.periodId !== input.periodId || observation.track !== input.track) continue;
    if (!catalog.has(observation.competencyId) || !PRESCHOOL_ATTAINMENT.includes(observation.attainment) ||
      typeof observation.observation !== "string" || observation.observation.length > 2000) {
      problems.push("invalid_observation");
    } else if (observations.has(observation.competencyId)) problems.push("duplicate_competency_observation");
    else observations.set(observation.competencyId, observation);
  }
  return {
    studentId: input.studentId, periodId: input.periodId, track: input.track,
    status: problems.length ? "invalid" as const : "draft" as const,
    competencies: Array.from(catalog.values()).map(competency => ({
      ...competency, attainment: observations.get(competency.id)?.attainment ?? "not_observed",
      observation: observations.get(competency.id)?.observation ?? "",
    })),
    problems: [...new Set(problems)],
  };
}

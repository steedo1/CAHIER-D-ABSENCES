import {
  type SchoolCycle,
  type SchoolCyclesSettings,
  type TeachingTrack,
} from "@/lib/school-cycles";
import {
  getConfiguredScoringScale,
  getConfiguredSubjectCoefficients,
  type FrancoArabicReportsSettings,
} from "@/lib/franco-arabic-reporting";

/**
 * Read-only calculation contract for a future franco-Arabic bulletin engine.
 * The caller MUST have verified the user and queried grades by institution,
 * academic year, student, class and authorized teaching scope on the server.
 *
 * This does not replace the production grade or bulletin rules and MUST NOT be
 * plugged into publication before cycle-specific coefficient rules are approved.
 */
export type OfficialEvaluationScore = {
  studentId: string;
  evaluationId: string;
  subjectId: string;
  score: number;
  scale: number;
  evaluationCoefficient: number;
  isCurrentPublished: boolean;
  /** Server-resolved program identity; mandatory for any shared subject. */
  teachingTrack?: TeachingTrack | null;
};

export type SubjectBulletinPolicy = {
  subjectId: string;
  coefficient: number;
  includeInAverage: boolean;
};

export type ProgramSubjectResult = {
  subjectId: string;
  coefficient: number | null;
  includeInAverage: boolean;
  average: number | null;
  evaluatedCount: number;
};

export type ProgramBulletinDraft = {
  studentId: string;
  cycle: SchoolCycle;
  level: string;
  track: TeachingTrack;
  maximumScore: number | null;
  status: "ready" | "incomplete" | "not_configured";
  /** null unless every included subject is entirely configured and scored. */
  generalAverage: number | null;
  subjects: ProgramSubjectResult[];
  problems: string[];
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function strictlyPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function buildProgramBulletinDraft(params: {
  studentId: string;
  cycle: SchoolCycle;
  level: string;
  track: TeachingTrack;
  school: SchoolCyclesSettings;
  reports: FrancoArabicReportsSettings;
  officialScores: readonly OfficialEvaluationScore[];
  /** Resolved on the server from the selected single coefficient authority. */
  resolvedPolicies?: readonly SubjectBulletinPolicy[];
  configurationProblems?: readonly string[];
}): ProgramBulletinDraft {
  const { studentId, cycle, level, track, school, reports, officialScores } = params;
  // Source of coefficient truth: this institution’s validated, program-specific
  // report settings. Do not trust arbitrary client-supplied coefficients.
  const subjectPolicies: readonly SubjectBulletinPolicy[] =
    params.resolvedPolicies ?? getConfiguredSubjectCoefficients(reports, cycle, level, track);
  const problems: string[] = [...(params.configurationProblems || [])];
  const mapped = school.subjectTracksByCycle[cycle] || {};
  // The PRIMARY curriculum can differ between CP1, CP2, CE1, CE2, CM1
  // and CM2. Only a level's explicitly configured subject/coefficient entries
  // belong on its bulletin. A cycle-wide catalog is not the level curriculum.
  const subjectIds = Array.from(
    new Set(subjectPolicies.map(rule => rule.subjectId)),
  ).sort();

  const authorizedConfig = school.enabled &&
    school.enabledCycles.includes(cycle) &&
    school.teachingTracksByCycle[cycle]?.includes(track) &&
    reports.enabled;

  const targetScale = authorizedConfig
    ? getConfiguredScoringScale(reports, cycle, level, track)
    : null;

  if (!authorizedConfig) problems.push("program_not_configured");
  if (authorizedConfig && targetScale === null) problems.push("level_scale_not_configured");
  if (authorizedConfig && subjectIds.length === 0) problems.push("level_subjects_not_configured");
  if (subjectIds.some(subjectId => !mapped[subjectId]?.includes(track))) {
    problems.push("level_subject_not_classified_for_program");
  }
  // Current evaluations do not identify a French/Arabic teaching track.
  // A shared subject cannot be assigned to both bulletins without an explicit
  // link from each evaluation to its program.

  const policiesById = new Map<string, SubjectBulletinPolicy>();
  const duplicatePolicyIds = new Set<string>();
  for (const rule of subjectPolicies) {
    if (policiesById.has(rule.subjectId)) duplicatePolicyIds.add(rule.subjectId);
    else policiesById.set(rule.subjectId, rule);
  }

  // For one bulletin, an official evaluation is unique per student/evaluation.
  // Fail closed on duplicate scores/ambiguous coefficients rather than double
  // counting a versioned publication.
  const selectedBySubject = new Map<string, OfficialEvaluationScore[]>();
  const seen = new Set<string>();
  const duplicateEvaluationIds = new Set<string>();
  const allowed = new Set(subjectIds);
  for (const row of officialScores) {
    if (!row.isCurrentPublished || row.studentId !== studentId || !allowed.has(row.subjectId)) continue;
    if (row.teachingTrack != null && row.teachingTrack !== track) continue;
    if ((mapped[row.subjectId] || []).length > 1 && !row.teachingTrack) {
      problems.push("shared_subject_requires_program_specific_evaluations");
      continue;
    }
    if (!row.evaluationId || !row.subjectId) {
      problems.push("invalid_evaluation_id");
      continue;
    }
    if (seen.has(row.evaluationId)) {
      duplicateEvaluationIds.add(row.evaluationId);
      continue;
    }
    seen.add(row.evaluationId);
    if (!Number.isFinite(row.score) || !strictlyPositive(row.scale) ||
        row.score < 0 || row.score > row.scale ||
        !strictlyPositive(row.evaluationCoefficient)) {
      problems.push("invalid_published_score");
      continue;
    }
    const list = selectedBySubject.get(row.subjectId) || [];
    list.push(row);
    selectedBySubject.set(row.subjectId, list);
  }
  if (duplicateEvaluationIds.size) problems.push("duplicate_published_evaluation");

  const subjects: ProgramSubjectResult[] = [];
  let generalSum = 0;
  let generalCoefficientSum = 0;

  for (const subjectId of subjectIds) {
    const rule = policiesById.get(subjectId);
    if (!rule || duplicatePolicyIds.has(subjectId) ||
        !Number.isFinite(rule.coefficient) || rule.coefficient < 0 ||
        (rule.includeInAverage && rule.coefficient === 0) ||
        typeof rule.includeInAverage !== "boolean") {
      problems.push("subject_policy_missing_or_invalid");
      subjects.push({
        subjectId, coefficient: null, includeInAverage: false,
        average: null, evaluatedCount: 0,
      });
      continue;
    }

    const evaluations = selectedBySubject.get(subjectId) || [];
    const totalEvaluationCoefficient = evaluations.reduce(
      (sum, row) => sum + row.evaluationCoefficient, 0,
    );
    const preciseAverage = targetScale !== null && evaluations.length > 0 &&
      totalEvaluationCoefficient > 0
      ? evaluations.reduce((sum, row) =>
          sum + row.score / row.scale * targetScale * row.evaluationCoefficient, 0,
        ) / totalEvaluationCoefficient
      : null;
    const average = preciseAverage === null ? null : round2(preciseAverage);

    subjects.push({
      subjectId, coefficient: rule.coefficient, includeInAverage: rule.includeInAverage,
      average, evaluatedCount: evaluations.length,
    });
    if (rule.includeInAverage) {
      if (average === null) problems.push("included_subject_without_score");
      else {
        generalSum += (preciseAverage as number) * rule.coefficient;
        generalCoefficientSum += rule.coefficient;
      }
    }
  }

  if (generalCoefficientSum === 0 && authorizedConfig && subjectIds.length > 0) {
    problems.push("no_subject_in_average");
  }

  // Do not infer report readiness merely from a partial set of marks.
  const complete = problems.length === 0 &&
    targetScale !== null && generalCoefficientSum > 0;
  const status: ProgramBulletinDraft["status"] =
    !authorizedConfig ? "not_configured" : complete ? "ready" : "incomplete";

  return {
    studentId, cycle, level, track,
    maximumScore: targetScale,
    status,
    generalAverage: complete ? round2(generalSum / generalCoefficientSum) : null,
    subjects,
    problems: [...new Set(problems)],
  };
}

/**
 * Product rule (confirmed): NEVER mix the French and Arabic averages.
 *
 * A "combined" bulletin is only a common presentation of two INDEPENDENT
 * report cards, not a combined pedagogical result. This applies even if
 * both individual averages use the same /20 scale, and even if a school
 * chooses the "combined" or "both" PDF presentation.
 *
 * Preserve the explicit null field as a backward-compatible guard for
 * future report renderers; do not calculate or show a school-wide mean.
 */
export function combineProgramBulletins(
  french: ProgramBulletinDraft,
  arabic: ProgramBulletinDraft,
) {
  if (french.studentId !== arabic.studentId ||
      french.cycle !== arabic.cycle ||
      french.level !== arabic.level ||
      french.track !== "french" || arabic.track !== "arabic") {
    return null;
  }
  return {
    studentId: french.studentId,
    cycle: french.cycle,
    level: french.level,
    french,
    arabic,
    // Business invariant: there is NO global French+Arabic mean, ever.
    combinedAverage: null as null,
    ready: french.status === "ready" && arabic.status === "ready",
  };
}

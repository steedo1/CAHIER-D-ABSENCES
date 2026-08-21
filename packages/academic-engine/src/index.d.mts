export type SubjectEvaluationInput = {
  id: string;
  scale: number;
  coefficient?: number;
  coeff?: number;
  component_id?: string | null;
};

export type SubjectScoreInput = {
  evaluation_id: string;
  score: number | null;
};

export type SubjectAverageInput = {
  evaluations: SubjectEvaluationInput[];
  scores: SubjectScoreInput[];
  component_coefficients?: Record<string, number>;
  missing?: "ignore" | "zero";
  adjustment?: number;
  round_to?: number | null;
};

export type SubjectAverageResult = {
  average_raw: number | null;
  adjustment: number;
  average: number | null;
  average_rounded: number | null;
  count_evaluations: number;
  total_evaluations: number;
  is_complete: boolean;
  status: "complete" | "partial" | "empty";
  component_model: boolean;
};

export type GeneralAverageInput = {
  subjects: Array<{
    id?: string;
    average: number | null;
    coefficient: number;
    include_in_average?: boolean;
    kind?: "academic" | "conduct";
  }>;
  conduct_average?: number | null;
  conduct_coefficient?: number;
  adjustment?: number;
};

export type GeneralAverageResult = {
  average_before_adjustment: number | null;
  adjustment: number;
  average: number | null;
  has_academic_contribution: boolean;
};

export type AnnualAverageInput = {
  periods: Array<{
    id?: string;
    average: number | null;
    coefficient?: number;
  }>;
};

export type AnnualAverageResult = {
  average: number | null;
  expected_periods: number;
  covered_periods: number;
  is_complete: boolean;
  status: "complete" | "partial" | "empty";
};

export type EndOfYearDecision = "ADMIS" | "REDOUBLE";
export type CouncilDecisionState = "draft" | "validated";
export type EndOfYearDecisionResolution = {
  ok: boolean;
  error:
    | "ANNUAL_AVERAGE_REQUIRED"
    | "INVALID_COUNCIL_DECISION"
    | "MOTIVE_REQUIRED"
    | null;
  annual_average: number | null;
  base_annual_average: number | null;
  council_adjustment: number;
  official_annual_average: number | null;
  automatic_proposal: EndOfYearDecision | null;
  council_decision: EndOfYearDecision | null;
  council_state: CouncilDecisionState | null;
  official_decision: EndOfYearDecision | null;
  official_source: "automatic" | "council" | "unavailable";
  override_applied: boolean;
};

export type RankInput = { id: string; average: number | null };
export type RankResult = { id: string; average: number; rank: number };

export type ConductEventInput = {
  event_type:
    | "uniform_warning"
    | "cheating"
    | "alcohol_or_drug"
    | "discipline_warning"
    | "discipline_offense"
    | "discipline_council";
  occurred_at: string;
};

export type ClassicConductInput = {
  absence_count?: number;
  /** Information complémentaire, jamais convertie en unité de pénalisation. */
  absence_minutes?: number;
  tardy_count?: number;
  tardy_minutes?: number;
  events?: ConductEventInput[];
  penalties?: Partial<Record<"tenue" | "moralite" | "discipline", number>>;
  rubric_overrides?: Partial<
    Record<"assiduite" | "tenue" | "moralite" | "discipline", number>
  >;
  settings: {
    rubric_max: Record<"assiduite" | "tenue" | "moralite" | "discipline", number>;
    default_session_minutes?: number;
    rules: {
      assiduite: {
        penalty_per_hour: number;
        max_hours_before_zero: number;
        note_after_threshold: number;
        lateness_mode: "ignore" | "as_hours" | "direct_points";
        lateness_minutes_per_absent_hour: number;
        lateness_points_per_late: number;
      };
      tenue: { warning_penalty: number };
      moralite: { event_penalty: number };
      discipline: { offense_penalty: number; council_cap: number };
    };
  };
};

export type ClassicConductResult = {
  calculated_breakdown: Record<"assiduite" | "tenue" | "moralite" | "discipline", number>;
  breakdown: Record<"assiduite" | "tenue" | "moralite" | "discipline", number>;
  total: number;
  total_max: number;
  average_20: number;
};

export function clamp(value: number, min: number, max: number): number;
export function normalizeScoreTo20(score: unknown, scale: unknown): number | null;
export function roundToStep(value: unknown, step: unknown): number | null;
export function calculateSubjectAverage(input: SubjectAverageInput): SubjectAverageResult;
export function calculateGeneralAverage(input: GeneralAverageInput): GeneralAverageResult;
export function calculateAnnualAverage(input: AnnualAverageInput): AnnualAverageResult;
export function proposeEndOfYearDecision(
  annualAverage: unknown,
): EndOfYearDecision | null;
export function canManageEndOfYearDecision(input: {
  is_last_period: boolean;
  annual_average: unknown;
}): boolean;
export function resolveEndOfYearDecision(input: {
  annual_average: unknown;
  council_override?: {
    decision: unknown;
    reason?: unknown;
    state?: CouncilDecisionState;
  } | null;
}): EndOfYearDecisionResolution;
export function calculateUnweightedAverage(
  values: Array<number | null | undefined>,
  digits?: number,
): number | null;
export function competitionRanks(rows: RankInput[]): RankResult[];
export function denseRanks(rows: RankInput[]): RankResult[];
export function calculateClassicConduct(input: ClassicConductInput): ClassicConductResult;
export function calculateCompositeConduct(input: {
  classic_average_20: number;
  classic_weight?: number;
  missing_subject_strategy?: "ignore_missing" | "count_as_zero";
  subjects?: Array<{ id?: string; average: number | null; weight?: number }>;
}): number;
export function calculateCouncilMentions(input: {
  general_average: number | null;
  conduct_average_20: number | null;
  is_csca?: boolean;
}): { distinction: "excellence" | "honour" | "encouragement" | null; sanction: string | null };

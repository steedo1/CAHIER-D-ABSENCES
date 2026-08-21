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
  automatic_proposal: EndOfYearDecision | null;
  council_decision: EndOfYearDecision | null;
  council_state: CouncilDecisionState | null;
  official_decision: EndOfYearDecision | null;
  official_source: "automatic" | "council" | "unavailable";
  override_applied: boolean;
};

export const COUNCIL_YEAR_DECISION_CONTRACT: string;
export function decisionTypeForLabel(
  value: EndOfYearDecision | null,
): "admitted" | "repeated" | "pending";
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

export function buildCouncilYearDecisionUpsert(input: {
  student_id: string;
  institution_id: string;
  academic_year: string;
  class_id: string;
  annual_average: unknown;
  annual_rank?: unknown;
  council_decision: unknown;
  reason?: unknown;
  state: CouncilDecisionState;
  author_id: string;
  recorded_at: string;
  existing_metadata?: unknown;
  period: {
    id: string;
    code?: string | null;
    from?: string | null;
    to?: string | null;
    is_last: boolean;
  };
}):
  | {
      ok: true;
      error: null;
      resolution: EndOfYearDecisionResolution;
      payload: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string | null;
      resolution: EndOfYearDecisionResolution;
      payload: null;
    };

export function readCouncilYearDecision(
  row: Record<string, unknown> | null | undefined,
  annualAverage: unknown,
): EndOfYearDecisionResolution & {
  id: string | null;
  student_id: string | null;
  state: CouncilDecisionState | null;
  reason: string | null;
  recorded_at: string | null;
  author_id: string | null;
  storage_contract: string | null;
};

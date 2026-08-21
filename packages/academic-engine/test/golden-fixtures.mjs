export const goldenFixtures = {
  complete_weighted_subject: {
    input: {
      evaluations: [
        { id: "eval-1", scale: 20, coefficient: 1 },
        { id: "eval-2", scale: 10, coefficient: 2 },
      ],
      scores: [
        { evaluation_id: "eval-1", score: 15 },
        { evaluation_id: "eval-2", score: 8 },
      ],
      missing: "ignore",
    },
    expected: {
      average_raw: 15.6667,
      adjustment: 0,
      average: 15.6667,
      average_rounded: 15.67,
      count_evaluations: 2,
      total_evaluations: 2,
      is_complete: true,
      status: "complete",
      component_model: false,
    },
  },
  missing_and_nc: {
    partial_input: {
      evaluations: [
        { id: "eval-1", scale: 20, coefficient: 1 },
        { id: "eval-2", scale: 20, coefficient: 3 },
      ],
      scores: [{ evaluation_id: "eval-1", score: 12 }],
      missing: "ignore",
    },
    partial_expected: {
      average_raw: 12,
      adjustment: 0,
      average: 12,
      average_rounded: 12,
      count_evaluations: 1,
      total_evaluations: 2,
      is_complete: false,
      status: "partial",
      component_model: false,
    },
    nc_input: {
      evaluations: [{ id: "eval-1", scale: 20, coefficient: 1 }],
      scores: [{ evaluation_id: "eval-1", score: null }],
      missing: "ignore",
    },
    nc_expected: {
      average_raw: null,
      adjustment: 0,
      average: null,
      average_rounded: null,
      count_evaluations: 0,
      total_evaluations: 1,
      is_complete: false,
      status: "empty",
      component_model: false,
    },
  },
  components: {
    input: {
      evaluations: [
        { id: "composition-1", scale: 20, coefficient: 1, component_id: "composition" },
        { id: "composition-2", scale: 20, coefficient: 1, component_id: "composition" },
        { id: "orthographe-1", scale: 20, coefficient: 1, component_id: "orthographe" },
      ],
      scores: [
        { evaluation_id: "composition-1", score: 14 },
        { evaluation_id: "composition-2", score: 16 },
        { evaluation_id: "orthographe-1", score: 10 },
      ],
      component_coefficients: { composition: 2, orthographe: 1 },
      missing: "ignore",
    },
    expected: {
      average_raw: 13.3333,
      adjustment: 0,
      average: 13.3333,
      average_rounded: 13.33,
      count_evaluations: 3,
      total_evaluations: 3,
      is_complete: true,
      status: "complete",
      component_model: true,
    },
  },
  adjustment_and_non_ranking_subject: {
    adjusted_subject_input: {
      evaluations: [{ id: "eval-1", scale: 20, coefficient: 1 }],
      scores: [{ evaluation_id: "eval-1", score: 19 }],
      adjustment: 2,
    },
    adjusted_subject_expected: {
      average_raw: 19,
      adjustment: 2,
      average: 20,
      average_rounded: 20,
      count_evaluations: 1,
      total_evaluations: 1,
      is_complete: true,
      status: "complete",
      component_model: false,
    },
    general_input: {
      subjects: [
        { id: "math", average: 14, coefficient: 3, include_in_average: true },
        { id: "art", average: 20, coefficient: 10, include_in_average: false },
      ],
      conduct_average: 16,
      conduct_coefficient: 1,
    },
    general_expected: {
      average_before_adjustment: 14.5,
      adjustment: 0,
      average: 14.5,
      has_academic_contribution: true,
    },
  },
  rank_tie: {
    input: [
      { id: "student-a", average: 15 },
      { id: "student-b", average: 15 },
      { id: "student-c", average: 12 },
    ],
    competition_expected: [
      { id: "student-a", average: 15, rank: 1 },
      { id: "student-b", average: 15, rank: 1 },
      { id: "student-c", average: 12, rank: 3 },
    ],
    dense_expected: [
      { id: "student-a", average: 15, rank: 1 },
      { id: "student-b", average: 15, rank: 1 },
      { id: "student-c", average: 12, rank: 2 },
    ],
  },
  conduct: {
    classic_input: {
      absence_count: 2,
      absence_minutes: 360,
      tardy_count: 1,
      tardy_minutes: 20,
      events: [
        { event_type: "uniform_warning", occurred_at: "2026-10-01T08:00:00Z" },
        { event_type: "cheating", occurred_at: "2026-10-02T08:00:00Z" },
        { event_type: "discipline_warning", occurred_at: "2026-10-03T08:00:00Z" },
        { event_type: "discipline_offense", occurred_at: "2026-10-04T08:00:00Z" },
        { event_type: "discipline_offense", occurred_at: "2026-10-05T08:00:00Z" },
      ],
      penalties: { tenue: 0.5, moralite: 0, discipline: 0 },
      settings: {
        rubric_max: { assiduite: 5, tenue: 5, moralite: 5, discipline: 5 },
        rules: {
          assiduite: {
            penalty_per_hour: 1,
            max_hours_before_zero: 5,
            note_after_threshold: 0,
            lateness_mode: "direct_points",
            lateness_minutes_per_absent_hour: 60,
            lateness_points_per_late: 0.5,
          },
          tenue: { warning_penalty: 1 },
          moralite: { event_penalty: 2 },
          discipline: { offense_penalty: 1, council_cap: 8 },
        },
      },
    },
    classic_expected: {
      calculated_breakdown: { assiduite: 2.5, tenue: 3.5, moralite: 3, discipline: 3 },
      breakdown: { assiduite: 2.5, tenue: 3.5, moralite: 3, discipline: 3 },
      total: 12,
      total_max: 20,
      average_20: 12,
    },
    composite_input: {
      classic_average_20: 12,
      classic_weight: 2,
      missing_subject_strategy: "ignore_missing",
      subjects: [
        { id: "religion", average: 16, weight: 1 },
        { id: "latin", average: null, weight: 1 },
      ],
    },
    composite_expected: 13.33,
  },
  annual: {
    input: {
      periods: [
        { id: "T1", average: 12, coefficient: 1 },
        { id: "T2", average: 15, coefficient: 2 },
        { id: "T3", average: null, coefficient: 1 },
      ],
    },
    expected: {
      average: 14,
      expected_periods: 3,
      covered_periods: 2,
      is_complete: false,
      status: "partial",
    },
  },
  end_of_year_decisions: {
    automatic: [
      { annual_average: 9.99, expected: "REDOUBLE" },
      { annual_average: 10, expected: "ADMIS" },
      { annual_average: 10.01, expected: "ADMIS" },
      { annual_average: null, expected: null },
    ],
    overrides: [
      {
        annual_average: 9.82,
        council_override: {
          decision: "ADMIS",
          reason: "Progression et avis favorable unanime.",
          state: "validated",
        },
        expected_official: "ADMIS",
      },
      {
        annual_average: 10.15,
        council_override: {
          decision: "REDOUBLE",
          reason: "Décision motivée du conseil.",
          state: "validated",
        },
        expected_official: "REDOUBLE",
      },
    ],
  },
  council_mentions: {
    input: { general_average: 15, conduct_average_20: 13, is_csca: true },
    expected: { distinction: "honour", sanction: null },
  },
};

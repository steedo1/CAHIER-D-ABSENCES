/**
 * Fondation pure du moteur académique Mon Cahier.
 *
 * Ce module n'accède ni à Supabase, ni à SQLite, ni à l'horloge. Les fonctions
 * reproduisent uniquement les règles caractérisées dans les routes actuelles ;
 * elles ne sont pas encore branchées sur les écrans de production.
 */

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits) {
  return Number(Number(value).toFixed(digits));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeScoreTo20(score, scale) {
  const rawScore = finiteNumber(score);
  const rawScale = finiteNumber(scale);
  if (rawScore === null || rawScale === null || rawScale <= 0 || rawScore < 0) {
    return null;
  }
  return (clamp(rawScore, 0, rawScale) / rawScale) * 20;
}

export function roundToStep(value, step) {
  const number = finiteNumber(value);
  const increment = finiteNumber(step);
  if (number === null) return null;
  if (increment === null || increment <= 0) return number;
  return Math.round(number / increment) * increment;
}

/**
 * Moyenne matière actuelle des routes /api/grades/averages :
 * - 0 est une note ; null/score négatif est absent ;
 * - pondération des évaluations ;
 * - modèle à deux étages pour les composantes configurées ;
 * - ajustement après moyenne, borné à [0, 20].
 */
export function calculateSubjectAverage(input) {
  const evaluations = Array.isArray(input?.evaluations) ? input.evaluations : [];
  const scores = Array.isArray(input?.scores) ? input.scores : [];
  const componentCoefficients = input?.component_coefficients || {};
  const missing = input?.missing === "zero" ? "zero" : "ignore";
  const adjustment = finiteNumber(input?.adjustment) ?? 0;
  const scoreByEvaluation = new Map(
    scores.map((row) => [String(row.evaluation_id || ""), row.score]),
  );
  const validEvaluations = evaluations
    .map((row) => ({
      id: String(row.id || ""),
      scale: finiteNumber(row.scale),
      coefficient: finiteNumber(row.coefficient ?? row.coeff),
      component_id: row.component_id ? String(row.component_id) : null,
    }))
    .filter((row) => row.id && row.scale !== null && row.scale > 0 &&
      row.coefficient !== null && row.coefficient > 0);

  const useComponentModel =
    Object.keys(componentCoefficients).length > 0 &&
    validEvaluations.some((row) => row.component_id);
  const totalCoefficient = validEvaluations.reduce(
    (sum, row) => sum + row.coefficient,
    0,
  );
  const totalCoefficientByComponent = new Map();
  for (const evaluation of validEvaluations) {
    const key = evaluation.component_id || "__none__";
    totalCoefficientByComponent.set(
      key,
      (totalCoefficientByComponent.get(key) || 0) + evaluation.coefficient,
    );
  }

  let weightedSum = 0;
  let presentCoefficient = 0;
  let counted = 0;
  const componentAggregates = new Map();
  for (const evaluation of validEvaluations) {
    const normalized = normalizeScoreTo20(
      scoreByEvaluation.get(evaluation.id),
      evaluation.scale,
    );
    if (normalized === null) continue;
    const contribution = normalized * evaluation.coefficient;
    weightedSum += contribution;
    presentCoefficient += evaluation.coefficient;
    counted += 1;

    if (useComponentModel) {
      const key = evaluation.component_id || "__none__";
      const aggregate = componentAggregates.get(key) || { sum: 0, coefficient: 0 };
      aggregate.sum += contribution;
      aggregate.coefficient += evaluation.coefficient;
      componentAggregates.set(key, aggregate);
    }
  }

  if (counted === 0) {
    return {
      average_raw: null,
      adjustment: round(adjustment, 2),
      average: null,
      average_rounded: null,
      count_evaluations: 0,
      total_evaluations: validEvaluations.length,
      is_complete: false,
      status: "empty",
      component_model: useComponentModel,
    };
  }

  let rawAverage = null;
  if (useComponentModel) {
    let subjectSum = 0;
    let subjectCoefficient = 0;
    for (const [componentId, aggregate] of componentAggregates.entries()) {
      const denominator = missing === "zero"
        ? totalCoefficientByComponent.get(componentId) || aggregate.coefficient
        : aggregate.coefficient;
      if (!denominator) continue;
      const componentAverage = aggregate.sum / denominator;
      const configured = finiteNumber(componentCoefficients[componentId]);
      const componentCoefficient = componentId === "__none__"
        ? 1
        : configured !== null && configured > 0
          ? configured
          : 1;
      subjectSum += componentAverage * componentCoefficient;
      subjectCoefficient += componentCoefficient;
    }
    rawAverage = subjectCoefficient > 0 ? subjectSum / subjectCoefficient : null;
  } else {
    const denominator = missing === "zero" ? totalCoefficient : presentCoefficient;
    rawAverage = denominator > 0 ? weightedSum / denominator : null;
  }

  if (rawAverage === null || !Number.isFinite(rawAverage)) {
    return {
      average_raw: null,
      adjustment: round(adjustment, 2),
      average: null,
      average_rounded: null,
      count_evaluations: counted,
      total_evaluations: validEvaluations.length,
      is_complete: false,
      status: "empty",
      component_model: useComponentModel,
    };
  }

  const adjusted = clamp(rawAverage + adjustment, 0, 20);
  const rounded = roundToStep(adjusted, input?.round_to);
  const isComplete = missing === "zero"
    ? validEvaluations.length > 0
    : counted >= validEvaluations.length && validEvaluations.length > 0;
  return {
    average_raw: round(rawAverage, 4),
    adjustment: round(adjustment, 2),
    average: round(adjusted, 4),
    average_rounded: rounded === null ? null : round(rounded, 2),
    count_evaluations: counted,
    total_evaluations: validEvaluations.length,
    is_complete: isComplete,
    status: isComplete ? "complete" : "partial",
    component_model: useComponentModel,
  };
}

/** Règle bulletin : matières classantes pondérées, conduite en complément. */
export function calculateGeneralAverage(input) {
  const subjects = Array.isArray(input?.subjects) ? input.subjects : [];
  let academicSum = 0;
  let academicWeight = 0;
  let conductSum = 0;
  let conductWeight = 0;
  let conductAlreadyCounted = false;

  for (const subject of subjects) {
    if (subject?.include_in_average === false) continue;
    const average = finiteNumber(subject?.average);
    const coefficient = finiteNumber(subject?.coefficient);
    if (average === null || coefficient === null || coefficient <= 0) continue;
    if (subject?.kind === "conduct") {
      conductAlreadyCounted = true;
      conductSum += average * coefficient;
      conductWeight += coefficient;
    } else {
      academicSum += average * coefficient;
      academicWeight += coefficient;
    }
  }

  if (academicWeight <= 0) {
    return {
      average_before_adjustment: null,
      adjustment: round(finiteNumber(input?.adjustment) ?? 0, 2),
      average: null,
      has_academic_contribution: false,
    };
  }

  if (!conductAlreadyCounted) {
    const conductAverage = finiteNumber(input?.conduct_average);
    if (conductAverage !== null) {
      const configuredWeight = finiteNumber(input?.conduct_coefficient);
      const weight = configuredWeight !== null && configuredWeight > 0
        ? configuredWeight
        : 1;
      conductSum += conductAverage * weight;
      conductWeight += weight;
    }
  }

  const raw = (academicSum + conductSum) / (academicWeight + conductWeight);
  const adjustment = finiteNumber(input?.adjustment) ?? 0;
  return {
    average_before_adjustment: round(raw, 4),
    adjustment: round(adjustment, 2),
    average: round(clamp(raw + adjustment, 0, 20), 4),
    has_academic_contribution: true,
  };
}

/** Moyenne annuelle du bulletin : moyenne pondérée des périodes calculables. */
export function calculateAnnualAverage(input) {
  const periods = Array.isArray(input?.periods) ? input.periods : [];
  let weightedSum = 0;
  let weightTotal = 0;
  let coveredPeriods = 0;
  for (const period of periods) {
    const average = finiteNumber(period?.average);
    if (average === null) continue;
    const configuredWeight = finiteNumber(period?.coefficient);
    const weight = configuredWeight !== null && configuredWeight > 0
      ? configuredWeight
      : 1;
    weightedSum += average * weight;
    weightTotal += weight;
    coveredPeriods += 1;
  }
  const expectedPeriods = periods.length;
  const average = weightTotal > 0 ? round(weightedSum / weightTotal, 4) : null;
  return {
    average,
    expected_periods: expectedPeriods,
    covered_periods: coveredPeriods,
    is_complete: expectedPeriods > 0 && coveredPeriods === expectedPeriods,
    status: expectedPeriods === 0
      ? "empty"
      : coveredPeriods === expectedPeriods
        ? "complete"
        : coveredPeriods > 0
          ? "partial"
          : "empty",
  };
}

/**
 * Proposition Mon Cahier de fin d'année.
 *
 * Cette règle est désormais explicitement validée pour la rentrée 2026-2027 :
 * - moyenne annuelle >= 10 : ADMIS ;
 * - moyenne annuelle < 10 : REDOUBLE ;
 * - moyenne annuelle absente/invalide : aucune proposition calculable.
 */
export function proposeEndOfYearDecision(annualAverage) {
  const average = finiteNumber(annualAverage);
  if (average === null || average < 0 || average > 20) return null;
  return average >= 10 ? "ADMIS" : "REDOUBLE";
}

/** La saisie des dérogations n'est pertinente qu'en dernière période, avec un annuel calculable. */
export function canManageEndOfYearDecision(input) {
  return input?.is_last_period === true &&
    proposeEndOfYearDecision(input?.annual_average) !== null;
}

/**
 * Résout la décision et la moyenne annuelle officielles sans modifier la
 * moyenne calculée. Un repêchage ADMIS sous 10 ajoute uniquement l'ajustement
 * nécessaire pour afficher 10,00 ; un brouillon ne l'applique jamais.
 */
export function resolveEndOfYearDecision(input) {
  const average = finiteNumber(input?.annual_average);
  const proposal = proposeEndOfYearDecision(average);
  const override = input?.council_override || null;

  if (proposal === null) {
    return {
      ok: override === null,
      error: override === null ? null : "ANNUAL_AVERAGE_REQUIRED",
      annual_average: average,
      base_annual_average: average,
      council_adjustment: 0,
      official_annual_average: null,
      automatic_proposal: null,
      council_decision: null,
      council_state: null,
      official_decision: null,
      official_source: "unavailable",
      override_applied: false,
    };
  }

  if (!override) {
    return {
      ok: true,
      error: null,
      annual_average: average,
      base_annual_average: average,
      council_adjustment: 0,
      official_annual_average: average,
      automatic_proposal: proposal,
      council_decision: null,
      council_state: null,
      official_decision: proposal,
      official_source: "automatic",
      override_applied: false,
    };
  }

  const decision = String(override.decision || "").trim().toUpperCase();
  const state = override.state === "validated" ? "validated" : "draft";
  const reason = String(override.reason || "").trim();

  if (decision !== "ADMIS" && decision !== "REDOUBLE") {
    return {
      ok: false,
      error: "INVALID_COUNCIL_DECISION",
      annual_average: average,
      base_annual_average: average,
      council_adjustment: 0,
      official_annual_average: average,
      automatic_proposal: proposal,
      council_decision: null,
      council_state: state,
      official_decision: proposal,
      official_source: "automatic",
      override_applied: false,
    };
  }

  if (decision !== proposal && !reason) {
    return {
      ok: false,
      error: "MOTIVE_REQUIRED",
      annual_average: average,
      base_annual_average: average,
      council_adjustment: 0,
      official_annual_average: average,
      automatic_proposal: proposal,
      council_decision: decision,
      council_state: state,
      official_decision: proposal,
      official_source: "automatic",
      override_applied: false,
    };
  }

  const validated = state === "validated";
  const councilAdjustment =
    decision === "ADMIS" && proposal === "REDOUBLE"
      ? round(Math.max(0, 10 - average), 2)
      : 0;
  return {
    ok: true,
    error: null,
    annual_average: average,
    base_annual_average: average,
    council_adjustment: councilAdjustment,
    official_annual_average:
      validated && councilAdjustment > 0 ? 10 : average,
    automatic_proposal: proposal,
    council_decision: decision,
    council_state: state,
    official_decision: validated ? decision : proposal,
    official_source: validated ? "council" : "automatic",
    override_applied: validated && decision !== proposal,
  };
}

/**
 * Caractérisation des fallbacks SQL/Conseil qui utilisent AVG sans coefficient.
 * Cette primitive reste explicitement nommée pour comparer les chemins ; elle
 * n'est pas désignée comme règle officielle et n'est branchée nulle part.
 */
export function calculateUnweightedAverage(values, digits = 2) {
  const valid = (Array.isArray(values) ? values : [])
    .map((value) => finiteNumber(value))
    .filter((value) => value !== null);
  if (valid.length === 0) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, digits);
}

/** Rang compétition du bulletin : 1, 1, 3. */
export function competitionRanks(rows) {
  const ranked = (Array.isArray(rows) ? rows : [])
    .filter((row) => finiteNumber(row?.average) !== null)
    .map((row) => ({ id: String(row.id), average: Number(row.average) }))
    .sort((a, b) => b.average - a.average || a.id.localeCompare(b.id));
  let lastAverage = null;
  let currentRank = 0;
  return ranked.map((row, index) => {
    if (lastAverage === null || row.average !== lastAverage) {
      currentRank = index + 1;
      lastAverage = row.average;
    }
    return { ...row, rank: currentRank };
  });
}

/** Rang dense des routes de moyennes : 1, 1, 2. */
export function denseRanks(rows) {
  const ranked = (Array.isArray(rows) ? rows : [])
    .filter((row) => finiteNumber(row?.average) !== null)
    .map((row) => ({ id: String(row.id), average: Number(row.average) }))
    .sort((a, b) => b.average - a.average || a.id.localeCompare(b.id));
  let lastAverage = null;
  let currentRank = 0;
  return ranked.map((row) => {
    if (lastAverage === null || Math.abs(row.average - lastAverage) > 1e-9) {
      currentRank += 1;
      lastAverage = row.average;
    }
    return { ...row, rank: currentRank };
  });
}

/** Rubriques de conduite actuelles, avant politique composite. */
export function calculateClassicConduct(input) {
  const settings = input?.settings || {};
  const maxima = settings.rubric_max || {};
  const rules = settings.rules || {};
  const assiduityRules = rules.assiduite || {};
  const events = Array.isArray(input?.events)
    ? [...input.events].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))
    : [];
  const penalties = input?.penalties || {};
  const overrides = input?.rubric_overrides || {};

  const assiduityMax = finiteNumber(maxima.assiduite) ?? 0;
  const tenueMax = finiteNumber(maxima.tenue) ?? 0;
  const moralityMax = finiteNumber(maxima.moralite) ?? 0;
  const disciplineMax = finiteNumber(maxima.discipline) ?? 0;
  const absenceUnits = Math.max(0, finiteNumber(input?.absence_count) ?? 0);
  const tardyMinutes = Math.max(0, finiteNumber(input?.tardy_minutes) ?? 0);
  const tardyCount = Math.max(0, finiteNumber(input?.tardy_count) ?? 0);
  const latenessMode = String(assiduityRules.lateness_mode || "ignore");
  const divisor = Math.max(
    1,
    finiteNumber(assiduityRules.lateness_minutes_per_absent_hour) ??
      finiteNumber(settings.default_session_minutes) ?? 60,
  );
  // `absence_count` est volontairement une unité de séance manquée. Les noms
  // historiques contenant "hour" décrivent les paramètres, pas une conversion
  // implicite depuis les minutes d'absence.
  const effectiveAbsenceUnits = latenessMode === "as_hours"
    ? absenceUnits + Math.floor(tardyMinutes / divisor)
    : absenceUnits;
  const threshold = finiteNumber(assiduityRules.max_hours_before_zero) ?? Number.POSITIVE_INFINITY;
  let assiduite = effectiveAbsenceUnits >= threshold
    ? clamp(finiteNumber(assiduityRules.note_after_threshold) ?? 0, 0, assiduityMax)
    : clamp(
        assiduityMax -
          (finiteNumber(assiduityRules.penalty_per_hour) ?? 0) * effectiveAbsenceUnits,
        0,
        assiduityMax,
      );
  if (latenessMode === "direct_points") {
    assiduite = clamp(
      assiduite - (finiteNumber(assiduityRules.lateness_points_per_late) ?? 0) * tardyCount,
      0,
      assiduityMax,
    );
  }

  const uniformWarnings = events.filter((event) => event.event_type === "uniform_warning").length;
  let tenue = clamp(
    tenueMax - (finiteNumber(rules.tenue?.warning_penalty) ?? 0) * uniformWarnings -
      (finiteNumber(penalties.tenue) ?? 0),
    0,
    tenueMax,
  );
  const moralityEvents = events.filter((event) =>
    event.event_type === "cheating" || event.event_type === "alcohol_or_drug"
  ).length;
  let moralite = clamp(
    moralityMax - (finiteNumber(rules.moralite?.event_penalty) ?? 0) * moralityEvents -
      (finiteNumber(penalties.moralite) ?? 0),
    0,
    moralityMax,
  );
  const firstWarning = events.find((event) => event.event_type === "discipline_warning");
  const offenses = firstWarning
    ? events.filter((event) =>
        event.event_type === "discipline_offense" &&
        String(event.occurred_at) >= String(firstWarning.occurred_at)
      ).length
    : 0;
  let discipline = clamp(
    disciplineMax - (finiteNumber(rules.discipline?.offense_penalty) ?? 0) * offenses -
      (finiteNumber(penalties.discipline) ?? 0),
    0,
    disciplineMax,
  );

  const calculatedBreakdown = {
    assiduite: round(assiduite, 2),
    tenue: round(tenue, 2),
    moralite: round(moralite, 2),
    discipline: round(discipline, 2),
  };
  const applyOverride = (key, current, max) => {
    const override = finiteNumber(overrides[key]);
    return override === null ? current : clamp(override, 0, max);
  };
  assiduite = applyOverride("assiduite", assiduite, assiduityMax);
  tenue = applyOverride("tenue", tenue, tenueMax);
  moralite = applyOverride("moralite", moralite, moralityMax);
  discipline = applyOverride("discipline", discipline, disciplineMax);
  const breakdown = {
    assiduite: round(assiduite, 2),
    tenue: round(tenue, 2),
    moralite: round(moralite, 2),
    discipline: round(discipline, 2),
  };
  let total = assiduite + tenue + moralite + discipline;
  if (events.some((event) => event.event_type === "discipline_council")) {
    total = Math.min(total, finiteNumber(rules.discipline?.council_cap) ?? total);
  }
  const totalMax = assiduityMax + tenueMax + moralityMax + disciplineMax;
  return {
    calculated_breakdown: calculatedBreakdown,
    breakdown,
    total: round(total, 2),
    total_max: round(totalMax, 2),
    average_20: totalMax > 0 ? round(clamp((total * 20) / totalMax, 0, 20), 2) : 0,
  };
}

/** Politique conduite + matières, avec stratégie des composantes manquantes. */
export function calculateCompositeConduct(input) {
  const classicAverage = clamp(finiteNumber(input?.classic_average_20) ?? 0, 0, 20);
  const classicWeight = Math.max(0, finiteNumber(input?.classic_weight) ?? 1);
  const components = Array.isArray(input?.subjects) ? input.subjects : [];
  const missingStrategy = input?.missing_subject_strategy === "count_as_zero"
    ? "count_as_zero"
    : "ignore_missing";
  let weightedSum = classicAverage * classicWeight;
  let weightTotal = classicWeight;
  for (const component of components) {
    const weight = Math.max(0, finiteNumber(component?.weight) ?? 1);
    const rawAverage = finiteNumber(component?.average);
    if (weight <= 0) continue;
    if (rawAverage === null && missingStrategy === "ignore_missing") continue;
    weightedSum += clamp(rawAverage ?? 0, 0, 20) * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? round(weightedSum / weightTotal, 2) : round(classicAverage, 2);
}

/** Seuils actuellement codés dans la page Conseil de classe. */
export function calculateCouncilMentions(input) {
  const generalAverage = finiteNumber(input?.general_average);
  const conductAverage = finiteNumber(input?.conduct_average_20);
  const csca = input?.is_csca === true;
  let distinction = null;
  let sanction = null;
  if (generalAverage !== null) {
    if (generalAverage >= 16) distinction = "excellence";
    else if (generalAverage >= (csca ? 15 : 14)) distinction = "honour";
    else if (generalAverage >= (csca ? 14 : 12)) distinction = "encouragement";
    else if (generalAverage < 8) sanction = "blameWork";
    else if (generalAverage < 10) sanction = "warningWork";
  }
  if (conductAverage !== null) {
    const ratio = conductAverage / 20;
    if (ratio <= 0.4) sanction = "blameConduct";
    else if (ratio <= 0.6 && !sanction) sanction = "warningConduct";
  }
  return { distinction, sanction };
}

import {
  canManageEndOfYearDecision,
  proposeEndOfYearDecision,
  resolveEndOfYearDecision,
} from "../../packages/academic-engine/src/index.mjs";

export {
  canManageEndOfYearDecision,
  proposeEndOfYearDecision,
  resolveEndOfYearDecision,
};

export const COUNCIL_YEAR_DECISION_CONTRACT =
  "mon_cahier_council_year_decision_v1";

export function decisionTypeForLabel(value) {
  if (value === "ADMIS") return "admitted";
  if (value === "REDOUBLE") return "repeated";
  return "pending";
}

function cleanMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactPreviousRecord(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const contract = String(metadata.contract || "");
  if (contract !== COUNCIL_YEAR_DECISION_CONTRACT) return null;
  return {
    state: metadata.state === "validated" ? "validated" : "draft",
    automatic_proposal: metadata.automatic_proposal || null,
    council_decision: metadata.council_decision || null,
    official_decision: metadata.official_decision || null,
    base_annual_average:
      cleanFiniteNumber(metadata.base_annual_average) ??
      cleanFiniteNumber(metadata.annual_average_used),
    council_adjustment: cleanFiniteNumber(metadata.council_adjustment) ?? 0,
    official_annual_average:
      cleanFiniteNumber(metadata.official_annual_average) ??
      cleanFiniteNumber(metadata.annual_average_used),
    reason: metadata.reason || null,
    recorded_at: metadata.recorded_at || null,
    author_id: metadata.author_id || null,
  };
}

/**
 * Adaptateur pur vers `student_year_decisions`.
 * L'horodatage et l'auteur sont obligatoirement injectés par la route appelante.
 */
export function buildCouncilYearDecisionUpsert(input) {
  const recordedAt = String(input?.recorded_at || "").trim();
  const authorId = String(input?.author_id || "").trim();
  const state = input?.state === "validated" ? "validated" : "draft";
  const reason = String(input?.reason || "").trim();
  const resolution = resolveEndOfYearDecision({
    annual_average: input?.annual_average,
    council_override: {
      decision: input?.council_decision,
      reason,
      state,
    },
  });

  if (!resolution.ok) {
    return { ok: false, error: resolution.error, resolution, payload: null };
  }
  if (!recordedAt || !authorId) {
    return {
      ok: false,
      error: "AUDIT_CONTEXT_REQUIRED",
      resolution,
      payload: null,
    };
  }

  const existingMetadata = cleanMetadata(input?.existing_metadata);
  const previous = compactPreviousRecord(existingMetadata);
  const history = Array.isArray(existingMetadata.history)
    ? existingMetadata.history.slice(-19)
    : [];
  if (previous) history.push(previous);

  const metadata = {
    contract: COUNCIL_YEAR_DECISION_CONTRACT,
    version: 2,
    source: "manual",
    entry_kind: "council_override",
    state,
    academic_year: String(input.academic_year || "").trim(),
    class_id: String(input.class_id || "").trim(),
    period_context: {
      period_id: String(input?.period?.id || "").trim() || null,
      code: String(input?.period?.code || "").trim() || null,
      from: String(input?.period?.from || "").trim() || null,
      to: String(input?.period?.to || "").trim() || null,
      is_last_period: input?.period?.is_last === true,
    },
    annual_average_used: resolution.annual_average,
    base_annual_average: resolution.base_annual_average,
    council_adjustment: resolution.council_adjustment,
    official_annual_average: resolution.official_annual_average,
    annual_rank_used:
      input?.annual_rank !== null &&
      input?.annual_rank !== undefined &&
      Number.isFinite(Number(input.annual_rank))
        ? Number(input.annual_rank)
        : null,
    automatic_proposal: resolution.automatic_proposal,
    council_decision: resolution.council_decision,
    official_decision: resolution.official_decision,
    is_derogation:
      resolution.council_decision !== null &&
      resolution.council_decision !== resolution.automatic_proposal,
    reason: reason || null,
    author_id: authorId,
    recorded_at: recordedAt,
    validated_at: state === "validated" ? recordedAt : null,
    history,
  };

  return {
    ok: true,
    error: null,
    resolution,
    payload: {
      student_id: String(input.student_id || "").trim(),
      institution_id: String(input.institution_id || "").trim(),
      academic_year: String(input.academic_year || "").trim(),
      current_class_id: String(input.class_id || "").trim(),
      decision_type: decisionTypeForLabel(resolution.official_decision),
      decision_label: resolution.official_decision,
      is_repeater_next_year:
        resolution.official_decision === null
          ? null
          : resolution.official_decision === "REDOUBLE",
      decided_at: state === "validated" ? recordedAt : null,
      decided_by: state === "validated" ? authorId : null,
      notes: reason || null,
      metadata_json: metadata,
      updated_at: recordedAt,
    },
  };
}

export function readCouncilYearDecision(row, annualAverage) {
  const metadata = cleanMetadata(row?.metadata_json);
  const isCouncilContract =
    metadata.contract === COUNCIL_YEAR_DECISION_CONTRACT &&
    metadata.entry_kind === "council_override";
  const hasCouncilOverride =
    isCouncilContract && metadata.is_derogation !== false;
  const state = metadata.state === "validated" ? "validated" : "draft";
  const storedBaseAnnualAverage =
    cleanFiniteNumber(metadata.base_annual_average) ??
    cleanFiniteNumber(metadata.annual_average_used);
  const calculationAnnualAverage =
    isCouncilContract && storedBaseAnnualAverage !== null
      ? storedBaseAnnualAverage
      : annualAverage;
  const councilOverride = hasCouncilOverride
    ? {
        decision: metadata.council_decision,
        reason: metadata.reason ?? row?.notes ?? null,
        state,
      }
    : null;
  const resolution = resolveEndOfYearDecision({
    annual_average: calculationAnnualAverage,
    council_override: councilOverride,
  });
  const persistedCouncilAdjustment = cleanFiniteNumber(metadata.council_adjustment);
  const persistedOfficialAnnualAverage = cleanFiniteNumber(
    metadata.official_annual_average,
  );

  return {
    id: row?.id ? String(row.id) : null,
    student_id: row?.student_id ? String(row.student_id) : null,
    state: hasCouncilOverride ? state : null,
    reason: hasCouncilOverride
      ? String(metadata.reason ?? row?.notes ?? "").trim() || null
      : null,
    recorded_at: hasCouncilOverride
      ? String(metadata.recorded_at || row?.updated_at || "").trim() || null
      : null,
    author_id: hasCouncilOverride
      ? String(metadata.author_id || row?.decided_by || "").trim() || null
      : null,
    storage_contract: isCouncilContract ? COUNCIL_YEAR_DECISION_CONTRACT : null,
    ...resolution,
    base_annual_average:
      isCouncilContract && storedBaseAnnualAverage !== null
        ? storedBaseAnnualAverage
        : resolution.base_annual_average,
    council_adjustment:
      isCouncilContract && persistedCouncilAdjustment !== null
        ? persistedCouncilAdjustment
        : resolution.council_adjustment,
    official_annual_average:
      isCouncilContract && persistedOfficialAnnualAverage !== null
        ? persistedOfficialAnnualAverage
        : resolution.official_annual_average,
  };
}

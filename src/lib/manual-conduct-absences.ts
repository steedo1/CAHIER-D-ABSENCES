/** Absence totals entered from a paper register, attached to one grading period. */
export const MANUAL_ABSENCE_REASON_PREFIX = "MC_MANUAL_ABSENCES_V1:";
export const DIRECT_CONDUCT_REASON_PREFIX = "MC_DIRECT_CONDUCT_V1:";
type PreviousConduct = { reason: string | null; override_total: number; calculated_total: number; from_date: string | null; to_date: string | null };
export function directConductSource(reason: unknown): { previous: PreviousConduct | null } | null {
  if (typeof reason !== "string" || !reason.startsWith(DIRECT_CONDUCT_REASON_PREFIX)) return null;
  const source = JSON.parse(reason.slice(DIRECT_CONDUCT_REASON_PREFIX.length));
  if (!source || !("previous" in source)) throw new Error("Source de conduite illisible");
  return source;
}
export function directConductReason(previous: PreviousConduct | null): string {
  const existing = directConductSource(previous?.reason);
  return DIRECT_CONDUCT_REASON_PREFIX + JSON.stringify({ previous: existing ? existing.previous : previous });
}
export const MANUAL_CONDUCT_ROLES = ["admin", "educator", "super_admin"] as const;
export type ManualAbsenceSource = { hours: number; periodId: string; sanctionPoints?: number; useDigitalAbsences?: boolean };
export type AssiduityRules = {
  penalty_per_hour: number;
  max_hours_before_zero: number;
  note_after_threshold: number;
  lateness_mode?: string;
  lateness_minutes_per_absent_hour?: number;
  lateness_points_per_late?: number;
};
export const DEFAULT_ASSIDUITY_RULES: AssiduityRules = {
  penalty_per_hour: 0.5, max_hours_before_zero: 10, note_after_threshold: 0,
  lateness_mode: "as_hours", lateness_minutes_per_absent_hour: 60, lateness_points_per_late: 0.25,
};
export function parseAbsenceHours(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const hours = Number(text.replace(",", "."));
  return Number.isFinite(hours) && hours >= 0 && hours <= 5000 ? hours : null;
}
export function manualAbsenceReason(source: ManualAbsenceSource): string {
  return MANUAL_ABSENCE_REASON_PREFIX + JSON.stringify(source);
}
export function parseSanctionPoints(value: unknown): number | null {
  const points = parseAbsenceHours(value);
  return points !== null && points <= 20 ? points : null;
}
export function deductManualSanctions(total: number, points: number): number {
  return Number(Math.max(0, total - points).toFixed(2));
}
export function parseManualAbsenceReason(reason: unknown): ManualAbsenceSource | null {
  const direct = directConductSource(reason);
  if (direct) reason = direct.previous?.reason;
  if (typeof reason !== "string" || !reason.startsWith(MANUAL_ABSENCE_REASON_PREFIX)) return null;
  try {
    const source = JSON.parse(reason.slice(MANUAL_ABSENCE_REASON_PREFIX.length));
    const hours = parseAbsenceHours(source?.hours);
    if (hours === null || typeof source?.periodId !== "string" || !source.periodId) return null;
    const sanctionPoints = source.sanctionPoints === undefined ? undefined : parseSanctionPoints(source.sanctionPoints);
    if (sanctionPoints === null) return null;
    if (source.useDigitalAbsences !== undefined && typeof source.useDigitalAbsences !== "boolean") return null;
    return { hours, periodId: source.periodId, ...(sanctionPoints === undefined ? {} : { sanctionPoints }),
      ...(source.useDigitalAbsences === undefined ? {} : { useDigitalAbsences: source.useDigitalAbsences }) };
  } catch { return null; }
}
const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
const round = (n: number) => Number(n.toFixed(2));
export function calculateAssiduity(hours: number, max: number, rules: AssiduityRules, tardyMinutes = 0, tardyCount = 0): number {
  const effective = hours + (rules.lateness_mode === "as_hours"
    ? Math.floor(tardyMinutes / Math.max(1, rules.lateness_minutes_per_absent_hour || 60)) : 0);
  if (effective >= rules.max_hours_before_zero) return round(clamp(rules.note_after_threshold, max));
  const latePenalty = rules.lateness_mode === "direct_points" ? tardyCount * (rules.lateness_points_per_late || 0) : 0;
  return round(clamp(max - rules.penalty_per_hour * effective - latePenalty, max));
}
export type ManualConductItem = {
  student_id: string; full_name: string; total: number;
  tardy_minutes?: number; tardy_count?: number;
  absence_count?: number; manual_absence_hours?: number | null;
  manual_sanction_points?: number;
  manual_absence_updated_at?: string | null;
  breakdown: { assiduite: number; tenue: number; moralite: number; discipline: number };
  is_overridden?: boolean;
  rubric_overrides?: { assiduite?: unknown };
  conduct_has_council?: boolean; conduct_council_cap?: number;
  conduct_policy_mode?: string;
  conduct_policy_components?: Array<{ kind: string; avg20: number | null; weight: number; included: boolean }>;
};
export function previewManualConduct(item: ManualConductItem, hours: number, maxes: ManualConductItem["breakdown"], rules: AssiduityRules, sanctionPoints = item.manual_sanction_points ?? 0): number {
  if (item.is_overridden) return item.total;
  const ass = item.rubric_overrides?.assiduite ? item.breakdown.assiduite : calculateAssiduity(hours, maxes.assiduite, rules, item.tardy_minutes || 0, item.tardy_count || 0);
  let classic = ass + item.breakdown.tenue + item.breakdown.moralite + item.breakdown.discipline;
  if (item.conduct_has_council) classic = Math.min(classic, item.conduct_council_cap ?? 5);
  const totalMax = maxes.assiduite + maxes.tenue + maxes.moralite + maxes.discipline;
  if (item.conduct_policy_mode !== "conduct_plus_subjects") return deductManualSanctions(round(classic), sanctionPoints);
  const classic20 = totalMax > 0 ? classic / totalMax * 20 : 0;
  let sum = 0, weights = 0;
  for (const component of item.conduct_policy_components || []) {
    if (!component.included || component.weight <= 0) continue;
    const value = component.kind === "classic_conduct" ? classic20 : component.avg20;
    if (value === null) continue;
    sum += value * component.weight; weights += component.weight;
  }
  // CSCA composition is unchanged. One sanction point deducts one point from its final result.
  return deductManualSanctions(round(weights > 0 ? sum / weights : classic20), sanctionPoints);
}
type ManualConductRow = { reason?: unknown; period_code?: string; from_date?: string | null; to_date?: string | null; updated_at?: string | null };
export function manualConductForRange(rows: ManualConductRow[], from: string, to: string): { hours: number | null; sanctionPoints: number } | null {
  const byPeriod = new Map<string, ManualAbsenceSource>();
  for (const row of [...rows].sort((a,b) => String(a.updated_at || "").localeCompare(String(b.updated_at || "")))) {
    const source = parseManualAbsenceReason(row.reason);
    const updatedDay = String(row.updated_at || "").slice(0, 10);
    const through = row.to_date && updatedDay ? (row.to_date < updatedDay ? row.to_date : updatedDay) : row.to_date;
    if (!source || (from && (!row.from_date || row.from_date < from)) ||
      (to && (!row.from_date || row.from_date > to || !through || through > to))) continue;
    byPeriod.set(source.periodId, source);
  }
  if (!byPeriod.size) return null;
  const sources = [...byPeriod.values()];
  const manual = sources.filter(source => !source.useDigitalAbsences);
  return {
    hours: manual.length ? round(manual.reduce((sum, source) => sum + source.hours, 0)) : null,
    sanctionPoints: round(sources.reduce((sum, source) => sum + (source.sanctionPoints ?? 0), 0)),
  };
}
export function manualHoursForRange(rows: ManualConductRow[], from: string, to: string): number | null {
  return manualConductForRange(rows, from, to)?.hours ?? null;
}

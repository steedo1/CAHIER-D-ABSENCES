/** Absence totals entered from a paper register, attached to one grading period. */
export const MANUAL_ABSENCE_REASON_PREFIX = "MC_MANUAL_ABSENCES_V1:";
export const MANUAL_CONDUCT_ROLES = ["admin", "educator", "super_admin"] as const;
export type ManualAbsenceSource = { hours: number; periodId: string };
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
export function parseManualAbsenceReason(reason: unknown): ManualAbsenceSource | null {
  if (typeof reason !== "string" || !reason.startsWith(MANUAL_ABSENCE_REASON_PREFIX)) return null;
  try {
    const source = JSON.parse(reason.slice(MANUAL_ABSENCE_REASON_PREFIX.length));
    const hours = parseAbsenceHours(source?.hours);
    if (hours === null || typeof source?.periodId !== "string" || !source.periodId) return null;
    return { hours, periodId: source.periodId };
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
  breakdown: { assiduite: number; tenue: number; moralite: number; discipline: number };
  is_overridden?: boolean;
  rubric_overrides?: { assiduite?: unknown };
  conduct_has_council?: boolean; conduct_council_cap?: number;
  conduct_policy_mode?: string;
  conduct_policy_components?: Array<{ kind: string; avg20: number | null; weight: number; included: boolean }>;
};
export function previewManualConduct(item: ManualConductItem, hours: number, maxes: ManualConductItem["breakdown"], rules: AssiduityRules): number {
  if (item.is_overridden) return item.total;
  const ass = calculateAssiduity(hours, maxes.assiduite, rules, item.tardy_minutes || 0, item.tardy_count || 0);
  let classic = ass + item.breakdown.tenue + item.breakdown.moralite + item.breakdown.discipline;
  if (item.conduct_has_council) classic = Math.min(classic, item.conduct_council_cap ?? 5);
  const totalMax = maxes.assiduite + maxes.tenue + maxes.moralite + maxes.discipline;
  if (item.conduct_policy_mode !== "conduct_plus_subjects") return round(classic);
  const classic20 = totalMax > 0 ? classic / totalMax * 20 : 0;
  let sum = 0, weights = 0;
  for (const component of item.conduct_policy_components || []) {
    if (!component.included || component.weight <= 0) continue;
    const value = component.kind === "classic_conduct" ? classic20 : component.avg20;
    if (value === null) continue;
    sum += value * component.weight; weights += component.weight;
  }
  return round(weights > 0 ? sum / weights : classic20);
}
export function manualHoursForRange(rows: Array<{ reason?: unknown; period_code?: string; from_date?: string | null; to_date?: string | null; updated_at?: string | null }>, from: string, to: string): number | null {
  const byPeriod = new Map<string, number>();
  for (const row of [...rows].sort((a,b) => String(a.updated_at || "").localeCompare(String(b.updated_at || "")))) {
    const source = parseManualAbsenceReason(row.reason);
    const updatedDay = String(row.updated_at || "").slice(0, 10);
    const through = row.to_date && updatedDay ? (row.to_date < updatedDay ? row.to_date : updatedDay) : row.to_date;
    if (!source || (from && (!row.from_date || row.from_date < from)) ||
      (to && (!row.from_date || row.from_date > to || !through || through > to))) continue;
    byPeriod.set(source.periodId, source.hours);
  }
  return byPeriod.size ? [...byPeriod.values()].reduce((sum, n) => sum + n, 0) : null;
}

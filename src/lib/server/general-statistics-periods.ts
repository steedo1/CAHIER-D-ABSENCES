import type { SupabaseClient } from "@supabase/supabase-js";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";
import type { StatisticsGradePeriod } from "@/lib/general-statistics-averages";

type StatisticsClass = {
  id: string; education_type?: string | null; formation_code?: string | null; formation_level_code?: string | null;
};
/** One lookup per education context, rather than one per pupil or class. */
export async function loadStatisticsGradePeriods(
  service: SupabaseClient, institutionId: string, academicYear: string, classes: StatisticsClass[],
): Promise<StatisticsGradePeriod[]> {
  const groups = new Map<string, StatisticsClass[]>();
  for (const row of classes) {
    const key = [row.education_type || "general_secondary", row.formation_code || "", row.formation_level_code || ""].join("|");
    const group = groups.get(key) || []; group.push(row); groups.set(key, group);
  }
  const periods = new Map<string, StatisticsGradePeriod>();
  for (const group of groups.values()) {
    const resolved = await listApplicableGradePeriods(service, institutionId, academicYear, group[0].id);
    for (const row of resolved.items) {
      if (!row.start_date || !row.end_date) continue;
      const existing = periods.get(row.id);
      const classIds = [...(existing?.class_ids || []), ...group.map((item) => item.id)];
      periods.set(row.id, { id: row.id, label: row.label || row.short_label || row.code || "Période",
        start_date: row.start_date, end_date: row.end_date, coeff: Number(row.coeff) || 1,
        class_ids: Array.from(new Set(classIds)) });
    }
  }
  return Array.from(periods.values()).sort((a, b) => a.end_date.localeCompare(b.end_date) || a.label.localeCompare(b.label, "fr"));
}

export type PeriodCode = "T1" | "T2" | "T3";
export type PeriodFilter = PeriodCode | "ALL";
export type MonitorView = "class" | "subject";

export type Metric = {
  expected_items: number;
  completed_items: number;
  planned_minutes: number;
  completed_planned_minutes: number;
  completion_rate: number;
  sessions_count: number;
  planned_sessions_count: number;
  recording_rate: number;
  realized_minutes: number;
  realized_hours: number;
};

export type MonitorItem = Metric & {
  assignment_id: string;
  progression_id?: string | null;
  progression_title: string;
  academic_year: string;
  class_id: string;
  class_label: string;
  level?: string | null;
  education_type?: string | null;
  formation_code?: string | null;
  formation_level_code?: string | null;
  subject_id?: string | null;
  subject_name: string;
  teacher_id?: string | null;
  teacher_name: string;
  periods: Record<PeriodCode, Metric>;
};

export type MonitorCard = {
  key: string;
  title: string;
  teacher: string;
  metric: Metric;
  assignments: MonitorItem[];
};

const ZERO: Metric = {
  expected_items: 0,
  completed_items: 0,
  planned_minutes: 0,
  completed_planned_minutes: 0,
  completion_rate: 0,
  sessions_count: 0,
  planned_sessions_count: 0,
  recording_rate: 0,
  realized_minutes: 0,
  realized_hours: 0,
};

function pct(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 1000) / 10 : 0;
}

export function metricFor(item: MonitorItem, period: PeriodFilter): Metric {
  return period === "ALL" ? item : item.periods?.[period] || ZERO;
}

// Aggregate numerators and denominators rather than taking an average of rates.
export function combineMetrics(rows: MonitorItem[], period: PeriodFilter): Metric {
  const result = { ...ZERO };
  for (const item of rows) {
    const metric = metricFor(item, period);
    result.expected_items += Number(metric.expected_items || 0);
    result.completed_items += Number(metric.completed_items || 0);
    result.planned_minutes += Number(metric.planned_minutes || 0);
    result.completed_planned_minutes += Number(metric.completed_planned_minutes || 0);
    result.sessions_count += Number(metric.sessions_count || 0);
    result.planned_sessions_count += Number(metric.planned_sessions_count || 0);
    result.realized_minutes += Number(metric.realized_minutes || 0);
  }
  result.completion_rate = result.planned_minutes
    ? pct(result.completed_planned_minutes, result.planned_minutes)
    : pct(result.completed_items, result.expected_items);
  result.recording_rate = result.planned_sessions_count
    ? Math.min(100, pct(result.sessions_count, result.planned_sessions_count))
    : 0;
  result.realized_hours = Math.round((result.realized_minutes / 60) * 10) / 10;
  return result;
}

export function subjectKey(item: MonitorItem): string {
  return String(item.subject_id || item.subject_name || "").trim();
}

export function groupCards(
  items: MonitorItem[],
  period: PeriodFilter,
  view: MonitorView,
): MonitorCard[] {
  const groups = new Map<string, MonitorItem[]>();
  for (const item of items) {
    const teacherKey = String(item.teacher_id || item.teacher_name || "sans-professeur");
    const key =
      view === "class"
        ? `${subjectKey(item)}|${teacherKey}`
        : `${item.class_id}|${teacherKey}`;
    const existing = groups.get(key) || [];
    existing.push(item);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([key, assignments]) => ({
      key,
      title: view === "class" ? assignments[0].subject_name : assignments[0].class_label,
      teacher: assignments[0].teacher_name || "Enseignant non affecté",
      metric: combineMetrics(assignments, period),
      assignments,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "fr", { numeric: true }));
}

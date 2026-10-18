import type { BulletinProgram, BulletinSubject } from "@/components/bulletins/FrancoArabicBulletin";

/**
 * Presentation-only adapter for the existing secondary-school bulletin response.
 * No mean, coefficient, bonus, conduct result, rank or council decision is
 * calculated here. The HISTORICAL bulletin endpoint stays the sole authority
 * for the French general-secondary teaching track, including its strictly
 * institution-scoped exceptional rules (CSCA).
 */
export type HistoricalSecondaryFrenchResponse = {
  ok?: boolean;
  period?: { from?: string | null; to?: string | null; label?: string | null; code?: string | null;
    academic_year?: string | null };
  subjects?: Array<{ subject_id: string; subject_name: string; coeff_bulletin: number;
    include_in_average?: boolean }>;
  subject_components?: Array<{ id: string; subject_id: string; label: string;
    order_index: number; coeff_in_subject: number }>;
  subject_groups?: Array<{ id: string; label: string; order_index: number;
    annual_coeff?: number | null; items?: Array<{ subject_id: string }> }>;
  items?: Array<{
    student_id: string; general_avg: number | null; rank?: number | null;
    annual_avg?: number | null; annual_rank?: number | null;
    conduct_avg?: number | null; general_bonus?: number | null;
    general_avg_status?: string | null;
    previous_period_avgs?: Array<{ label?: string | null; code?: string | null;
      avg20?: number | null; rank?: number | null }> | null;
    end_of_year_decision?: { official_decision?: string | null; state?: string | null;
      official_annual_average?: number | null; council_adjustment?: number | null } | null;
    per_subject?: Array<{ subject_id: string; avg20: number | null; subject_rank?: number | null;
      teacher_name?: string | null; bonus?: number | null; is_nc?: boolean }>;
    per_subject_components?: Array<{ component_id: string; avg20: number | null;
      component_rank?: number | null }>;
    per_group?: Array<{ group_id: string; group_avg: number | null }>;
  }>;
};

export function adaptHistoricalFrenchSecondaryBulletins(
  historical: HistoricalSecondaryFrenchResponse,
  context: { level: string; className: string; year: string; period: string;
    directorName?: string | null },
): Map<string, BulletinProgram> {
  if (historical.ok !== true || !Array.isArray(historical.items) ||
      !Array.isArray(historical.subjects)) {
    throw new Error("HISTORICAL_FRENCH_BULLETIN_UNAVAILABLE");
  }
  const outputs = new Map<string, BulletinProgram>();
  const components = historical.subject_components || [];
  const groups = historical.subject_groups || [];
  const subjectIds = new Set(historical.subjects.map(row => row.subject_id));
  const componentsBySubject = new Map<string, typeof components>();
  for (const component of components) {
    if (!subjectIds.has(component.subject_id)) continue;
    const list = componentsBySubject.get(component.subject_id) || [];
    list.push(component);
    componentsBySubject.set(component.subject_id, list);
  }
  for (const item of historical.items) {
    if (!item.student_id || outputs.has(item.student_id)) {
      throw new Error("HISTORICAL_FRENCH_STUDENT_SCOPE_INVALID");
    }
    const scoreBySubject = new Map((item.per_subject || []).map(score => [score.subject_id, score]));
    const scoreByComponent = new Map((item.per_subject_components || []).map(score => [score.component_id, score]));
    const scoreByGroup = new Map((item.per_group || []).map(score => [score.group_id, score]));
    const subjects: BulletinSubject[] = historical.subjects.map(subject => {
      const grade = scoreBySubject.get(subject.subject_id);
      return {
        id: subject.subject_id, name: subject.subject_name,
        coefficient: subject.coeff_bulletin, average: grade?.avg20 ?? null,
        includeInAverage: subject.include_in_average !== false,
        subjectRank: grade?.subject_rank ?? null,
        teacherName: grade?.teacher_name ?? null,
        bonus: grade?.bonus ?? null,
        components: (componentsBySubject.get(subject.subject_id) || [])
          .slice().sort((a, b) => a.order_index - b.order_index).map(component => ({
            id: component.id, name: component.label,
            coefficient: component.coeff_in_subject,
            average: scoreByComponent.get(component.id)?.avg20 ?? null,
            rank: scoreByComponent.get(component.id)?.component_rank ?? null,
          })),
      };
    });
    outputs.set(item.student_id, {
      track: "french", cycle: "Secondaire", level: context.level,
      className: context.className, year: context.year, period: context.period,
      denominator: 20,
      subjects, generalAverage: item.general_avg ?? null,
      rank: item.rank ?? null, classSize: historical.items.length,
      directorName: context.directorName ?? null,
      // A historical NC is a legitimate report state, not a missing engine:
      // printing it must not convert it into a fabricated zero.
      allowHistoricalNc: true,
      historicalSecondary: {
        conductAverage: item.conduct_avg ?? null,
        annualAverage: item.annual_avg ?? null,
        annualRank: item.annual_rank ?? null,
        generalBonus: item.general_bonus ?? null,
        averageStatus: item.general_avg_status ?? null,
        previousPeriods: item.previous_period_avgs || [],
        decision: item.end_of_year_decision ?? null,
        groups: groups
          .filter(group => (group.items || []).some(g => subjectIds.has(g.subject_id)))
          .slice().sort((a, b) => a.order_index - b.order_index)
          .map(group => ({ id: group.id, label: group.label,
            coefficient: group.annual_coeff ?? null,
            average: scoreByGroup.get(group.id)?.group_avg ?? null })),
      },
    });
  }
  return outputs;
}

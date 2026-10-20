import type { SupabaseClient } from "@supabase/supabase-js";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";
import { directAverageMap, DIRECT_AVERAGES_PREFIX } from "@/lib/grades/direct-subject-averages";

/** Keep composite conduct (notably CSCA Religion/Latin) aligned with bulletins. */
export async function overlayDirectConductSubjects(service: SupabaseClient, averages: Map<string, Map<string, number>>, options: {
  institutionId: string; classId: string; academicYear: string; periodCode?: string;
  periodId?: string | null; from: string; to: string; subjectIds: string[]; studentIds: string[];
}) {
  if (!options.subjectIds.length || !options.studentIds.length || !options.academicYear) return;
  let periodId = options.periodId;
  if (!periodId) {
    const resolved = await listApplicableGradePeriods(service, options.institutionId, options.academicYear, options.classId);
    periodId = resolved.items.find(row => options.periodCode ? row.code === options.periodCode :
      row.start_date === options.from && row.end_date === options.to)?.id;
  }
  if (!periodId) return;
  const { data, error } = await service.from("grade_adjustments").select("student_id,subject_id,reason")
    .eq("class_id", options.classId).eq("academic_year", options.academicYear)
    .in("subject_id", options.subjectIds).in("student_id", options.studentIds)
    .like("reason", `${DIRECT_AVERAGES_PREFIX}%`);
  if (error) throw error;
  for (const [studentId, subjects] of directAverageMap(data || [], periodId)) for (const [subjectId, average] of subjects) {
    const byStudent = averages.get(subjectId) || new Map<string, number>();
    byStudent.set(studentId, average);
    averages.set(subjectId, byStudent);
  }
}

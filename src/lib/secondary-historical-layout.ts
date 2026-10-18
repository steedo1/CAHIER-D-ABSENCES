import type { BulletinProgram, BulletinTrack } from "@/components/bulletins/FrancoArabicBulletin";
import type { SpecializedBulletinPayload } from "@/lib/server/specialized-bulletin";

/**
 * Presentation-only adapter. It never queries, merges, publishes or computes
 * official averages. It converts independently authorized teaching tracks to
 * the historical /20 bulletin CARD contract, preserving server averages/ranks.
 *
 * A missing denominator is invalid, never silently replaced with 20.
 */
function onTwenty(value: number | null | undefined, denominator: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return (value * 20) / denominator;
}

export function historicalSecondaryViews(payload: SpecializedBulletinPayload, track: BulletinTrack) {
  if (payload.cycle !== "secondary" || !payload.programs.includes(track)) return [];

  return payload.documents.flatMap(row => {
    const program: BulletinProgram | null | undefined = row.document[track];
    if (!program) return [];

    const normalizedSubjects = program.subjects.map(subject => ({
      subject_id: subject.id,
      subject_name: subject.name,
      coeff_bulletin: subject.coefficient ?? 0,
      include_in_average: subject.includeInAverage !== false,
    }));
    const normalizedComponents = program.subjects.flatMap(subject =>
      (subject.components || []).map((component, index) => ({
        id: component.id,
        subject_id: subject.id,
        label: component.name,
        short_label: null as string | null,
        coeff_in_subject: component.coefficient,
        order_index: index + 1,
      })),
    );
    const perSubjectComponents = program.subjects.flatMap(subject =>
      (subject.components || []).map(component => ({
        subject_id: subject.id, component_id: component.id,
        avg20: onTwenty(component.average, program.denominator),
        component_rank: component.rank,
      })),
    );
    const item = {
      student_id: row.studentId,
      full_name: [row.document.student.lastName, row.document.student.firstName].filter(Boolean).join(" "),
      matricule: row.document.student.matricule ?? null,
      birth_date: row.document.student.birthDate ?? null,
      photo_url: row.document.student.photoUrl ?? null,
      general_avg: onTwenty(program.generalAverage, program.denominator),
      rank: program.rank ?? null,
      per_subject: program.subjects.map(subject => ({
        subject_id: subject.id,
        avg20: onTwenty(subject.average, program.denominator),
        subject_rank: subject.subjectRank ?? null,
        teacher_name: subject.teacherName ?? null,
        teacher_id: null,
      })),
      per_subject_components: perSubjectComponents,
      per_group: [] as Array<{ group_id: string; group_avg: number | null }>,
      annual_avg: program.historicalSecondary?.annualAverage ?? null,
      annual_rank: program.historicalSecondary?.annualRank ?? null,
      previous_period_avgs: program.historicalSecondary?.previousPeriods.map(previous => ({
        code: previous.code ?? null, label: previous.label ?? null, avg20: previous.avg20 ?? null,
        rank: previous.rank ?? null,
      })) ?? null,
      general_avg_is_complete: program.generalAverage !== null,
      general_avg_status: program.generalAverage !== null ? "complete" : "empty",
      is_assigned: null,
    };
    const ready = row.programReadiness[track] === true &&
      Number.isFinite(program.denominator) && program.denominator > 0;
    return [{ studentId: row.studentId, program, item,
      subjects: normalizedSubjects, subjectComponents: normalizedComponents,
      ready, problems: row.problems }];
  });
}

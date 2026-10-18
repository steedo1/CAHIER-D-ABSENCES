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
    const fallbackItem = {
      student_id: row.studentId,
      full_name: [row.document.student.lastName, row.document.student.firstName].filter(Boolean).join(" "),
      matricule: row.document.student.matricule ?? null,
      birth_date: row.document.student.birthDate ?? null,
      birth_place: row.document.student.birthPlace ?? null,
      gender: row.document.student.gender ?? null,
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
      per_group: (program.historicalSecondary?.groups || []).map(group => ({ group_id: group.id, group_avg: group.average })),
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
    const item = { ...fallbackItem, ...program.historicalSecondary?.sourceItem } as typeof fallbackItem;
    const subjectGroups = (program.historicalSecondary?.groups || []).map((group, index) => ({
      id: group.id, code: group.id, label: group.label, short_label: null,
      order_index: index + 1, is_active: true, annual_coeff: group.coefficient ?? 1,
      items: (group.subjectIds || []).map((subjectId, order) => ({
        id: `${group.id}:${subjectId}`, group_id: group.id, subject_id: subjectId,
        subject_name: program.subjects.find(subject => subject.id === subjectId)?.name || subjectId,
        order_index: order + 1, subject_coeff_override: null,
      })),
    }));
    const ready = row.programReadiness[track] === true &&
      Number.isFinite(program.denominator) && program.denominator > 0;
    return [{ studentId: row.studentId, program, item,
      subjects: normalizedSubjects, subjectComponents: normalizedComponents, subjectGroups,
      ready, problems: row.problems }];
  });
}

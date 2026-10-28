import { parseSchoolCyclesSettings, resolveSchoolCycleForClass } from "./school-cycles";
import { expandPedagogicalEnrollments, readStudentProgramSettings } from "./school-student-programs";

export type AdminStudentClassForLinks = {
  id: string;
  academic_year?: string | null;
  level?: string | null;
};

export type AdminStudentEnrollmentForLinks = {
  student_id: string;
  class_id: string;
  end_date?: string | null;
};

/**
 * Virtual bilingual memberships for the administrative student list.
 *
 * A pupil keeps exactly one administrative class_enrollments row. A validated
 * linkedStudentIds relationship can make that same pupil visible in an Arabic
 * pedagogical class without changing enrollment, school fees or identity.
 */
export function adminStudentPedagogicalLinks(
  settings: unknown,
  classes: readonly AdminStudentClassForLinks[],
  administrative: readonly AdminStudentEnrollmentForLinks[],
): {
  byStudent: Record<string, string[]>;
  pedagogicalClassIds: string[];
} {
  const empty = { byStudent: {} as Record<string, string[]>, pedagogicalClassIds: [] as string[] };
  const school = parseSchoolCyclesSettings(settings);
  if (!school.enabled) return empty;

  const programs = readStudentProgramSettings(settings);
  const groups = new Map<string, AdminStudentClassForLinks[]>();
  for (const cls of classes) {
    const year = String(cls.academic_year || "").trim();
    if (!year || !cls.id) continue;
    const group = groups.get(year) || [];
    group.push(cls);
    groups.set(year, group);
  }

  const validClasses = new Set(classes.map(cls => cls.id));
  const actualPairs = new Set(administrative.map(row => `${row.class_id}:${row.student_id}`));
  const byStudent = new Map<string, Set<string>>();
  const pedagogicalClasses = new Set<string>();

  for (const [year, group] of groups) {
    const yearPolicy = programs.years[year];
    if (!yearPolicy) continue;

    for (const cls of group) {
      const policy = yearPolicy.classes[cls.id];
      if (policy?.linkedStudentIds?.length && policy.tracks.length === 1 &&
          school.teachingTracksByCycle[resolveSchoolCycleForClass(cls, school)]?.includes(policy.tracks[0])) {
        pedagogicalClasses.add(cls.id);
      }
    }

    const classIds = new Set(group.map(cls => cls.id));
    const yearHomes = administrative.filter(row => classIds.has(row.class_id));
    const virtual = expandPedagogicalEnrollments(
      school,
      yearPolicy,
      group.map(cls => ({
        id: cls.id,
        level: cls.level,
        cycle: resolveSchoolCycleForClass(cls, school),
      })),
      yearHomes,
    );

    for (const membership of virtual) {
      if (!pedagogicalClasses.has(membership.class_id) ||
          !validClasses.has(membership.class_id) ||
          actualPairs.has(`${membership.class_id}:${membership.student_id}`)) continue;
      const forStudent = byStudent.get(membership.student_id) || new Set<string>();
      forStudent.add(membership.class_id);
      byStudent.set(membership.student_id, forStudent);
    }
  }

  return {
    byStudent: Object.fromEntries([...byStudent].map(([id, classIds]) => [id, [...classIds]])),
    pedagogicalClassIds: [...pedagogicalClasses],
  };
}

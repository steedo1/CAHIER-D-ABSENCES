import {
  parseSchoolCyclesSettings, type SchoolCycle, type SchoolCyclesSettings, type TeachingTrack,
} from "@/lib/school-cycles";
import {
  expandPedagogicalEnrollments, programsForStudent, readStudentProgramSettings,
  type ActiveProgramEnrollment, type ActiveProgramClass,
} from "@/lib/school-student-programs";

export type DirectorClass = ActiveProgramClass & {
  label: string;
  academic_year: string;
};

export type DirectorClassScope = {
  cycle: SchoolCycle;
  track: TeachingTrack;
  classId: string;
};

/**
 * All checks are based on verified institutional configuration and a
 * server-authenticated director's teaching track. A URL query cannot broaden
 * the role. An unmapped or stale class always stays hidden.
 */
export function listDirectorClasses(
  settingsJson: unknown,
  academicYear: string,
  track: TeachingTrack,
  classes: readonly DirectorClass[],
): Array<DirectorClass & { cycle: SchoolCycle }> {
  const school = parseSchoolCyclesSettings(settingsJson);
  if (!school.enabled) return [];
  const policies = readStudentProgramSettings(settingsJson).years[academicYear]?.classes;
  return classes.flatMap(row => {
    const cycle = school.classCycleById[row.id];
    if (!cycle || row.academic_year !== academicYear ||
      !school.enabledCycles.includes(cycle) ||
      !school.teachingTracksByCycle[cycle]?.includes(track) ||
      !policies?.[row.id]?.tracks.includes(track)) return [];
    return [{ ...row, cycle }];
  });
}

/** Security filter includes linked students without creating duplicate enrolments. */
export function directorStudentMembership(
  settingsJson: unknown,
  year: string,
  track: TeachingTrack,
  allClasses: readonly DirectorClass[],
  enrollments: readonly ActiveProgramEnrollment[],
): Array<{ classId: string; studentId: string; cycle: SchoolCycle }> {
  const school = parseSchoolCyclesSettings(settingsJson);
  const yearPolicy = readStudentProgramSettings(settingsJson).years[year];
  const allowed = listDirectorClasses(settingsJson, year, track, allClasses);
  const allowedIds = new Set(allowed.map(row => row.id));
  const cycleById = new Map(allowed.map(row => [row.id, row.cycle]));
  // Linked pupil verification requires ALL classes of the school/year so the
  // actual administrative home class can be checked before projection.
  const all = allClasses.filter(row =>
    row.academic_year === year && school.classCycleById[row.id] &&
    school.enabledCycles.includes(school.classCycleById[row.id]));
  const expanded = expandPedagogicalEnrollments(
    school, yearPolicy,
    all.map(row => ({ id: row.id, level: row.level, cycle: school.classCycleById[row.id] })),
    enrollments,
  );
  const found = new Set<string>();
  const result: Array<{ classId: string; studentId: string; cycle: SchoolCycle }> = [];
  for (const row of expanded) {
    if (!allowedIds.has(row.class_id)) continue;
    const cycle = cycleById.get(row.class_id);
    if (!cycle) continue;
    const permitted = programsForStudent(
      yearPolicy?.classes[row.class_id], row.student_id,
      school.teachingTracksByCycle[cycle] || [],
    );
    if (!permitted.includes(track)) continue;
    const unique = row.class_id + ":" + row.student_id;
    if (found.has(unique)) continue;
    found.add(unique);
    result.push({ classId: row.class_id, studentId: row.student_id, cycle });
  }
  return result;
}

/** Shared-subject access is explicit; no inference from class name or language. */
export function directorSubjectPermitted(
  school: SchoolCyclesSettings,
  cycle: SchoolCycle,
  track: TeachingTrack,
  canonicalSubjectId: string,
): boolean {
  return school.enabled && school.enabledCycles.includes(cycle) &&
    school.teachingTracksByCycle[cycle]?.includes(track) === true &&
    school.subjectTracksByCycle[cycle]?.[canonicalSubjectId]?.includes(track) === true;
}

export function directorClassPermitted(
  settingsJson: unknown, year: string, track: TeachingTrack,
  classes: readonly DirectorClass[], classId: string,
): boolean {
  return listDirectorClasses(settingsJson, year, track, classes).some(row => row.id === classId);
}

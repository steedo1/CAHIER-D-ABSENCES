import {
  isTeachingTrack,
  type SchoolCycle,
  type SchoolCyclesSettings,
  type TeachingTrack,
} from "./school-cycles";

export const SCHOOL_STUDENT_PROGRAMS_KEY = "school_student_programs_v1" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

/** Administrative class and enrollment remain the single source of identity. */
export type StudentProgramClassPolicy = {
  /** No default if empty; never infer a language from the class name. */
  tracks: TeachingTrack[];
  /** Only exceptions to the class default; a student can follow both. */
  students: Record<string, TeachingTrack[]>;
};
export type StudentProgramYear = { classes: Record<string, StudentProgramClassPolicy> };
export type StudentProgramSettings = { version: 1; years: Record<string, StudentProgramYear> };
export type ActiveProgramClass = { id: string; cycle: SchoolCycle };
export type ActiveProgramEnrollment = { class_id: string; student_id: string; end_date?: string | null };
export type ProgramRoster = Record<SchoolCycle, Record<TeachingTrack, {
  students: number;
  classes: number;
  /** Unknown students prevent reporting a supposedly complete program total. */
  complete: boolean;
  unclassifiedStudents: number;
}>>;

export function isBilingualSchool(school: SchoolCyclesSettings): boolean {
  return school.enabled && school.enabledCycles.some(cycle =>
    school.teachingTracksByCycle[cycle]?.includes("arabic"));
}

export function normalizedProgramTracks(value: unknown): TeachingTrack[] | null {
  if (!Array.isArray(value) || value.length > 2 || !value.every(isTeachingTrack)) return null;
  return [...new Set(value)] as TeachingTrack[];
}

/** Limits prevent unbounded JSON configuration or untrusted key paths. */
export function readStudentProgramSettings(value: unknown): StudentProgramSettings {
  const root = asRecord(value);
  const stored = asRecord(root?.[SCHOOL_STUDENT_PROGRAMS_KEY]);
  const yearsRoot = asRecord(stored?.years);
  const years: StudentProgramSettings["years"] = {};
  if (stored?.version !== 1 || !yearsRoot) return { version: 1, years };
  for (const [year, yearValue] of Object.entries(yearsRoot).slice(0, 6)) {
    if (!/^[0-9]{4}[-/_][0-9]{4}$/.test(year)) continue;
    const classRoot = asRecord(asRecord(yearValue)?.classes);
    if (!classRoot) continue;
    const classes: StudentProgramYear["classes"] = {};
    for (const [classId, classValue] of Object.entries(classRoot).slice(0, 500)) {
      if (!UUID.test(classId)) continue;
      const policy = asRecord(classValue);
      const tracks = normalizedProgramTracks(policy?.tracks);
      if (!tracks) continue;
      const studentRoot = asRecord(policy?.students);
      const students: Record<string, TeachingTrack[]> = {};
      for (const [studentId, incoming] of Object.entries(studentRoot || {}).slice(0, 700)) {
        const studentTracks = normalizedProgramTracks(incoming);
        if (UUID.test(studentId) && studentTracks?.length) students[studentId] = studentTracks;
      }
      classes[classId] = { tracks, students };
    }
    years[year] = { classes };
  }
  return { version: 1, years };
}

/** Override wins; no implicit assignment for unmapped classes. */
export function programsForStudent(
  policy: StudentProgramClassPolicy | undefined,
  studentId: string,
  allowed: readonly TeachingTrack[],
): TeachingTrack[] {
  if (!policy) return [];
  const tracks = policy.students[studentId] || policy.tracks;
  return tracks.filter(track => allowed.includes(track));
}

/**
 * Read-only, deduplicated authoritative counts. The caller MUST have already
 * checked institution_id and active academic_year for classes and enrollments.
 * An unmapped student's program remains unknown rather than counting as 0.
 */
export function aggregateStudentProgramRoster(
  school: SchoolCyclesSettings,
  yearPolicy: StudentProgramYear | undefined,
  classes: readonly ActiveProgramClass[],
  enrollments: readonly ActiveProgramEnrollment[],
): ProgramRoster {
  const classesById = new Map(classes.map(row => [row.id, row.cycle]));
  const members = new Map<SchoolCycle, Map<string, Set<TeachingTrack>>>();
  const unassigned = new Map<SchoolCycle, Set<string>>();
  const classifiedClass = new Map<SchoolCycle, Map<TeachingTrack, Set<string>>>();
  for (const cycle of school.enabledCycles) {
    members.set(cycle, new Map());
    unassigned.set(cycle, new Set());
    classifiedClass.set(cycle, new Map([["french", new Set()], ["arabic", new Set()]]));
  }
  for (const row of classes) {
    const policy = yearPolicy?.classes[row.id];
    const allowed = school.teachingTracksByCycle[row.cycle] || [];
    if (policy) for (const track of policy.tracks) {
      if (allowed.includes(track)) classifiedClass.get(row.cycle)?.get(track)?.add(row.id);
    }
  }
  for (const row of enrollments) {
    if (row.end_date || !row.student_id) continue;
    const cycle = classesById.get(row.class_id);
    if (!cycle || !members.has(cycle)) continue;
    const tracks = programsForStudent(
      yearPolicy?.classes[row.class_id], row.student_id,
      school.teachingTracksByCycle[cycle] || [],
    );
    const record = members.get(cycle)!;
    let byStudent = record.get(row.student_id);
    if (!byStudent) { byStudent = new Set(); record.set(row.student_id, byStudent); }
    tracks.forEach(track => {
      byStudent!.add(track);
      classifiedClass.get(cycle)?.get(track)?.add(row.class_id);
    });
    if (!tracks.length) unassigned.get(cycle)!.add(row.student_id);
  }
  const out = {} as ProgramRoster;
  for (const cycle of ["preschool", "primary", "secondary"] as const) {
    const byStudent = members.get(cycle) || new Map<string, Set<TeachingTrack>>();
    // If a person attends two classes, one unresolved membership is not
    // grounds for claiming complete classification of that person's courses.
    const missing = unassigned.get(cycle) || new Set<string>();
    const unknown = missing.size; // An unresolved enrollment stays unresolved even if another class is assigned.
    const perTrack = {} as ProgramRoster[SchoolCycle];
    for (const track of ["french", "arabic"] as const) {
      perTrack[track] = {
        students: [...byStudent.values()].filter(tracks => tracks.has(track)).length,
        classes: classifiedClass.get(cycle)?.get(track)?.size || 0,
        complete: unknown === 0 && school.enabledCycles.includes(cycle),
        unclassifiedStudents: unknown,
      };
    }
    out[cycle] = perTrack;
  }
  return out;
}

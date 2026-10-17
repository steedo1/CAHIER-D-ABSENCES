import {
  inferSchoolCycleFromLevel,
  parseSchoolCyclesSettings,
  type SchoolCycle,
  type TeachingTrack,
} from "./school-cycles";
import { readStudentProgramSettings } from "./school-student-programs";

/**
 * Actual grade_periods rows are scoped through existing formation columns.
 * These codes never overlap an ordinary formation key. The database does not
 * accept extra scope types or preschool/primary education_type values.
 */
export const SCHOOL_PERIOD_SCOPE_TYPE = "formation";
export const SCHOOL_PERIOD_EDUCATION_TYPE = "general_secondary";

export function schoolPeriodFormationCode(cycle: SchoolCycle, track: TeachingTrack): string {
  return `SCHOOL_PROGRAM_${cycle.toUpperCase()}_${track.toUpperCase()}`;
}

/** Existing unique index is (institution_id, academic_year, code). */
export function schoolPeriodStoredCode(cycle: SchoolCycle, track: TeachingTrack, displayCode: string): string {
  return `${schoolPeriodFormationCode(cycle, track)}_${displayCode.toUpperCase()}`;
}

export function normalizedSchoolPeriodCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(value) ? value : null;
}

/**
 * Only an explicitly mapped, single-teaching class may use scoped periods.
 * Never infer French/Arabic from the classroom label or the student's identity.
 */
export function schoolPeriodProgramForClass(
  rawSettings: unknown,
  academicYear: string,
  schoolClass: { id: string; level?: string | null },
): { cycle: SchoolCycle; track: TeachingTrack } | null {
  const school = parseSchoolCyclesSettings(rawSettings);
  if (!school.enabled) return null;
  const cycle = school.classCycleById[schoolClass.id] ||
    inferSchoolCycleFromLevel(schoolClass.level);
  if (!cycle || !school.enabledCycles.includes(cycle)) return null;
  const tracks = readStudentProgramSettings(rawSettings)
    .years[academicYear]?.classes[schoolClass.id]?.tracks || [];
  if (tracks.length !== 1 || !school.teachingTracksByCycle[cycle]?.includes(tracks[0])) return null;
  return { cycle, track: tracks[0] };
}

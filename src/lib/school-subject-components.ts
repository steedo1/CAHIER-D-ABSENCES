import { inferSchoolCycleFromLevel, parseSchoolCyclesSettings, type SchoolCycle, type TeachingTrack } from "./school-cycles";
import { normalizeSchoolLevel, sameSchoolLevel } from "./school-levels";
import { readStudentProgramSettings } from "./school-student-programs";
import { classSubjectIds } from "./school-class-subjects";

export type ComponentClass = { id: string; level?: string | null; academic_year?: string | null };
export type ComponentContext = { cycle: SchoolCycle; track: TeachingTrack; level: string; storageLevel: string };
export type SubjectComponent = {
  id: string; subject_id: string; level: string | null; code: string; label: string;
  short_label?: string | null; coeff_in_subject: number; order_index: number; is_active: boolean;
};
const PREFIX = "program:v1:";
export const isProgramComponentLevel = (level: unknown) => String(level || "").startsWith(PREFIX);

/** Secondary teaching keys in the existing text column, no schema change. Historical secondary French keys stay intact. */
export function componentStorageLevel(cycle: SchoolCycle, track: TeachingTrack, level: string) {
  const normalized = normalizeSchoolLevel(level, cycle);
  return cycle === "secondary" && track === "french" ? normalized
    : `${PREFIX}${cycle}:${track}:${normalized}`;
}

/** Resolve from the persisted class program, never a client-provided language. */
export function classComponentContext(settings: unknown, cls: ComponentClass, subjectId: string):
  ComponentContext | "legacy" | "invalid" {
  const school = parseSchoolCyclesSettings(settings);
  if (!school.enabled) return "legacy";
  const cycle = school.classCycleById[cls.id] || inferSchoolCycleFromLevel(cls.level);
  // Primary and preschool retain their existing behavior, outside this correction.
  if (cycle === "primary" || cycle === "preschool") return "legacy";
  if (!cycle || !cls.level || !cls.academic_year ||
      !school.enabledCycles.includes(cycle)) return "invalid";
  const policy = readStudentProgramSettings(settings).years[cls.academic_year]?.classes[cls.id];
  const mapped = school.subjectTracksByCycle[cycle]?.[subjectId] || [];
  const tracks = (policy?.tracks || mapped).filter(track => mapped.includes(track) &&
    school.teachingTracksByCycle[cycle]?.includes(track));
  const curriculum = classSubjectIds(settings, cls.academic_year, cls.id);
  if (tracks.length !== 1 || (curriculum !== null && !curriculum.includes(subjectId))) return "invalid";
  const track = tracks[0], level = normalizeSchoolLevel(cls.level, cycle);
  return { cycle, track, level, storageLevel: componentStorageLevel(cycle, track, level) };
}

/** No global/French fallback in secondary Arabic, including common subjects. */
export function selectProgramComponents<T extends { level: string | null; is_active?: boolean | null }>(
  rows: readonly T[], context: ComponentContext,
): T[] {
  const active = rows.filter(row => row.is_active !== false);
  if (context.cycle !== "secondary" || context.track !== "french")
    return active.filter(row => row.level === context.storageLevel);
  const legacy = active.filter(row => !isProgramComponentLevel(row.level));
  const exact = legacy.filter(row => sameSchoolLevel(row.level, context.level, context.cycle));
  return exact.length ? exact : legacy.filter(row => !row.level);
}

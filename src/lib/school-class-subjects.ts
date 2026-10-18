import type { SchoolCycle, TeachingTrack } from "./school-cycles";

export const SCHOOL_CLASS_SUBJECTS_KEY = "school_class_subjects_v1" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClassSubjects = Record<string, string[]>;
export type SchoolClassSubjectsSettings = {
  version: 1;
  years: Record<string, { classes: ClassSubjects; ciPrimaryFrenchClasses?: string[] }>;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

/**
 * Explicit class curriculum: one institution, year, physical class and teaching.
 * The source of the subject's cycle/track remains school_cycles_v1.
 * Never infer subject membership merely from a class level or a coefficient.
 */
export function readClassSubjects(value: unknown): SchoolClassSubjectsSettings | null {
  const settings = object(value);
  if (!settings || !Object.hasOwn(settings, SCHOOL_CLASS_SUBJECTS_KEY)) return null;
  const root = object(settings[SCHOOL_CLASS_SUBJECTS_KEY]);
  const yearsRoot = object(root?.years);
  if (root?.version !== 1 || !yearsRoot) return { version: 1, years: {} };
  const years: SchoolClassSubjectsSettings["years"] = {};
  for (const [year, yearValue] of Object.entries(yearsRoot).slice(0, 8)) {
    if (!/^[0-9]{4}[-/_][0-9]{4}$/.test(year)) continue;
    const rawClasses = object(object(yearValue)?.classes);
    if (!rawClasses) continue;
    const classes: ClassSubjects = {};
    for (const [classId, subjects] of Object.entries(rawClasses).slice(0, 500)) {
      if (!UUID.test(classId) || !Array.isArray(subjects) || subjects.length > 150 ||
          !subjects.every(id => typeof id === "string" && UUID.test(id))) continue;
      classes[classId] = [...new Set(subjects)];
    }
    const applied = object(yearValue)?.ciPrimaryFrenchClasses;
    const ciPrimaryFrenchClasses = Array.isArray(applied)
      ? [...new Set(applied.filter((id): id is string => typeof id === "string" && UUID.test(id)))].slice(0, 500)
      : [];
    years[year] = { classes, ...(ciPrimaryFrenchClasses.length ? { ciPrimaryFrenchClasses } : {}) };
  }
  return { version: 1, years };
}

/** Null = this school has no class-curriculum feature yet (legacy behavior).
 * [] = feature enabled but this class/year is unconfigured (never guess).
 */
export function classSubjectIds(
  settings: unknown, academicYear: string, classId: string,
): string[] | null {
  const stored = readClassSubjects(settings);
  if (!stored) return null;
  return stored.years[academicYear]?.classes[classId] || [];
}

export function subjectAllowedInClass(
  cycle: SchoolCycle, track: TeachingTrack, subjectId: string,
  configured: Record<SchoolCycle, Record<string, TeachingTrack[]>>,
): boolean {
  return configured[cycle]?.[subjectId]?.includes(track) === true;
}

/** Explicit opt-in stored WITH the existing class curriculum (not a second catalogue). */
export function hasCiPrimaryFrenchReference(settings: unknown, year: string, classId: string): boolean {
  return readClassSubjects(settings)?.years[year]?.ciPrimaryFrenchClasses?.includes(classId) === true;
}

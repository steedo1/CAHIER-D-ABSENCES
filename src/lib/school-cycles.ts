/**
 * School cycles describe the age/grade section of a school.
 *
 * Keep this separate from EducationType: the existing education_type column
 * represents secondary/technical/vocational tracks and has a DB CHECK.
 *
 * Opt-in by institution only. Absent settings retain historical secondary
 * behavior, so this module cannot reclassify CSCA or other current schools.
 * This contract is deliberately independent of database writes.
 */
export const SCHOOL_CYCLES_SETTINGS_KEY = "school_cycles_v1" as const;

export const SCHOOL_CYCLE_OPTIONS = [
  { id: "preschool", label: "Préscolaire", shortLabel: "Préscolaire" },
  { id: "primary", label: "Primaire", shortLabel: "Primaire" },
  { id: "secondary", label: "Secondaire", shortLabel: "Secondaire" },
] as const;

export type SchoolCycle = (typeof SCHOOL_CYCLE_OPTIONS)[number]["id"];
export type SchoolLanguage = "fr" | "ar";
export type TeachingTrack = "french" | "arabic";
export const TEACHING_TRACK_OPTIONS = [
  { id: "french", label: "Enseignement français" },
  { id: "arabic", label: "Enseignement arabe" },
] as const;
export function isTeachingTrack(value: unknown): value is TeachingTrack {
  return value === "french" || value === "arabic";
}

export type SchoolCyclesSettings = {
  version: 1;
  /** Entirely opt-in; false is the legacy behavior. */
  enabled: boolean;
  enabledCycles: SchoolCycle[];
  /** Explicit override keyed by the UUID of a class of THIS institution. */
  classCycleById: Record<string, SchoolCycle>;
  /** Teaching programs offered per enabled cycle; not user interface languages. */
  teachingTracksByCycle: Partial<Record<SchoolCycle, TeachingTrack[]>>;
  /** Default landing view for an eligible school administrator. */
  defaultView: "all" | SchoolCycle;
  /** A preference only. It does not imply translated/RTL pages exist yet. */
  preferredLanguage: SchoolLanguage;
};

export type SchoolCycleClass = {
  id: string;
  institution_id: string;
  academic_year: string;
  level?: string | null;
};

const CLASS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isSchoolCycle(value: unknown): value is SchoolCycle {
  return value === "preschool" || value === "primary" || value === "secondary";
}

export function getDefaultSchoolCyclesSettings(): SchoolCyclesSettings {
  return {
    version: 1,
    enabled: false,
    enabledCycles: ["secondary"],
    classCycleById: {},
    teachingTracksByCycle: {},
    defaultView: "all",
    preferredLanguage: "fr",
  };
}

export function parseSchoolCyclesSettings(settingsJson: unknown): SchoolCyclesSettings {
  const fallback = getDefaultSchoolCyclesSettings();
  if (!isRecord(settingsJson)) return fallback;

  const stored = settingsJson[SCHOOL_CYCLES_SETTINGS_KEY];
  if (!isRecord(stored) || stored.version !== 1 || stored.enabled !== true) {
    return fallback;
  }

  const enabledCycles = Array.isArray(stored.enabledCycles)
    ? Array.from(new Set(stored.enabledCycles.filter(isSchoolCycle)))
    : [];

  // Reject incomplete or invalid activation settings.
  if (enabledCycles.length === 0) return fallback;

  const classCycleById: Record<string, SchoolCycle> = {};
  if (isRecord(stored.classCycleById)) {
    for (const [id, cycle] of Object.entries(stored.classCycleById)) {
      if (
        CLASS_ID_PATTERN.test(id) &&
        isSchoolCycle(cycle) &&
        enabledCycles.includes(cycle)
      ) {
        classCycleById[id] = cycle;
      }
    }
  }

  const teachingTracksByCycle: Partial<Record<SchoolCycle, TeachingTrack[]>> = {};
  const rawTracks = isRecord(stored.teachingTracksByCycle)
    ? stored.teachingTracksByCycle
    : {};
  for (const cycle of enabledCycles) {
    const configured = rawTracks[cycle];
    const accepted = Array.isArray(configured)
      ? Array.from(new Set(configured.filter(isTeachingTrack)))
      : [];
    teachingTracksByCycle[cycle] = accepted.length ? accepted : ["french"];
  }

  const defaultView =
    stored.defaultView === "all" ||
    (isSchoolCycle(stored.defaultView) && enabledCycles.includes(stored.defaultView))
      ? stored.defaultView
      : "all";

  return {
    version: 1,
    enabled: true,
    enabledCycles,
    classCycleById,
    teachingTracksByCycle,
    defaultView,
    preferredLanguage: stored.preferredLanguage === "ar" ? "ar" : "fr",
  };
}

/**
 * Auto-detect only the unambiguous national level codes.
 * For nonstandard/franco-Arabic levels, configure classCycleById explicitly.
 */
export function inferSchoolCycleFromLevel(level: unknown): SchoolCycle | null {
  const normalized = String(level || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s_-]+/g, "");

  if (/^(PS|MS|GS|MATERNELLE)$/.test(normalized)) return "preschool";
  if (/^(PETITESECTION|MOYENNESECTION|GRANDESECTION)$/.test(normalized)) {
    return "preschool";
  }
  if (/^(CP[12]|CE[12]|CM[12])$/.test(normalized)) return "primary";
  return null;
}

/**
 * Fallback remains secondary for every institution without explicit opt-in.
 */
export function resolveSchoolCycleForClass(
  schoolClass: Pick<SchoolCycleClass, "id" | "level">,
  settings: SchoolCyclesSettings,
): SchoolCycle {
  if (!settings.enabled) return "secondary";

  const assigned = settings.classCycleById[schoolClass.id];
  if (assigned && settings.enabledCycles.includes(assigned)) return assigned;

  const inferred = inferSchoolCycleFromLevel(schoolClass.level);
  if (inferred && settings.enabledCycles.includes(inferred)) return inferred;

  return "secondary";
}

/**
 * Defense in depth: callers still MUST scope database queries and authorization
 * by institution_id and academic_year before passing rows here.
 */
export function groupScopedClassesByCycle(
  rows: SchoolCycleClass[],
  institutionId: string,
  academicYear: string,
  settings: SchoolCyclesSettings,
): Record<SchoolCycle, SchoolCycleClass[]> {
  const groups: Record<SchoolCycle, SchoolCycleClass[]> = {
    preschool: [],
    primary: [],
    secondary: [],
  };

  for (const row of rows) {
    if (row.institution_id !== institutionId || row.academic_year !== academicYear) continue;
    groups[resolveSchoolCycleForClass(row, settings)].push(row);
  }
  return groups;
}

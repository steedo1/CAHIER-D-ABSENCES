import type { TeachingTrack } from "./school-cycles";

/** Administrative signatories ONLY: no accounts, roles, login or permissions. */
export const SCHOOL_TEACHING_SIGNATORIES_KEY = "school_teaching_signatories_v1" as const;
export const SCHOOL_TEACHING_DIRECTOR_TITLE = "Directeur des études" as const;
export type TeachingSignatory = { name: string };
export type TeachingSignatories = Partial<Record<TeachingTrack, TeachingSignatory>>;
const TRACKS: TeachingTrack[] = ["french", "arabic"];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validSignatoryName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length >= 3 &&
    name.trim().length <= 120 && !/[\x00-\x1F\x7F]/.test(name);
}

/** Only the two fixed school positions are read. Never manufacture a signature. */
export function readSchoolTeachingSignatories(settingsJson: unknown): TeachingSignatories {
  if (!record(settingsJson)) return {};
  const stored = settingsJson[SCHOOL_TEACHING_SIGNATORIES_KEY];
  if (!record(stored) || stored.version !== 1) return {};
  const result: TeachingSignatories = {};
  for (const track of TRACKS) {
    const entry = stored[track];
    if (record(entry) && validSignatoryName(entry.name)) {
      result[track] = { name: entry.name.trim() };
    }
  }
  return result;
}

/** Keep every unrelated institutional setting untouched. Empty name = vacate position. */
export function setSchoolTeachingSignatory(
  rawSettings: unknown, track: TeachingTrack, name: string,
): Record<string, unknown> {
  const settings = record(rawSettings) ? rawSettings : {};
  const previous = readSchoolTeachingSignatories(settings);
  const normalized = name.trim();
  const next: TeachingSignatories = { ...previous };
  if (normalized) next[track] = { name: normalized };
  else delete next[track];
  return { ...settings, [SCHOOL_TEACHING_SIGNATORIES_KEY]: { version: 1, ...next } };
}

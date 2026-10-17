import { getDefaultSchoolCyclesSettings, isSchoolCycle, isTeachingTrack, type SchoolCycle, type SchoolCyclesSettings, type TeachingTrack } from "./school-cycles";

/** Initial provisioning accepts no subjects, coefficients or administrative IDs. */
export function validateNewSchoolCycles(value: unknown): SchoolCyclesSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["enabled", "enabledCycles", "teachingTracksByCycle"].includes(key))) return null;
  if (typeof input.enabled !== "boolean") return null;
  if (!input.enabled) return getDefaultSchoolCyclesSettings();
  if (!Array.isArray(input.enabledCycles) || !input.enabledCycles.length || !input.enabledCycles.every(isSchoolCycle)) return null;
  const enabledCycles = [...new Set(input.enabledCycles as SchoolCycle[])];
  if (!input.teachingTracksByCycle || typeof input.teachingTracksByCycle !== "object" || Array.isArray(input.teachingTracksByCycle)) return null;
  const tracks = input.teachingTracksByCycle as Record<string, unknown>;
  if (Object.keys(tracks).some(key => !enabledCycles.includes(key as SchoolCycle))) return null;
  const teachingTracksByCycle: SchoolCyclesSettings["teachingTracksByCycle"] = {};
  for (const cycle of enabledCycles) {
    const allowed = tracks[cycle];
    if (!Array.isArray(allowed) || !allowed.length || !allowed.every(isTeachingTrack)) return null;
    teachingTracksByCycle[cycle] = [...new Set(allowed as TeachingTrack[])];
  }
  return { ...getDefaultSchoolCyclesSettings(), enabled: true, enabledCycles, teachingTracksByCycle };
}

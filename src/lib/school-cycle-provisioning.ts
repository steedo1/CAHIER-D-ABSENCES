import {
  SCHOOL_CYCLES_SETTINGS_KEY,
  parseSchoolCyclesSettings,
  isSchoolCycle,
  isTeachingTrack,
  type SchoolCyclesSettings,
} from "./school-cycles";

/** The platform provisions cycles; it never owns curricular assignments. */
export function mergeSchoolCycleProvisioning(
  settingsJson: Record<string, unknown>,
  incoming: SchoolCyclesSettings,
): Record<string, unknown> {
  const raw = settingsJson[SCHOOL_CYCLES_SETTINGS_KEY];
  const stored = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  if (!incoming.enabled) {
    return { ...settingsJson, [SCHOOL_CYCLES_SETTINGS_KEY]: { ...incoming, ...stored, version: 1, enabled: false } };
  }
  const previouslyEnabled = Array.isArray(stored.enabledCycles) ? stored.enabledCycles : [];
  return {
    ...settingsJson,
    [SCHOOL_CYCLES_SETTINGS_KEY]: {
      ...stored,
      ...incoming,
      teachingTracksByCycle: { ...asRecord(stored.teachingTracksByCycle), ...incoming.teachingTracksByCycle },
      classCycleById: {
        ...Object.fromEntries(Object.entries(asRecord(stored.classCycleById))
          .filter(([, cycle]) => isSchoolCycle(cycle) &&
            (!incoming.enabledCycles.includes(cycle) || !previouslyEnabled.includes(cycle)))),
        ...incoming.classCycleById,
      },
      // Retain even currently disabled cycles/tracks in storage. The runtime
      // parser hides them. Re-enabling a program restores its classifications.
      subjectTracksByCycle: stored.subjectTracksByCycle ?? {},
    },
  };
}

export function readSchoolCycleProvisioning(settingsJson: unknown): SchoolCyclesSettings {
  const root = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson)
    ? settingsJson as Record<string, unknown> : {};
  const raw = root[SCHOOL_CYCLES_SETTINGS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return parseSchoolCyclesSettings(settingsJson);
  }
  const stored = raw as Record<string, unknown>;
  const editable = parseSchoolCyclesSettings({
    [SCHOOL_CYCLES_SETTINGS_KEY]: { ...stored, enabled: true },
  });
  const teachingTracksByCycle = { ...editable.teachingTracksByCycle };
  for (const [cycle, tracks] of Object.entries(asRecord(stored.teachingTracksByCycle))) {
    if (isSchoolCycle(cycle) && Array.isArray(tracks) && !editable.enabledCycles.includes(cycle)) {
      const valid = tracks.filter(isTeachingTrack);
      if (valid.length) teachingTracksByCycle[cycle] = [...new Set(valid)];
    }
  }
  return { ...editable, teachingTracksByCycle, enabled: stored.enabled === true && editable.enabled };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

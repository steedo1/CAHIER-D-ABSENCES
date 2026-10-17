import { inferSchoolCycleFromLevel, isSchoolCycle, parseSchoolCyclesSettings } from "./school-cycles";

export const EARLY_SCHOOL_LEVELS = {
  preschool: ["PS", "MS", "GS"],
  primary: ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"],
} as const;

/** Extends the existing classes table without inventing new education_type enum
 * values or applying secondary series to early cycles. Nonstandard levels need
 * an explicit class mapping before use and are not guessed by the creator. */
export function validateSchoolClassCycle(settingsJson: unknown, requested: unknown, level: string): string | null {
  const school = parseSchoolCyclesSettings(settingsJson);
  if (!isSchoolCycle(requested) || !school.enabled || !school.enabledCycles.includes(requested)) return "school_cycle_not_enabled";
  if (requested === "preschool" || requested === "primary") {
    return inferSchoolCycleFromLevel(level) === requested ? null : "level_outside_school_cycle";
  }
  const inferred = inferSchoolCycleFromLevel(level);
  return inferred && inferred !== requested ? "level_outside_school_cycle" : null;
}

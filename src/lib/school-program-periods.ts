import {
  isSchoolCycle, isTeachingTrack,
  type SchoolCycle, type TeachingTrack,
} from "@/lib/school-cycles";

export const SCHOOL_PROGRAM_PERIODS_KEY = "school_program_periods_v1" as const;
export type ProgramPeriod = {
  code: string;
  label: string;
  shortLabel: string;
  kind: "trimester" | "semester" | "composition" | "sequence" | "other";
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  /** Weight is only meaningful in the established secondary-school engine. */
  weight?: number;
};
export type ProgramPeriods = {
  version: 1;
  years: Record<string, Partial<Record<SchoolCycle, Partial<Record<TeachingTrack, ProgramPeriod[]>>>>>;
};
export const EMPTY_PROGRAM_PERIODS: ProgramPeriods = { version: 1, years: {} };

const YEAR = /^20\d{2}-20\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Za-z0-9_-]{1,18}$/;
const KINDS = new Set(["trimester", "semester", "composition", "sequence", "other"]);
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function validDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const time = Date.parse(value + "T12:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function validateProgramPeriods(cycle: SchoolCycle, value: unknown): ProgramPeriod[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const seen = new Set<string>();
  const result: ProgramPeriod[] = [];
  for (const raw of value) {
    const row = record(raw);
    if (!row || typeof row.code !== "string" || !CODE.test(row.code) ||
      typeof row.label !== "string" || !row.label.trim() || row.label.length > 100 ||
      typeof row.shortLabel !== "string" || !row.shortLabel.trim() || row.shortLabel.length > 45 ||
      !KINDS.has(String(row.kind)) || typeof row.active !== "boolean" ||
      !validDate(row.startDate) || !validDate(row.endDate) ||
      (row.startDate && row.endDate && row.startDate > row.endDate) ||
      seen.has(row.code.toUpperCase())) return null;
    if (row.weight !== undefined &&
      (cycle !== "secondary" || typeof row.weight !== "number" ||
       !Number.isFinite(row.weight) || row.weight < 0 || row.weight > 100)) return null;
    seen.add(row.code.toUpperCase());
    result.push({
      code: row.code.toUpperCase(), label: row.label.trim(),
      shortLabel: row.shortLabel.trim(), kind: row.kind as ProgramPeriod["kind"],
      startDate: row.startDate, endDate: row.endDate, active: row.active,
      ...(cycle === "secondary" && row.weight !== undefined ? { weight: row.weight } : {}),
    });
  }
  return result;
}

/** All settings are keyed by institution (outer JSON), academic year, cycle, and track. */
export function readProgramPeriods(value: unknown): ProgramPeriods {
  const original = record(record(value)?.[SCHOOL_PROGRAM_PERIODS_KEY]);
  const years = record(original?.years);
  const result: ProgramPeriods = { version: 1, years: {} };
  if (original?.version !== 1 || !years) return result;
  for (const [year, rawYear] of Object.entries(years).slice(0, 8)) {
    if (!YEAR.test(year)) continue;
    const values = record(rawYear);
    if (!values) continue;
    const byCycle: ProgramPeriods["years"][string] = {};
    for (const [cycle, rawCycle] of Object.entries(values)) {
      if (!isSchoolCycle(cycle)) continue;
      const byTrack: Partial<Record<TeachingTrack, ProgramPeriod[]>> = {};
      for (const [track, periods] of Object.entries(record(rawCycle) || {})) {
        if (!isTeachingTrack(track)) continue;
        const validated = validateProgramPeriods(cycle, periods);
        if (validated) byTrack[track] = validated;
      }
      byCycle[cycle] = byTrack;
    }
    result.years[year] = byCycle;
  }
  return result;
}

export function periodsForProgram(
  settings: unknown, year: string, cycle: SchoolCycle, track: TeachingTrack,
): ProgramPeriod[] {
  return readProgramPeriods(settings).years[year]?.[cycle]?.[track] || [];
}

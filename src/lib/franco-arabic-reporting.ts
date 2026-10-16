import {
  isSchoolCycle, isTeachingTrack,
  type SchoolCycle, type TeachingTrack,
} from "@/lib/school-cycles";

/**
 * Francophone / Arabic report preparation contract. Does not alter grades,
 * coefficients, the legacy bulletin engine or any existing school.
 * Enabled only by a super admin for an explicitly configured school.
 */
export const FRANCO_ARABIC_REPORTS_SETTINGS_KEY = "franco_arabic_reports_v1" as const;
export const REPORT_FORMATS = ["separate", "combined", "both"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export type LevelScoringScale = {
  cycle: SchoolCycle;
  /** School-defined level label, e.g. CP1 or CM2. */
  level: string;
  track: TeachingTrack;
  /** Evaluation's maximum score, e.g. 10 or 20. */
  maxScore: number;
};

export type FrancoArabicReportsSettings = {
  version: 1;
  enabled: boolean;
  format: ReportFormat;
  scales: LevelScoringScale[];
};

export function defaultFrancoArabicReportsSettings(): FrancoArabicReportsSettings {
  return { version: 1, enabled: false, format: "separate", scales: [] };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function isReportFormat(value: unknown): value is ReportFormat {
  return value === "separate" || value === "combined" || value === "both";
}

function normalizedLevel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const level = value.trim().replace(/\s+/g, " ");
  return level.length >= 1 && level.length <= 60 ? level : null;
}

export function parseFrancoArabicReportsSettings(
  settingsJson: unknown,
): FrancoArabicReportsSettings {
  const fallback = defaultFrancoArabicReportsSettings();
  const outer = asObject(settingsJson);
  const stored = outer && asObject(outer[FRANCO_ARABIC_REPORTS_SETTINGS_KEY]);
  if (!stored || stored.version !== 1 || stored.enabled !== true) return fallback;
  return validateFrancoArabicReportsInput(stored) || fallback;
}

/** Strict input validation: fail closed rather than partly save a bulletin policy. */
export function validateFrancoArabicReportsInput(
  input: unknown,
): FrancoArabicReportsSettings | null {
  const data = asObject(input);
  if (!data || typeof data.enabled !== "boolean" ||
      !isReportFormat(data.format) || !Array.isArray(data.scales) ||
      data.scales.length > 120) return null;
  if (!data.enabled) return defaultFrancoArabicReportsSettings();
  const seen = new Set<string>();
  const scales: LevelScoringScale[] = [];
  for (const raw of data.scales) {
    const entry = asObject(raw);
    if (!entry || !isSchoolCycle(entry.cycle) ||
        !isTeachingTrack(entry.track) ||
        !Number.isInteger(entry.maxScore) ||
        (entry.maxScore as number) < 1 || (entry.maxScore as number) > 100) return null;
    const level = normalizedLevel(entry.level);
    if (!level) return null;
    const key = [entry.cycle, level.toLocaleLowerCase("fr"), entry.track].join("|");
    if (seen.has(key)) return null;
    seen.add(key);
    scales.push({
      cycle: entry.cycle,
      level,
      track: entry.track,
      maxScore: entry.maxScore as number,
    });
  }
  return { version: 1, enabled: true, format: data.format, scales };
}

export function getConfiguredScoringScale(
  settings: FrancoArabicReportsSettings,
  cycle: SchoolCycle,
  level: string,
  track: TeachingTrack,
): number | null {
  if (!settings.enabled) return null;
  const normalized = normalizedLevel(level);
  if (!normalized) return null;
  return settings.scales.find((entry) =>
    entry.cycle === cycle && entry.track === track &&
    entry.level.toLocaleLowerCase("fr") === normalized.toLocaleLowerCase("fr"))?.maxScore ?? null;
}

/**
 * Convert a score between two scales for display only. The source value and
 * original denominator remain unchanged in the database.
 * Do NOT convert the final mean without applying subject-specific coefficients.
 */
export function convertScoreScale(
  score: number, fromScale: number, toScale: number,
): number | null {
  if (![score, fromScale, toScale].every(Number.isFinite) ||
      fromScale <= 0 || toScale <= 0 ||
      score < 0 || score > fromScale) return null;
  return Math.round((score / fromScale) * toScale * 100) / 100;
}

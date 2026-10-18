import {
  isSchoolCycle, isTeachingTrack,
  type SchoolCycle, type TeachingTrack,
} from "@/lib/school-cycles";
import { normalizeSchoolLevel, schoolLevelKey } from "./school-levels";

/**
 * Francophone / Arabic report preparation contract. Does not alter grades,
 * coefficients, the legacy bulletin engine or any existing school.
 * Configured by the pedagogical administrator of an explicitly activated school.
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

export type SubjectReportCoefficient = {
  cycle: SchoolCycle;
  level: string;
  track: TeachingTrack;
  subjectId: string;
  coefficient: number;
  includeInAverage: boolean;
};

export type FrancoArabicReportsSettings = {
  version: 1;
  enabled: boolean;
  format: ReportFormat;
  scales: LevelScoringScale[];
  /** Each coefficient belongs to a cycle + level + teaching program + subject. */
  coefficients: SubjectReportCoefficient[];
  /** Absent in previously saved templates: keep the historical engine. */
  engine?: "legacy" | "specialized";
  /** Exactly one authority for a specialized context; never merge weights. */
  coefficientSource?: "institution" | "program";
  /** Display model chosen by the school per cycle; legacy `format` is the fallback. */
  formatsByCycle?: Partial<Record<SchoolCycle, ReportFormat>>;
};

export function defaultFrancoArabicReportsSettings(): FrancoArabicReportsSettings {
  return { version: 1, enabled: false, format: "separate", scales: [], coefficients: [] };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function isReportFormat(value: unknown): value is ReportFormat {
  return value === "separate" || value === "combined" || value === "both";
}

function normalizedLevel(value: unknown, cycle: SchoolCycle): string | null {
  if (typeof value !== "string") return null;
  const level = normalizeSchoolLevel(value, cycle);
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
  if (data.engine !== undefined && data.engine !== "legacy" && data.engine !== "specialized") return null;
  if (data.coefficientSource !== undefined && data.coefficientSource !== "institution" && data.coefficientSource !== "program") return null;
  if (!data.enabled) return defaultFrancoArabicReportsSettings();
  const formatted = data.formatsByCycle;
  const formatsByCycle: Partial<Record<SchoolCycle, ReportFormat>> = {};
  if (formatted !== undefined) {
    const values = asObject(formatted);
    if (!values || Object.keys(values).some(key => !isSchoolCycle(key) ||
        !isReportFormat(values[key]))) return null;
    for (const cycle of ["preschool", "primary", "secondary"] as const) {
      if (values[cycle] !== undefined) formatsByCycle[cycle] = values[cycle] as ReportFormat;
    }
  }
  const seen = new Set<string>();
  const scales: LevelScoringScale[] = [];
  for (const raw of data.scales) {
    const entry = asObject(raw);
    if (!entry || !isSchoolCycle(entry.cycle) ||
        !isTeachingTrack(entry.track) ||
        !Number.isInteger(entry.maxScore) ||
        (entry.maxScore as number) < 1 || (entry.maxScore as number) > 100) return null;
    const level = normalizedLevel(entry.level, entry.cycle);
    if (!level) return null;
    const key = [entry.cycle, schoolLevelKey(level, entry.cycle), entry.track].join("|");
    if (seen.has(key)) return null;
    seen.add(key);
    scales.push({
      cycle: entry.cycle,
      level,
      track: entry.track,
      maxScore: entry.maxScore as number,
    });
  }
  const rawCoefficients = data.coefficients ?? [];
  if (!Array.isArray(rawCoefficients) || rawCoefficients.length > 500) return null;
  const coefficients: SubjectReportCoefficient[] = [];
  const policySeen = new Set<string>();
  for (const raw of rawCoefficients) {
    const entry = asObject(raw);
    if (!entry || !isSchoolCycle(entry.cycle) || !isTeachingTrack(entry.track) ||
        typeof entry.subjectId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.subjectId) ||
        typeof entry.includeInAverage !== "boolean" ||
        typeof entry.coefficient !== "number" ||
        !Number.isFinite(entry.coefficient) ||
        entry.coefficient <= 0 || entry.coefficient > 100) return null;
    const level = normalizedLevel(entry.level, entry.cycle);
    if (!level) return null;
    const scalePresent = scales.some((scale) =>
      scale.cycle === entry.cycle &&
      scale.track === entry.track &&
      schoolLevelKey(scale.level, entry.cycle as SchoolCycle) === schoolLevelKey(level, entry.cycle as SchoolCycle));
    if (!scalePresent) return null;
    const key = [entry.cycle, schoolLevelKey(level, entry.cycle), entry.track, entry.subjectId].join("|");
    if (policySeen.has(key)) return null;
    policySeen.add(key);
    coefficients.push({
      cycle: entry.cycle,
      level,
      track: entry.track,
      subjectId: entry.subjectId,
      coefficient: entry.coefficient,
      includeInAverage: entry.includeInAverage,
    });
  }
  return { version: 1, enabled: true, format: data.format, scales, coefficients,
    ...(data.engine !== undefined ? { engine: data.engine } : {}),
    ...(data.coefficientSource !== undefined ? { coefficientSource: data.coefficientSource } : {}),
    ...(data.formatsByCycle !== undefined ? { formatsByCycle } : {}),
  };
}

/** Only primary/preschool accept saved model preferences.
 * Secondary layouts are fixed: legacy selections must never choose a
 * combined/new-model report, including for pre-existing franco-Arabic schools.
 * This is presentation-only; all teaching tracks and historical French
 * calculations stay on their existing authenticated paths. */
export function selectedBulletinFormat(
  reports: FrancoArabicReportsSettings,
  cycle: SchoolCycle,
): ReportFormat {
  if (cycle === "secondary") return "separate";
  return reports.formatsByCycle?.[cycle] || reports.format;
}

/** Editors can restore suspended policies; calculations still use the runtime parser. */
export function readFrancoArabicReportsForEditing(settingsJson: unknown): FrancoArabicReportsSettings {
  const outer = asObject(settingsJson);
  const stored = outer && asObject(outer[FRANCO_ARABIC_REPORTS_SETTINGS_KEY]);
  if (!stored || stored.version !== 1) return defaultFrancoArabicReportsSettings();
  const validated = validateFrancoArabicReportsInput({ ...stored, enabled: true });
  return validated ? { ...validated, enabled: stored.enabled === true } : defaultFrancoArabicReportsSettings();
}

export function getConfiguredScoringScale(
  settings: FrancoArabicReportsSettings,
  cycle: SchoolCycle,
  level: string,
  track: TeachingTrack,
): number | null {
  if (!settings.enabled) return null;
  const normalized = normalizedLevel(level, cycle);
  if (!normalized) return null;
  return settings.scales.find((entry) =>
    entry.cycle === cycle && entry.track === track &&
    schoolLevelKey(entry.level, cycle) === schoolLevelKey(normalized, cycle))?.maxScore ?? null;
}

/** No default coefficient is inferred from language, cycle or subject name. */
export function getConfiguredSubjectCoefficients(
  settings: FrancoArabicReportsSettings,
  cycle: SchoolCycle,
  level: string,
  track: TeachingTrack,
): SubjectReportCoefficient[] {
  if (!settings.enabled) return [];
  const normalized = normalizedLevel(level, cycle);
  if (!normalized) return [];
  return settings.coefficients.filter((policy) =>
    policy.cycle === cycle && policy.track === track &&
    schoolLevelKey(policy.level, cycle) === schoolLevelKey(normalized, cycle));
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


/**
 * New preschool numeric scales and new primary/preschool coefficients are
 * forbidden. Previously saved rows remain readable and can be retained
 * unchanged for compatibility, but are ignored by the specialized engine.
 */
export function validateNewCycleScoringRules(
  previous: FrancoArabicReportsSettings,
  incoming: FrancoArabicReportsSettings,
): "ok" | "preschool_numeric_scale_forbidden" | "nonsecondary_coefficient_forbidden" {
  const unchanged = (oldRows: readonly unknown[], candidate: unknown) =>
    oldRows.some(old => JSON.stringify(old) === JSON.stringify(candidate));
  if (incoming.scales.some(row =>
    row.cycle === "preschool" && !unchanged(previous.scales, row))) {
    return "preschool_numeric_scale_forbidden";
  }
  if (incoming.coefficients.some(row =>
    row.cycle !== "secondary" && !unchanged(previous.coefficients, row))) {
    return "nonsecondary_coefficient_forbidden";
  }
  return "ok";
}

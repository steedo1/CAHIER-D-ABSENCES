import { primaryBaseTitle } from "./primary-storage-scale";
/**
 * Catalogue des évaluations ponctuelles du primaire.
 * Stockage dans institutions.settings_json : aucune nouvelle table ni enum.
 * Les devoirs restent datés à la saisie et ne comptent pas pour le passage.
 */
export const PRIMARY_EVENTS_SETTINGS_KEY = "primary_evaluation_events_v1";
export const PRIMARY_LEVELS = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"] as const;
export type PrimaryLevel = (typeof PRIMARY_LEVELS)[number];
export type PrimaryTrack = "french" | "arabic";
export type PrimaryEventKind = "official" | "passage" | "internal" | "mock";
export type PrimaryEvent = {
  code: string;
  label: string;
  kind: PrimaryEventKind;
  date: string;
  tracks: PrimaryTrack[];
  levels: PrimaryLevel[];
  printBulletin: boolean;
};
type CatalogYear = { events: PrimaryEvent[] };
export type PrimaryEventsCatalog = {
  version: 1;
  years: Record<string, CatalogYear>;
};

const CODE = /^[A-Z][A-Z0-9_-]{0,19}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR = /^(\d{4})-(\d{4})$/;
const KINDS = new Set<PrimaryEventKind>(["official", "passage", "internal", "mock"]);
const TRACKS = new Set<PrimaryTrack>(["french", "arabic"]);
const LEVELS = new Set<string>(PRIMARY_LEVELS);

export const primarySchoolYearIsValid = (year: string): boolean => {
  const match = YEAR.exec(year);
  return !!match && Number(match[2]) === Number(match[1]) + 1;
};

export function readPrimaryEventsCatalog(settings: unknown): PrimaryEventsCatalog {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { version: 1, years: {} };
  }
  const root = (settings as Record<string, unknown>)[PRIMARY_EVENTS_SETTINGS_KEY];
  if (!root || typeof root !== "object" || Array.isArray(root)) return { version: 1, years: {} };
  if ((root as Record<string, unknown>).version !== 1) return { version: 1, years: {} };
  const rawYears = (root as Record<string, unknown>).years;
  const years: Record<string, CatalogYear> = {};
  if (rawYears && typeof rawYears === "object" && !Array.isArray(rawYears)) {
    for (const [year, row] of Object.entries(rawYears)) {
      if (!primarySchoolYearIsValid(year) || !row || typeof row !== "object" || Array.isArray(row)) continue;
      const input = (row as Record<string, unknown>).events;
      if (!Array.isArray(input)) continue;
      const events: PrimaryEvent[] = [];
      const seen = new Set<string>();
      for (const raw of input) {
        const normalized = normalizePrimaryEvent(raw, year);
        if (normalized && !seen.has(normalized.code)) {
          seen.add(normalized.code);
          events.push(normalized);
        }
      }
      years[year] = { events };
    }
  }
  return { version: 1, years };
}

export function normalizePrimaryEvent(raw: unknown, year: string): PrimaryEvent | null {
  if (!primarySchoolYearIsValid(year) || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const code = String(input.code || "").trim().toUpperCase();
  const label = String(input.label || "").trim();
  const kind = input.kind as PrimaryEventKind;
  const date = String(input.date || "").trim();
  if (code === "DEVOIR" || !CODE.test(code) || !label || label.length > 100 || !KINDS.has(kind)) return null;
  const yr = Number(year.slice(0, 4));
  const from = String(yr) + "-09-01";
  const to = String(yr + 1) + "-08-31";
  if (!DATE.test(date) || Number.isNaN(Date.parse(date + "T12:00:00Z")) ||
      new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date ||
      date < from || date > to) return null;
  if (!Array.isArray(input.tracks) || !input.tracks.every(track => TRACKS.has(track as PrimaryTrack)) ||
      !Array.isArray(input.levels) || !input.levels.every(level => LEVELS.has(String(level)))) return null;
  const tracks = Array.isArray(input.tracks)
    ? [...new Set(input.tracks.filter((track): track is PrimaryTrack => TRACKS.has(track as PrimaryTrack)))]
    : [];
  const levels = Array.isArray(input.levels)
    ? [...new Set(input.levels.filter((level): level is PrimaryLevel => LEVELS.has(String(level))))]
    : [];
  if (!tracks.length || !levels.length) return null;
  if (kind === "passage" && levels.includes("CM2")) return null;
  if (kind === "mock" && levels.some(level => level !== "CM2")) return null;
  return {
    code, label, kind, date, tracks, levels,
    printBulletin: kind === "internal" ? input.printBulletin !== false : true,
  };
}

export function validatePrimaryEvents(raw: unknown, year: string):
  { ok: true; events: PrimaryEvent[] } | { ok: false; error: string } {
  if (!primarySchoolYearIsValid(year) || !Array.isArray(raw) || raw.length > 32) {
    return { ok: false, error: "invalid_primary_events_scope" };
  }
  const result: PrimaryEvent[] = [];
  const codes = new Set<string>();
  for (const item of raw) {
    const normalized = normalizePrimaryEvent(item, year);
    if (!normalized) return { ok: false, error: "invalid_primary_event" };
    if (codes.has(normalized.code)) return { ok: false, error: "duplicate_primary_event" };
    codes.add(normalized.code);
    result.push(normalized);
  }
  for (const passage of result.filter(event => event.kind === "passage")) {
    if (result.some(event => event.code !== passage.code && event.levels.some(level => passage.levels.includes(level)) &&
        event.tracks.some(track => passage.tracks.includes(track)) &&
        (event.kind === "passage" || (event.kind === "official" && event.date >= passage.date)))) {
      return { ok: false, error: "invalid_primary_passage_calendar" };
    }
  }
  result.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "fr"));
  return { ok: true, events: result };
}

export function primaryEventsForClass(settings: unknown, year: string, level: string, track: PrimaryTrack):
  PrimaryEvent[] {
  const normalizedLevel = level.replace(/[\s.-]/g, "").toUpperCase();
  return (readPrimaryEventsCatalog(settings).years[year]?.events || []).filter(event =>
    event.levels.includes(normalizedLevel as PrimaryLevel) && event.tracks.includes(track));
}

/** Marker keeps the existing enum and distinguishes each dated official/internal event. */
export function primaryEventTitle(event: PrimaryEvent, track?: PrimaryTrack | null): string {
  const prefix = { official: "O", passage: "P", internal: "I", mock: "M" }[event.kind];
  return "MCPE:" + prefix + ":" + event.code + (track ? ":" + track : "");
}

export function parsePrimaryEventTitle(title: unknown): { kind: PrimaryEventKind | "homework"; code: string; track?: PrimaryTrack } | null {
  title = primaryBaseTitle(title);
  if (typeof title !== "string") return null;
  const match = /^MCPE:([OPIMD]):([A-Z][A-Z0-9_-]{0,19})(?::(french|arabic))?$/.exec(title);
  if (!match) return null;
  const kinds: Record<"O" | "P" | "I" | "M" | "D", PrimaryEventKind | "homework"> = {
    O: "official", P: "passage", I: "internal", M: "mock", D: "homework",
  };
  const kind = kinds[match[1] as "O" | "P" | "I" | "M" | "D"];
  return { kind, code: match[2], ...(match[3] ? { track: match[3] as PrimaryTrack } : {}) };
}

/** Resolve a human-readable event title for the mobile grade column.
 * Never treat a dated primary level evaluation as an ordinary homework.
 */
export function primaryEventDisplayLabel(title: unknown, events: readonly PrimaryEvent[]): string | null {
  const marker = parsePrimaryEventTitle(title);
  if (!marker || marker.kind === "homework") return null;
  const event = events.find(item => item.code === marker.code && item.kind === marker.kind);
  return event?.label || null;
}

/** Annual passage formula, all inputs must be on the same scale. */
export function primaryPassageAverage(
  ordinaryCompositionAverages: readonly number[],
  passageAverage: number | null,
): number | null {
  if (!ordinaryCompositionAverages.length || passageAverage === null ||
      !Number.isFinite(passageAverage) || ordinaryCompositionAverages.some(n => !Number.isFinite(n))) {
    return null;
  }
  const ordinary = ordinaryCompositionAverages.reduce((s, n) => s + n, 0) /
    ordinaryCompositionAverages.length;
  return Math.round(((ordinary + 2 * passageAverage) / 3 + Number.EPSILON) * 100) / 100;
}

export const primaryHomeworkTitle = (track: PrimaryTrack): string => "MCPE:D:DEVOIR:" + track;

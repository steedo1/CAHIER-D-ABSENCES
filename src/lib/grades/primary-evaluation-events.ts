/**
 * Événements de notes au primaire — indépendants des trimestres/semestres.
 * Stockage dans institutions.settings_json (aucune migration SQL).
 * Les évaluations internes et les devoirs ne comptent jamais dans la MGA.
 */
export const PRIMARY_EVENTS_SETTINGS_KEY = "primary_evaluation_events_v1" as const;
export const PRIMARY_EVENT_TITLE_PREFIX = "PRIMARY_EVENT:";
export const PRIMARY_LEVELS = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"] as const;
export type PrimaryLevel = (typeof PRIMARY_LEVELS)[number];
export type PrimaryEventKind = "composition" | "passage" | "examen_blanc" | "interne";
export type PrimaryEvaluationEvent = {
  id: string;
  label: string;
  kind: PrimaryEventKind;
  date: string;
  levels: PrimaryLevel[];
  bulletin: boolean;
};
export type PrimaryEventsSettings = { version: 1; years: Record<string, PrimaryEvaluationEvent[]> };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR = /^(\d{4})-(\d{4})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export function normalizedPrimaryLevel(value: unknown): PrimaryLevel | null {
  const code = String(value ?? "").toUpperCase().replace(/[\s_.-]/g, "");
  return (PRIMARY_LEVELS as readonly string[]).includes(code) ? code as PrimaryLevel : null;
}

export function primaryAnnualEligible(kind: PrimaryEventKind): boolean {
  return kind === "composition" || kind === "passage";
}
export function isValidSchoolDate(value: unknown, year: string): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const match = YEAR.exec(year);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return false;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  const valid = parsed.toISOString().slice(0, 10) === value;
  return valid && ((y === Number(match[1]) && m >= 8) ||
    (y === Number(match[2]) && m <= 7));
}
export function validatePrimaryEvents(input: unknown, year: string): PrimaryEvaluationEvent[] {
  if (!Array.isArray(input) || input.length > 60) throw Error("primary_events_invalid_list");
  const seen = new Set<string>();
  return input.map((item: unknown) => {
    if (!isRecord(item)) throw Error("primary_event_invalid");
    const id = String(item.id || "");
    const label = String(item.label || "").trim();
    const kind = item.kind as PrimaryEventKind;
    const levels = Array.isArray(item.levels) ?
      [...new Set(item.levels.map(normalizedPrimaryLevel))].filter((v): v is PrimaryLevel => !!v) : [];
    if (!UUID.test(id) || seen.has(id)) throw Error("primary_event_duplicate_or_invalid_id");
    seen.add(id);
    if (!label || label.length > 100 || !["composition","passage","examen_blanc","interne"].includes(kind))
      throw Error("primary_event_invalid_kind_or_label");
    if (!isValidSchoolDate(item.date, year)) throw Error("primary_event_invalid_date");
    if (!levels.length || levels.length > 6) throw Error("primary_event_invalid_levels");
    if (kind === "passage" && levels.some(level => level === "CM2"))
      throw Error("primary_passage_not_for_cm2");
    if (kind === "examen_blanc" && levels.some(level => level !== "CM2"))
      throw Error("primary_exam_only_cm2");
    if (typeof item.bulletin !== "boolean" || (kind !== "interne" && !item.bulletin))
      throw Error("primary_event_invalid_bulletin");
    return { id, label, kind, date: item.date, levels, bulletin: item.bulletin };
  });
}
export function readPrimaryEvents(settings: unknown, year: string): PrimaryEvaluationEvent[] {
  if (!isRecord(settings)) return [];
  const root = settings[PRIMARY_EVENTS_SETTINGS_KEY];
  if (!isRecord(root) || root.version !== 1 || !isRecord(root.years)) return [];
  try { return validatePrimaryEvents(root.years[year] ?? [], year); }
  catch { return []; }
}
export function primaryEventTitle(id: string): string {
  if (!UUID.test(id)) throw Error("primary_event_invalid_id");
  return `${PRIMARY_EVENT_TITLE_PREFIX}${id}`;
}
export function primaryEventIdFromTitle(title: unknown): string | null {
  if (typeof title !== "string" || !title.startsWith(PRIMARY_EVENT_TITLE_PREFIX)) return null;
  const id = title.slice(PRIMARY_EVENT_TITLE_PREFIX.length);
  return UUID.test(id) ? id : null;
}
export function primaryEventForClass(events: readonly PrimaryEvaluationEvent[], id: string, level: unknown) {
  const normalized = normalizedPrimaryLevel(level);
  return events.find(event => event.id === id && !!normalized && event.levels.includes(normalized)) || null;
}

/** Toutes les moyennes sont dans la MÊME échelle (ex. /10). Ne jamais traiter
 * une composition interne ni un examen blanc comme une composition ordinaire. */
export function calculatePrimaryAnnualAverage(ordinaryAverages: readonly number[], passage: number): number | null {
  if (!ordinaryAverages.length || !Number.isFinite(passage) || passage < 0) return null;
  if (ordinaryAverages.some(value => !Number.isFinite(value) || value < 0)) return null;
  const ordinary = ordinaryAverages.reduce((sum, v) => sum + v, 0) / ordinaryAverages.length;
  return (ordinary + 2 * passage) / 3;
}

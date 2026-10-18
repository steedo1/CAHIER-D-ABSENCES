import {
  PRESCHOOL_ATTAINMENT, type PreschoolAttainment, type PreschoolCompetency,
} from "./preschool-assessments";
import type { TeachingTrack } from "./school-cycles";
import { asSettingsObject } from "./school-settings-write";

/** Only PUBLIC pedagogical competency catalogs belong in school settings.
 * Private per-student observations are stored as PRIVATE objects, never here.
 */
export const PRESCHOOL_BOOKLETS_KEY = "preschool_booklets_v1";
export type PreschoolMark = { attainment: PreschoolAttainment; observation: string };
export type PreschoolRecord = {
  observations: Record<string, PreschoolMark>;
  teacherComment: string;
  editedBy: string;
  editedAt: string;
};
export type PreschoolStore = {
  version: 1;
  catalogs: Partial<Record<TeachingTrack, PreschoolCompetency[]>>;
};
const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const emptyPreschoolStore = (): PreschoolStore =>
  ({ version: 1, catalogs: {} });

export function parsePreschoolStore(settings: unknown): PreschoolStore {
  const raw = asObj(asSettingsObject(settings)[PRESCHOOL_BOOKLETS_KEY]);
  if (raw.version !== 1) return emptyPreschoolStore();
  const catalogs: PreschoolStore["catalogs"] = {};
  for (const track of ["french", "arabic"] as const) {
    const values = asObj(raw.catalogs)[track];
    if (!Array.isArray(values) || values.length > 40) continue;
    const cleaned = values.filter(v => {
      const entry = asObj(v);
      return typeof entry.id === "string" && /^[a-z0-9_-]{1,40}$/.test(entry.id) &&
        typeof entry.domain === "string" && entry.domain.trim().length >= 2 && entry.domain.length <= 100 &&
        typeof entry.label === "string" && entry.label.trim().length >= 3 && entry.label.length <= 200;
    }).map(v => {
      const row = asObj(v);
      return { id: String(row.id), domain: String(row.domain).trim(), label: String(row.label).trim() };
    });
    if (new Set(cleaned.map(v => v.id)).size === cleaned.length) catalogs[track] = cleaned;
  }
  return { version: 1, catalogs };
}

export function validPreschoolCatalog(value: unknown): value is PreschoolCompetency[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) return false;
  const seen = new Set<string>();
  return value.every(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const { id, domain, label } = row;
    if (typeof id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(id) ||
        seen.has(id) || typeof domain !== "string" || domain.trim().length < 2 ||
        domain.length > 100 || typeof label !== "string" || label.trim().length < 3 ||
        label.length > 200) return false;
    seen.add(id);
    return true;
  });
}
export function validPreschoolRecord(input: unknown, catalog: PreschoolCompetency[]): input is Pick<PreschoolRecord, "observations" | "teacherComment"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const body = input as Record<string, unknown>;
  if (typeof body.teacherComment !== "string" || body.teacherComment.length > 1000) return false;
  const marks = body.observations;
  if (!marks || typeof marks !== "object" || Array.isArray(marks)) return false;
  const entries = Object.entries(marks);
  if (entries.length > catalog.length || entries.length > 40) return false;
  const allowed = new Set(catalog.map(row => row.id));
  return entries.every(([id, raw]) => {
    const mark = asObj(raw);
    return allowed.has(id) &&
      PRESCHOOL_ATTAINMENT.includes(mark.attainment as PreschoolAttainment) &&
      typeof mark.observation === "string" && mark.observation.length <= 500;
  });
}
export function setPreschoolCatalog(settings: unknown, track: TeachingTrack, catalog: PreschoolCompetency[]) {
  const existing = parsePreschoolStore(settings);
  existing.catalogs[track] = catalog.map(row => ({
    id: row.id, domain: row.domain.trim(), label: row.label.trim(),
  }));
  return { ...asSettingsObject(settings), [PRESCHOOL_BOOKLETS_KEY]: existing };
}
export function preschoolRecordReady(catalog: PreschoolCompetency[], record: PreschoolRecord | null): boolean {
  return catalog.length > 0 && !!record && catalog.every(row =>
    record.observations[row.id] && record.observations[row.id].attainment !== "not_observed");
}

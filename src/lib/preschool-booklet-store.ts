import {
  PRESCHOOL_ATTAINMENT, type PreschoolAttainment, type PreschoolCompetency,
} from "./preschool-assessments";
import type { TeachingTrack } from "./school-cycles";
import { asSettingsObject } from "./school-settings-write";

/**
 * Versioned and bounded school-owned preschool assessment data.
 * Reuses institutions.settings_json; no Supabase DDL.
 * ALL writes use the compare-and-swap settings writer.
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
  entries: Record<string, Record<string, Record<string,
    Partial<Record<TeachingTrack, Record<string, PreschoolRecord>>>>>>;
};
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const isTrack = (value: string): value is TeachingTrack => value === "french" || value === "arabic";
export const emptyPreschoolStore = (): PreschoolStore =>
  ({ version: 1, catalogs: {}, entries: {} });

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
  const entries: PreschoolStore["entries"] = {};
  for (const [year, classEntries] of Object.entries(asObj(raw.entries)).slice(0, 6)) {
    if (!/^\d{4}-\d{4}$/.test(year)) continue;
    for (const [classId, periodEntries] of Object.entries(asObj(classEntries)).slice(0, 500)) {
      if (!uuid.test(classId)) continue;
      for (const [periodId, tracks] of Object.entries(asObj(periodEntries)).slice(0, 15)) {
        if (!uuid.test(periodId)) continue;
        for (const [track, studentEntries] of Object.entries(asObj(tracks))) {
          if (!isTrack(track)) continue;
          for (const [studentId, input] of Object.entries(asObj(studentEntries)).slice(0, 700)) {
            if (!uuid.test(studentId)) continue;
            const record = asObj(input);
            const marks: Record<string, PreschoolMark> = {};
            for (const [id, mark] of Object.entries(asObj(record.observations)).slice(0, 40)) {
              const value = asObj(mark);
              if (!/^[a-z0-9_-]{1,40}$/.test(id) ||
                  !PRESCHOOL_ATTAINMENT.includes(value.attainment as PreschoolAttainment) ||
                  typeof value.observation !== "string" || value.observation.length > 500) continue;
              marks[id] = { attainment: value.attainment as PreschoolAttainment,
                observation: value.observation };
            }
            const slot = (((entries[year] ||= {})[classId] ||= {})[periodId] ||= {});
            const students = (slot[track] ||= {});
            students[studentId] = {
              observations: marks, teacherComment:
                typeof record.teacherComment === "string" ? record.teacherComment.slice(0, 1000) : "",
              editedBy: typeof record.editedBy === "string" ? record.editedBy : "",
              editedAt: typeof record.editedAt === "string" ? record.editedAt : "",
            };
          }
        }
      }
    }
  }
  return { version: 1, catalogs, entries };
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
export function setPreschoolRecord(settings: unknown, input: {
  year: string; classId: string; periodId: string; track: TeachingTrack; studentId: string;
  record: Pick<PreschoolRecord, "observations" | "teacherComment">; actor: string;
}) {
  const existing = parsePreschoolStore(settings);
  const slot = ((((existing.entries[input.year] ||= {})[input.classId] ||= {})[input.periodId] ||= {})[input.track] ||= {});
  slot[input.studentId] = {
    observations: input.record.observations,
    teacherComment: input.record.teacherComment.trim(),
    editedBy: input.actor, editedAt: new Date().toISOString(),
  };
  return { ...asSettingsObject(settings), [PRESCHOOL_BOOKLETS_KEY]: existing };
}
export function getPreschoolRecord(store: PreschoolStore, year: string, classId: string,
  periodId: string, track: TeachingTrack, studentId: string): PreschoolRecord | null {
  return store.entries[year]?.[classId]?.[periodId]?.[track]?.[studentId] ?? null;
}
export function preschoolRecordReady(catalog: PreschoolCompetency[], record: PreschoolRecord | null): boolean {
  return catalog.length > 0 && !!record && catalog.every(row =>
    record.observations[row.id] && record.observations[row.id].attainment !== "not_observed");
}

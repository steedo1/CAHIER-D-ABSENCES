import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeachingTrack } from "./school-cycles";
import type { PreschoolCompetency } from "./preschool-assessments";
import type { PreschoolRecord } from "./preschool-booklet-store";
import { validPreschoolCatalog } from "./preschool-booklet-store";

/**
 * Server-only, private SQL storage. Every query is institution-scoped and
 * invoked only after API role, class, teaching track and pupil checks.
 * RLS with no user policies rejects any browser/anon access.
 */
const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
type Locator = {
  institutionId: string; year: string; classId: string; periodId: string;
  track: TeachingTrack; studentId: string;
};
function validLocator(input: Locator) {
  if (![input.institutionId, input.classId, input.periodId, input.studentId]
      .every(id => UUID.test(id)) || !/^\d{4}-\d{4}$/.test(input.year) ||
      !["french", "arabic"].includes(input.track)) throw Error("invalid_preschool_record_path");
}
type CatalogData = {
  catalogs: Partial<Record<TeachingTrack, PreschoolCompetency[]>>;
  revisions: Partial<Record<TeachingTrack, number>>;
};
export async function readPreschoolCatalogs(service: SupabaseClient, institutionId: string): Promise<CatalogData> {
  if (!UUID.test(institutionId)) throw Error("invalid_school");
  const { data, error } = await service.from("preschool_competency_catalogs")
    .select("teaching_track,competencies,revision").eq("institution_id", institutionId);
  if (error) throw Error("preschool_catalog_storage_unavailable");
  const result: CatalogData = { catalogs: {}, revisions: {} };
  for (const row of data || []) {
    if (row.teaching_track !== "french" && row.teaching_track !== "arabic") continue;
    if (!Array.isArray(row.competencies) ||
        !validPreschoolCatalog(row.competencies)) {
      throw Error("invalid_preschool_catalog_storage");
    }
    result.catalogs[row.teaching_track] = row.competencies;
    result.revisions[row.teaching_track] = Number(row.revision);
  }
  return result;
}
export async function writePreschoolCatalog(
  service: SupabaseClient, institutionId: string, track: TeachingTrack,
  competencies: PreschoolCompetency[], actor: string, expectedRevision: number,
): Promise<number> {
  if (!UUID.test(institutionId) || !validPreschoolCatalog(competencies) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw Error("invalid_preschool_catalog");
  }
  const record = { institution_id: institutionId, teaching_track: track,
    competencies, updated_by: actor, updated_at: new Date().toISOString() };
  if (expectedRevision === 0) {
    const { error } = await service.from("preschool_competency_catalogs")
      .insert({ ...record, revision: 1 });
    if (error) {
      if (error.code === "23505") throw Error("catalog_changed_reload_required");
      throw Error("preschool_catalog_save_failed");
    }
    return 1;
  }
  const { data, error } = await service.from("preschool_competency_catalogs")
    .update({ ...record, revision: expectedRevision + 1 })
    .eq("institution_id", institutionId).eq("teaching_track", track)
    .eq("revision", expectedRevision).select("revision").maybeSingle();
  if (error) throw Error("preschool_catalog_save_failed");
  if (!data) throw Error("catalog_changed_reload_required");
  return Number(data.revision);
}
function toRecord(row: {
  observations: unknown; teacher_comment: unknown; edited_by: unknown;
  edited_at: unknown;
}): PreschoolRecord {
  if (!row.observations || typeof row.observations !== "object" ||
      Array.isArray(row.observations) || typeof row.teacher_comment !== "string") {
    throw Error("invalid_preschool_record_storage");
  }
  return {
    observations: row.observations as PreschoolRecord["observations"],
    teacherComment: row.teacher_comment,
    editedBy: String(row.edited_by || ""),
    editedAt: String(row.edited_at || ""),
  };
}
export async function readPrivatePreschoolRecords(service: SupabaseClient,
  input: Omit<Locator, "track" | "studentId">, studentIds: string[],
): Promise<Map<string, PreschoolRecord>> {
  if (![input.institutionId, input.classId, input.periodId].every(id => UUID.test(id)) ||
      !/^\d{4}-\d{4}$/.test(input.year) || studentIds.some(id => !UUID.test(id))) {
    throw Error("invalid_preschool_record_path");
  }
  const result = new Map<string, PreschoolRecord>();
  for (let i = 0; i < studentIds.length; i += 200) {
    const batch = studentIds.slice(i, i + 200);
    const { data, error } = await service.from("preschool_booklet_records")
      .select("student_id,teaching_track,observations,teacher_comment,edited_by,edited_at")
      .eq("institution_id", input.institutionId)
      .eq("academic_year", input.year).eq("class_id", input.classId)
      .eq("period_id", input.periodId).in("student_id", batch);
    if (error) throw Error("preschool_record_storage_unavailable");
    for (const row of data || []) {
      if (row.teaching_track !== "french" && row.teaching_track !== "arabic") continue;
      result.set(`${row.student_id}|${row.teaching_track}`, toRecord(row));
    }
  }
  return result;
}
export async function readPrivatePreschoolRecord(service: SupabaseClient,
  input: Locator): Promise<PreschoolRecord | null> {
  validLocator(input);
  const records = await readPrivatePreschoolRecords(service, input, [input.studentId]);
  return records.get(`${input.studentId}|${input.track}`) || null;
}
export async function writePrivatePreschoolRecord(service: SupabaseClient,
  input: Locator, record: Pick<PreschoolRecord, "observations" | "teacherComment">,
  actor: string, expectedEditedAt: string | null,
): Promise<PreschoolRecord> {
  validLocator(input);
  if (JSON.stringify(record).length > 30_000) throw Error("preschool_record_too_large");
  const editedAt = new Date().toISOString();
  const identity = {
    institution_id: input.institutionId, academic_year: input.year,
    class_id: input.classId, period_id: input.periodId,
    teaching_track: input.track, student_id: input.studentId,
  };
  const contents = { observations: record.observations,
    teacher_comment: record.teacherComment.trim(), edited_by: actor, edited_at: editedAt };
  if (expectedEditedAt === null) {
    const { error } = await service.from("preschool_booklet_records")
      .insert({ ...identity, ...contents, revision: 1 });
    if (error) {
      if (error.code === "23505") throw Error("record_changed_reload_required");
      throw Error("preschool_record_save_failed");
    }
  } else {
    const { data, error } = await service.from("preschool_booklet_records")
      .update(contents)
      .eq("institution_id", input.institutionId)
      .eq("academic_year", input.year).eq("class_id", input.classId)
      .eq("period_id", input.periodId).eq("teaching_track", input.track)
      .eq("student_id", input.studentId).eq("edited_at", expectedEditedAt)
      .select("edited_at").maybeSingle();
    if (error) throw Error("preschool_record_save_failed");
    if (!data) throw Error("record_changed_reload_required");
  }
  return { observations: record.observations, teacherComment: record.teacherComment.trim(),
    editedBy: actor, editedAt };
}

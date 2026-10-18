import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeachingTrack } from "./school-cycles";
import type { PreschoolRecord } from "./preschool-booklet-store";

/** The existing 'signatures' bucket is PRIVATE and service-role only.
 * Keep these files isolated under a dedicated versioned prefix. Moving to
 * a purpose-built PRIVATE bucket later requires no student-data migration in SQL.
 */
const BUCKET = "signatures";
const PREFIX = "preschool-booklets/v1";
const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
type Locator = {
  institutionId: string; year: string; classId: string; periodId: string;
  track: TeachingTrack; studentId: string;
};
function pathFor(input: Locator) {
  if (![input.institutionId, input.classId, input.periodId, input.studentId].every(id => UUID.test(id)) ||
      !/^\d{4}-\d{4}$/.test(input.year) ||
      !["french", "arabic"].includes(input.track)) throw Error("invalid_preschool_record_path");
  return [PREFIX, input.institutionId, input.year, input.classId,
    input.periodId, input.track, input.studentId + ".json"].join("/");
}
export async function readPrivatePreschoolRecord(service: SupabaseClient,
  input: Locator): Promise<PreschoolRecord | null> {
  const { data, error } = await service.storage.from(BUCKET).download(pathFor(input));
  if (error) {
    const status = "status" in error ? Number(error.status) : 0;
    const message = String(error.message || "");
    if (status === 404 || /not found|object not found/i.test(message)) return null;
    throw Error("private_preschool_storage_unavailable");
  }
  if (!data || data.size > 15_000) throw Error("invalid_private_preschool_record");
  const parsed = JSON.parse(await data.text()) as { version?: number; record?: PreschoolRecord };
  if (parsed.version !== 1 || !parsed.record ||
      typeof parsed.record !== "object" ||
      typeof parsed.record.editedAt !== "string" ||
      typeof parsed.record.editedBy !== "string") throw Error("invalid_private_preschool_record");
  return parsed.record;
}
export async function writePrivatePreschoolRecord(service: SupabaseClient,
  input: Locator, record: Pick<PreschoolRecord, "observations" | "teacherComment">,
  actor: string, expectedEditedAt: string | null,
): Promise<PreschoolRecord> {
  const previous = await readPrivatePreschoolRecord(service, input);
  if ((previous?.editedAt ?? null) !== expectedEditedAt) {
    throw Error("record_changed_reload_required");
  }
  const next: PreschoolRecord = {
    observations: record.observations, teacherComment: record.teacherComment.trim(),
    editedAt: new Date().toISOString(), editedBy: actor,
  };
  const payload = Buffer.from(JSON.stringify({ version: 1, record: next }), "utf8");
  if (payload.byteLength > 15_000) throw Error("preschool_record_too_large");
  const { error } = await service.storage.from(BUCKET).upload(pathFor(input), payload, {
    contentType: "application/json", cacheControl: "0", upsert: true,
  });
  if (error) throw Error("private_preschool_save_failed");
  return next;
}

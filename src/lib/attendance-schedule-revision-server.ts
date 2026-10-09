import type { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export type AttendancePreparationSnapshot = {
  schedule_revision: number;
  preparation_revision: number | null;
};

export async function readAttendancePreparationSnapshot(
  service: ReturnType<typeof getSupabaseServiceClient>, institutionId: string,
): Promise<AttendancePreparationSnapshot> {
  const { data, error } = await service.from("attendance_schedule_revisions")
    .select("*").eq("institution_id", institutionId).maybeSingle();
  if (error) throw error;
  const revision = Number(data?.revision ?? 0);
  const preparation = data?.preparation_revision == null ? null : Number(data.preparation_revision);
  if (!Number.isSafeInteger(revision) || revision < 0 ||
      (preparation !== null && (!Number.isSafeInteger(preparation) || preparation < 0))) {
    throw new Error("schedule_revision_invalid");
  }
  return { schedule_revision: revision, preparation_revision: preparation };
}

export function attendancePreparationSnapshotsMatch(
  initial: AttendancePreparationSnapshot, final: AttendancePreparationSnapshot,
): boolean {
  return final.schedule_revision >= initial.schedule_revision &&
    (initial.preparation_revision === null
      ? final.schedule_revision === initial.schedule_revision
      : initial.preparation_revision === final.preparation_revision);
}

export async function readAttendanceScheduleRevision(
  service: ReturnType<typeof getSupabaseServiceClient>, institutionId: string,
): Promise<number> {
  const { data, error } = await service.from("attendance_schedule_revisions")
    .select("revision").eq("institution_id", institutionId).maybeSingle();
  if (error) throw error;
  const revision = Number(data?.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("schedule_revision_invalid");
  return revision;
}

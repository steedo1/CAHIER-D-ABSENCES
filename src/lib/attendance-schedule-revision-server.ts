import type { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

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

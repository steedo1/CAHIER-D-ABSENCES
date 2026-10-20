import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequestProfile, getRequestRoles } from "@/lib/auth/server-context";
import { classDeviceMayAccessClass } from "@/lib/class-device-identity";

/** Unlike evaluations, averages entered from paper have no evaluation RLS
 * check to establish class access. Authorize before exposing those rows. */
export async function mayReadDirectAverages(service: SupabaseClient, authClient: SupabaseClient, userId: string, classId: string, institutionId: string | null | undefined, subjectId: string | null) {
  if (!institutionId || !subjectId) return false;
  const [profile, roles] = await Promise.all([
    getRequestProfile(authClient, userId), getRequestRoles(authClient, service, userId),
  ]);
  if (profile.error || roles.error || profile.data?.institution_id !== institutionId) return false;
  const allowed = new Set((roles.data || []).filter(row => row.institution_id === institutionId || !row.institution_id || row.role === "super_admin").map(row => row.role));
  if (["admin", "super_admin", "file_correspondent"].some(role => allowed.has(role))) return true;
  if (allowed.has("class_device") && await classDeviceMayAccessClass({ service, userId, classId })) return true;
  if (!allowed.has("teacher")) return false;
  const aliases = await service.from("institution_subjects").select("id,subject_id").eq("institution_id", institutionId)
    .or(`id.eq.${subjectId},subject_id.eq.${subjectId}`);
  if (aliases.error) return false;
  const ids = Array.from(new Set([subjectId, ...(aliases.data || []).flatMap(row => [String(row.id), String(row.subject_id)])]));
  const assignment = await service.from("class_teachers").select("id")
    .eq("institution_id", institutionId).eq("class_id", classId).eq("teacher_id", userId).is("end_date", null)
    .in("subject_id", ids).limit(1);
  return !assignment.error && !!assignment.data?.length;
}

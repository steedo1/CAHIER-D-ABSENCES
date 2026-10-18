import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeachingTrack } from "@/lib/school-cycles";

export type ProgramDocumentSignatory = {
  name: string;
  title: string;
  teachingTrack: TeachingTrack;
};

/**
 * Shared server-only source of truth for official pedagogical documents.
 * Directors are selected from VERIFIED active school appointments and
 * institutional profiles, never from an arbitrary browser-supplied name.
 * A blank result is unsigned: it must never be represented as signed.
 */
export async function schoolTeachingSignatories(
  service: SupabaseClient, institutionId: string,
): Promise<Partial<Record<TeachingTrack, ProgramDocumentSignatory>>> {
  const appointments = await service.from("school_teaching_directors")
    .select("teaching_track,profile_id")
    .eq("institution_id", institutionId).eq("is_active", true);
  // Until the additive migration is deployed, never invent a name. Existing
  // classic school bulletin engines do not depend on this helper.
  if (appointments.error || !appointments.data?.length) return {};
  const ids = appointments.data.map(row => row.profile_id);
  const profiles = await service.from("profiles")
    .select("id,institution_id,display_name")
    .eq("institution_id", institutionId).in("id", ids);
  if (profiles.error) return {};
  const names = new Map((profiles.data || []).map(row => [row.id, row.display_name]));
  const result: Partial<Record<TeachingTrack, ProgramDocumentSignatory>> = {};
  for (const row of appointments.data) {
    const track = row.teaching_track;
    if (track !== "french" && track !== "arabic") continue;
    const name = names.get(row.profile_id)?.trim();
    if (!name) continue;
    result[track] = {
      name,
      title: track === "french" ? "Directeur de l'enseignement français" :
        "Directeur de l'enseignement arabe",
      teachingTrack: track,
    };
  }
  return result;
}

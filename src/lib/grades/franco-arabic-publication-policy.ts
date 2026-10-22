import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { isBilingualSchool } from "@/lib/school-student-programs";

/**
 * Opt-in institution-level teaching policy. The policy is derived from the
 * verified institution record, never from a user-supplied request flag.
 * Existing classic schools retain their configurable approval workflow.
 */
export function usesDirectGradePublication(settingsJson: unknown): boolean {
  return isBilingualSchool(parseSchoolCyclesSettings(settingsJson));
}

export async function requiresDirectGradePublication(
  service: SupabaseClient,
  institutionId: string,
): Promise<boolean> {
  if (!institutionId) throw new Error("publication_institution_required");
  const { data, error } = await service.from("institutions")
    .select("settings_json").eq("id", institutionId).maybeSingle();
  if (error || !data) throw new Error("publication_institution_unavailable");
  return usesDirectGradePublication(data.settings_json);
}

/**
 * For a Franco-Arabic establishment, neither an administrator's historical
 * toggle or old settings row can require approval. Push remains a school choice.
 * Parent notification delivery still depends on their subscriptions,
 * preferences, token validity and the ordinary async notification workers.
 */
export function effectiveGradePublicationSwitches(
  isFrancoArabic: boolean,
  configured: { require_admin_validation: boolean; auto_push_on_publish: boolean },
) {
  return isFrancoArabic
    ? { require_admin_validation: false, auto_push_on_publish: configured.auto_push_on_publish }
    : configured;
}

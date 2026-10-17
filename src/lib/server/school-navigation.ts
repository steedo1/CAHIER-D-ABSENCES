import { cache } from "react";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";

/** Request-local only. No authorization/configuration cache across accounts. */
export const getSchoolNavigationSettings = cache(async () => {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(client, service, ["admin"]);
  if ("error" in access) return null;
  const school = await service.from("institutions").select("settings_json")
    .eq("id", access.instId).maybeSingle();
  if (school.error || !school.data) return null;
  const settings = parseSchoolCyclesSettings(school.data.settings_json);
  return settings.enabled ? {
    identityKey: `${access.user.id}:${access.instId}`,
    settings: { ...settings, classCycleById: {}, subjectTracksByCycle: {} },
  } : null;
});

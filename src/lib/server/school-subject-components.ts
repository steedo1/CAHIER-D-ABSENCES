import type { SupabaseClient } from "@supabase/supabase-js";
import { classComponentContext, type ComponentClass } from "@/lib/school-subject-components";

export async function loadClassComponentContext(service: SupabaseClient, institutionId: string,
  cls: ComponentClass, subjectId: string) {
  const school = await service.from("institutions").select("settings_json")
    .eq("id", institutionId).maybeSingle();
  if (school.error || !school.data) throw new Error("COMPONENT_CONTEXT_UNAVAILABLE");
  return classComponentContext(school.data.settings_json, cls, subjectId);
}

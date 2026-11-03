import type { SupabaseClient } from "@supabase/supabase-js";
import { classComponentContext, type ComponentClass } from "@/lib/school-subject-components";

export async function loadClassComponentContext(service: SupabaseClient, institutionId: string,
  cls: ComponentClass, subjectId: string) {
  const school = await service.from("institutions").select("settings_json")
    .eq("id", institutionId).maybeSingle();
  if (school.error || !school.data) throw new Error("COMPONENT_CONTEXT_UNAVAILABLE");
  return classComponentContext(school.data.settings_json, cls, subjectId);
}


/** Réutilise la lecture de configuration du programme pour fournir le nom
 * de l'établissement au PDF du registre, sans requête Supabase supplémentaire. */
export async function loadClassComponentContextWithSchoolName(
  service: SupabaseClient,
  institutionId: string,
  cls: ComponentClass,
  subjectId: string,
) {
  const school = await service.from("institutions")
    .select("settings_json,name").eq("id", institutionId).maybeSingle();
  if (school.error || !school.data) throw new Error("COMPONENT_CONTEXT_UNAVAILABLE");
  return {
    context: classComponentContext(school.data.settings_json, cls, subjectId),
    institutionName: String(school.data.name || "").trim(),
  };
}

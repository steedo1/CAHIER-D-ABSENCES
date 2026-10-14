import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalEducatorLevel } from "@/lib/educator-level";

/** Scope limité aux éducateurs : les autres rôles de gestion conservent leur périmètre. */
export function educatorNeedsAssignedClasses(roles: ReadonlySet<string> | readonly string[]) {
  const set = new Set(roles);
  return set.has("educator") &&
    !["admin", "super_admin", "founder", "file_correspondent"].some((role) => set.has(role));
}

export type EducatorClassAssignment = {
  class_id: string | null;
  level: string | null;
};
export type EducatorScopedClass = {
  id: string;
  level?: string | null;
  education_type?: string | null;
};

export function educatorAssignmentCoversClass(
  classe: EducatorScopedClass,
  assignments: readonly EducatorClassAssignment[],
) {
  const educationType = String(classe.education_type || "general_secondary");
  return assignments.some((assignment) => {
    if (assignment.class_id) return assignment.class_id === classe.id;
    if (!assignment.level) return false;
    return canonicalEducatorLevel(assignment.level, educationType) ===
      canonicalEducatorLevel(classe.level, educationType);
  });
}

export async function loadEducatorAssignments(
  srv: SupabaseClient,
  institutionId: string,
  profileId: string,
): Promise<EducatorClassAssignment[]> {
  const { data, error } = await srv
    .from("educator_class_assignments")
    .select("class_id,level")
    .eq("institution_id", institutionId)
    .eq("profile_id", profileId);
  if (error) throw error;
  return (data || []).map((row) => ({
    class_id: row.class_id ? String(row.class_id) : null,
    level: row.level ? String(row.level) : null,
  }));
}

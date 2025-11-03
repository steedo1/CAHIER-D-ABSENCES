//src/lib/auth/routing.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppRole =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | "class_device"; // ✅

export const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "admin",
  "educator",
  "teacher",
  "class_device", // ✅
  "parent",
];

function normalize(role: AppRole): AppRole {
  return role === "educator" ? "admin" : role;
}

export function routeForRole(role: AppRole): string {
  switch (role) {
    case "super_admin":  return "/super/dashboard";
    case "admin":        return "/admin/dashboard";
    case "educator":     return "/admin/dashboard";
    case "teacher":      return "/attendance";
    case "class_device": return "/class";           // ✅ tableau de bord classe
    case "parent":       return "/parents";
    default:             return "/profile";
  }
}

/** Renvoie toujours une route (jamais de throw). */
export async function routeForUser(
  userId: string,
  supabase: SupabaseClient
): Promise<string> {
  try {
    const { data: rows, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("profile_id", userId);

    if (!error) {
      const roles = (rows ?? []).map(r => r.role as AppRole);
      const primary = ROLE_PRIORITY.find(r => roles.includes(r)) || roles[0];
      if (primary) return routeForRole(normalize(primary));
    } else {
      console.error("[routeForUser] user_roles error:", error.message || error);
    }

    // fallback "parent" si lien
    const { data: g } = await supabase
      .from("student_guardians")
      .select("student_id")
      .eq("parent_id", userId)
      .limit(1);

    if (Array.isArray(g) && g.length > 0) return "/parents";

    return "/profile";
  } catch (e: any) {
    console.error("[routeForUser] exception:", e?.message || e);
    return "/profile";
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";

export type AppRole =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | "class_device";

export type Book = "attendance" | "grades";

export const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "admin",
  "educator",
  "teacher",
  "class_device",
  "parent",
];

function normalize(role: AppRole): AppRole {
  // ⚠️ On ne mappe plus educator → admin
  return role;
}

export function routeForRole(role: AppRole): string {
  switch (role) {
    case "super_admin":
      return "/super/dashboard";
    case "admin":
      return "/admin/dashboard";
    case "educator":
      return "/admin/dashboard"; // même dashboard, mais menu filtré côté front
    case "teacher":
      return "/attendance";
    case "class_device":
      return "/class";
    case "parent":
      return "/parents";
    default:
      return "/profile";
  }
}

/** Variante sensible au cahier choisi. */
export function routeForRoleWithBook(role: AppRole, book?: Book): string {
  const r = normalize(role);
  if (book === "grades") {
    switch (r) {
      case "teacher":
        return "/grades";
      case "admin":
        return "/admin/notes";
      case "super_admin":
        return "/super/notes";
      case "parent":
        return "/parents?tab=notes";
      case "class_device":
        return "/class";
      // 👉 educator : ne va PAS vers /admin/notes, on retombe sur la route par défaut
      default:
        return routeForRole(r);
    }
  }
  // défaut : absences
  return routeForRole(r);
}

/** Renvoie toujours une route. Si role=teacher et pas de book → /choose-book. */
export async function routeForUser(
  userId: string,
  supabase: SupabaseClient,
  book?: Book
): Promise<string> {
  try {
    const { data: rows, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("profile_id", userId);

    if (!error) {
      const roles = (rows ?? []).map((r) => r.role as AppRole);
      const primary = ROLE_PRIORITY.find((r) => roles.includes(r)) || roles[0];
      if (primary) {
        const pr = normalize(primary);
        // ⭐️ Nouveau: les enseignants choisissent leur cahier après login
        if (pr === "teacher" && !book) {
          return "/choose-book";
        }
        return routeForRoleWithBook(pr, book);
      }
    } else {
      console.error("[routeForUser] user_roles error:", error.message || error);
    }

    // fallback "parent" si lien existant
    const { data: g } = await supabase
      .from("student_guardians")
      .select("student_id")
      .eq("parent_id", userId)
      .limit(1);

    if (Array.isArray(g) && g.length > 0) {
      return book === "grades" ? "/parents?tab=notes" : "/parents";
    }

    return "/profile";
  } catch (e: any) {
    console.error("[routeForUser] exception:", e?.message || e);
    return "/profile";
  }
}

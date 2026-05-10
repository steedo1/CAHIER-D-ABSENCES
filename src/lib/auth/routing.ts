// src/lib/auth/routing.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppRole =
  | "super_admin"
  | "drenaet_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | "class_device";

export type Book = "attendance" | "grades";

export const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "drenaet_admin",
  "admin",
  "educator",
  "teacher",
  "class_device",
  "parent",
];

function normalize(role: AppRole): AppRole {
  // Chaque rôle reste distinct.
  return role;
}

/**
 * Route par défaut (sans notion de cahier).
 * Utilisé quand on ne précise pas `book` ou pour le "book" assiduité.
 */
export function routeForRole(role: AppRole): string {
  switch (role) {
    case "super_admin":
      return "/super/dashboard";
    case "drenaet_admin":
      return "/drenaet/dashboard";
    case "admin":
      return "/admin/dashboard";
    case "educator":
      return "/admin/dashboard"; // même dashboard, mais menu filtré côté front
    case "teacher":
      return "/attendance"; // espace assiduité enseignant
    case "class_device":
      return "/class"; // compte-classe pour assiduité
    case "parent":
      return "/parents";
    default:
      return "/profile";
  }
}

/**
 * Variante sensible au cahier choisi (assiduité / notes).
 */
export function routeForRoleWithBook(role: AppRole, book?: Book): string {
  const r = normalize(role);

  // ✅ Cahier de NOTES
  if (book === "grades") {
    switch (r) {
      case "teacher":
        return "/grades"; // Cahier de notes — espace enseignant
      case "admin":
        return "/admin/notes"; // Cahier de notes — admin établissement
      case "drenaet_admin":
        return "/drenaet/dashboard"; // Supervision régionale, lecture seule
      case "super_admin":
        return "/super/notes"; // Cahier de notes — super admin
      case "parent":
        return "/parents?tab=notes"; // Onglet "notes" côté parent
      case "class_device":
        return "/grades/class-device";
      default:
        return routeForRole(r);
    }
  }

  // ✅ Par défaut : assiduité
  return routeForRole(r);
}

/**
 * Renvoie toujours une route.
 * - Si role = teacher OU class_device et pas de `book` → /choose-book.
 * - Sinon → route calculée avec ou sans `book`.
 */
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

        // Enseignant ET compte-classe : si pas encore choisi son cahier,
        // on l'envoie sur l’écran de choix.
        if ((pr === "teacher" || pr === "class_device") && !book) {
          return "/choose-book";
        }

        return routeForRoleWithBook(pr, book);
      }
    } else {
      console.error("[routeForUser] user_roles error:", error.message || error);
    }

    // Fallback "parent" si le user est un parent lié à un élève
    const { data: g } = await supabase
      .from("student_guardians")
      .select("student_id")
      .eq("parent_id", userId)
      .limit(1);

    if (Array.isArray(g) && g.length > 0) {
      return book === "grades" ? "/parents?tab=notes" : "/parents";
    }

    // Fallback ultime
    return "/profile";
  } catch (e: any) {
    console.error("[routeForUser] exception:", e?.message || e);
    return "/profile";
  }
}

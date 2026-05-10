// src/lib/auth/role.ts

export type AppRole =
  | "super_admin"
  | "drenaet_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | "class_device";

export const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "drenaet_admin",
  "admin",
  "educator",
  "teacher",
  "class_device",
  "parent",
];

export function normalize(role: AppRole): AppRole {
  // Chaque rôle reste distinct.
  return role;
}

// Compat : on continue d'exposer routeForRole et la variante "Book-aware".
export { routeForRole, routeForRoleWithBook } from "./routing";
export type { Book } from "./routing";

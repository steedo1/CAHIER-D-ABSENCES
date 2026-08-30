// src/lib/auth/role.ts

export type AppRole =
  | "super_admin"
  | "founder"
  | "drenaet_admin"
  | "admin"
  | "file_correspondent"
  | "finance_manager"
  | "infirmier"
  | "educator"
  | "inspector"
  | "teacher"
  | "parent"
  | "student"
  | "class_device";

export const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "founder",
  "drenaet_admin",
  "admin",
  "file_correspondent",
  "finance_manager",
  "infirmier",
  "educator",
  "inspector",
  "teacher",
  "class_device",
  "parent",
  "student",
];

export function normalize(role: AppRole): AppRole {
  // Chaque rôle reste distinct.
  return role;
}

// Compat : on continue d'exposer routeForRole et la variante "Book-aware".
export { routeForRole, routeForRoleWithBook } from "./routing";
export type { Book } from "./routing";

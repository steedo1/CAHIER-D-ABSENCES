// src/lib/auth/role.ts
export type AppRole = "super_admin" | "admin" | "educator" | "teacher" | "parent";

export const ROLE_PRIORITY: AppRole[] = [
  "super_admin", "admin", "educator", "teacher", "parent",
];

export function normalize(role: AppRole): AppRole {
  // Ã©ducateur = admin pour l'UI/navigation
  return role === "educator" ? "admin" : role;
}

export function pickSingleRole(roles: AppRole[]): AppRole {
  if (!roles?.length) throw new Error("Aucun rÃ´le");
  const found = ROLE_PRIORITY.find((r) => roles.includes(r));
  return normalize(found || roles[0]);
}

export { routeForRole } from "./routing";
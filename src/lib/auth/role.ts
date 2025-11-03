// src/lib/auth/role.ts
export type AppRole =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | "class_device"; // ✅ nouveau

export const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "admin",
  "educator",
  "teacher",
  "class_device", // ✅ placé avant "parent"
  "parent",
];

export function normalize(role: AppRole): AppRole {
  // éducateur = admin pour l'UI/navigation
  return role === "educator" ? "admin" : role;
}

export function pickSingleRole(roles: AppRole[]): AppRole {
  if (!roles?.length) throw new Error("Aucun rôle");
  const found = ROLE_PRIORITY.find((r) => roles.includes(r));
  return normalize(found || roles[0]);
}

export { routeForRole } from "./routing";

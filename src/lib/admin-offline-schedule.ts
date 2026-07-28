export const OFFLINE_SCHEDULE_MUTATION_PATHS = [
  "/api/admin/institution/periods",
  "/api/admin/institution/slots",
  "/api/admin/timetables/import",
  "/api/admin/timetables/manual",
  "/api/admin/montage-emploi-du-temps/publish",
  "/api/admin/associations",
  "/api/admin/affectations/current",
  "/api/admin/teachers/subjects/add",
  "/api/admin/teachers/import",
  "/api/admin/teachers/remove",
  "/api/admin/teachers",
  "/api/admin/users/create",
  "/api/admin/users",
  "/api/admin/classes",
] as const;

export function isOfflineScheduleMutation(pathname: string, method: string) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    return false;
  }
  if (
    pathname === "/api/admin/teachers/payroll-profile" ||
    pathname.startsWith("/api/admin/teachers/payroll-profile/") ||
    pathname === "/api/admin/users/reset-password" ||
    pathname.startsWith("/api/admin/users/reset-password/")
  ) {
    return false;
  }
  return OFFLINE_SCHEDULE_MUTATION_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

import { isOfflineAccessRole, type OfflineAccessRole } from "@/lib/offline-auth-contract";

/**
 * Existing teachers nominated as directors keep their teacher-only offline
 * grant. A director role itself NEVER creates offline administrative access.
 */
export function offlineRoleForDirectorTeacher(
  primary: string | null,
  grants: readonly { role: string; institution_id: string | null }[],
  institutionId: string,
): OfflineAccessRole | null {
  if (isOfflineAccessRole(primary)) return primary;
  if (primary !== "teaching_director" || !institutionId) return null;
  return grants.some(row => row.role === "teacher" && row.institution_id === institutionId)
    ? "teacher" : null;
}

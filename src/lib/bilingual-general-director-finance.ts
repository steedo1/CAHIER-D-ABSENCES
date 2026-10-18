import type { SchoolCyclesSettings } from "@/lib/school-cycles";
import { isBilingualSchool } from "@/lib/school-student-programs";

/**
 * Only the school's EXISTING institution-wide administrator (general director)
 * receives full finance access in a bilingual/franco-Arabic institution.
 *
 * The caller must resolve BOTH the authenticated role and the institution
 * settings on the server before granting access. Signatories for the French
 * and Arabic programs are not institution-wide administrators.
 *
 * This is an eligibility predicate, not a bypass of institution membership,
 * Finance Premium, subscription validity, or server authorization.
 */
export function isBilingualGeneralDirectorFinanceEligible(
  verifiedInstitutionRole: string,
  school: SchoolCyclesSettings,
): boolean {
  return verifiedInstitutionRole === "admin" && isBilingualSchool(school);
}

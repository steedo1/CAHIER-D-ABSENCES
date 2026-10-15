export const STAFF_ROLES = [
  "teacher",
  "educator",
  "infirmier",
  "file_correspondent",
  "finance_manager",
  "admin",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffRoleLink = {
  role: string;
  institution_id: string | null;
};

const GLOBAL_PRIVILEGED_ROLES = new Set([
  "super_admin",
  "founder",
  "drenaet_admin",
]);
const ELEVATED_LOCAL_ROLES = new Set(["admin", "finance_manager"]);

export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Preserve the initial 0 of Côte d'Ivoire's 10-digit numbers. */
export function normalizeStaffPhone(raw: string): string | null {
  const value = raw.trim().replace(/[\s().-]/g, "");
  const digits = value.replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits) && !value.startsWith("+")) {
    return "+225" + digits;
  }
  if (/^2250\d{9}$/.test(digits) && !value.startsWith("+")) {
    return "+" + digits;
  }
  if (/^\+2250\d{9}$/.test(value)) return value;
  // Non-Ivorian numbers must include their explicit international prefix.
  if (/^\+[1-9]\d{7,14}$/.test(value) && !value.startsWith("+225")) {
    return value;
  }
  return null;
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  return String(a || "").replace(/\D/g, "") === String(b || "").replace(/\D/g, "");
}

export function normalizedStaffName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 160 ? name : null;
}

export function normalizedStaffEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Never edit global roles or an account shared across different institutions. */
export function canEditStaffAccount(
  links: StaffRoleLink[],
  institutionId: string,
  profileInstitutionId: string | null,
  isSuperAdmin: boolean,
): boolean {
  if (profileInstitutionId !== institutionId) return false;
  if (links.some((link) => GLOBAL_PRIVILEGED_ROLES.has(link.role))) return false;
  if (links.some((link) => link.institution_id && link.institution_id !== institutionId)) {
    return false;
  }
  const local = links.filter((link) => link.institution_id === institutionId);
  if (!local.some((link) => STAFF_ROLES.some((role) => role === link.role))) return false;
  if (!isSuperAdmin && local.some((link) => ELEVATED_LOCAL_ROLES.has(link.role))) return false;
  return true;
}

export function editableEducatorClassDiff(
  previous: string[],
  requested: string[],
): { added: string[]; removed: string[] } {
  const existing = new Set(previous);
  const desired = new Set(requested);
  return {
    added: Array.from(desired).filter((id) => !existing.has(id)),
    removed: Array.from(existing).filter((id) => !desired.has(id)),
  };
}

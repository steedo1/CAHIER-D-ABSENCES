export const ADMIN_ESSENTIAL_PREPARATION_VERSION = 1 as const;

export type AdminEssentialPreparationMarker = {
  version: typeof ADMIN_ESSENTIAL_PREPARATION_VERSION;
  role: "admin";
  user_id: string;
  institution_id: string;
  prepared_at: string;
  class_count: number;
  roster_count: number;
  bulletin_count: number;
  shell_ready: true;
};

function keyPart(value: string) {
  return encodeURIComponent(String(value || "").trim());
}

export function adminEssentialPreparationKey(
  userId: string,
  institutionId: string,
) {
  return `admin:essential:readiness:v1:${keyPart(userId)}:${keyPart(institutionId)}`;
}

export function isAdminEssentialPreparationMarker(
  value: unknown,
  expected: { userId: string; institutionId: string },
): value is AdminEssentialPreparationMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<AdminEssentialPreparationMarker>;
  return (
    marker.version === ADMIN_ESSENTIAL_PREPARATION_VERSION &&
    marker.role === "admin" &&
    marker.user_id === String(expected.userId || "").trim() &&
    marker.institution_id === String(expected.institutionId || "").trim() &&
    typeof marker.prepared_at === "string" &&
    marker.prepared_at.length > 0 &&
    Number.isSafeInteger(marker.class_count) &&
    Number(marker.class_count) >= 0 &&
    Number.isSafeInteger(marker.roster_count) &&
    Number(marker.roster_count) >= 0 &&
    Number.isSafeInteger(marker.bulletin_count) &&
    Number(marker.bulletin_count) >= 0 &&
    marker.shell_ready === true
  );
}

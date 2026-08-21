export const CLOUD_ONLY_GRADE_WRITE_MESSAGE =
  "Connexion Internet requise pour saisir ou modifier les notes.";

export const OFFLINE_GRADE_WRITES_DISABLED_ERROR =
  "offline_grade_writes_disabled_for_rentree";

/**
 * Capacité de reprise LOT3/LOT4. Désactivée par défaut pour la rentrée
 * 2026-2027 : une activation doit être volontaire au moment du build web.
 */
export const OFFLINE_GRADE_WRITES_ENABLED =
  process.env.NEXT_PUBLIC_MONCAHIER_OFFLINE_GRADE_WRITES_ENABLED === "true";

export function gradeWritesRequireInternet(isOnline: boolean) {
  return !OFFLINE_GRADE_WRITES_ENABLED && !isOnline;
}

export function isOfflineGradeMutation(
  url: string,
  explicitOperationType?: unknown,
) {
  if (String(explicitOperationType || "") === "grades-scores") return true;
  return /\/api\/(?:teacher\/)?grades\/scores\/bulk(?:[/?]|$)/.test(url);
}

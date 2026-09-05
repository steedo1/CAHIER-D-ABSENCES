// Vérification légère : elle ne reconstruit pas le paquet toutes les minutes.
// Le composant compare d'abord la révision locale à attendance_schedule_revisions
// et ne relance la préparation complète que si l'EDT a réellement changé.
export const ATTENDANCE_PREPARATION_CHECK_INTERVAL_MS = 60_000;
export const ATTENDANCE_PREPARATION_SUCCESS_TTL_MS = 6 * 60 * 60_000;
// En cas d'échec réseau, on évite une boucle serrée tout en permettant à une
// correction d'EDT de devenir visible rapidement sur les téléphones.
export const ATTENDANCE_PREPARATION_ATTEMPT_TTL_MS = 45_000;

export function shouldRunAttendancePreparation(input: {
  now: number;
  lastSuccess: number;
  lastAttempt: number;
  force: boolean;
}) {
  if (
    input.now - input.lastAttempt <
    ATTENDANCE_PREPARATION_ATTEMPT_TTL_MS
  ) {
    return false;
  }
  if (input.force) return true;
  return (
    input.now - input.lastSuccess >=
    ATTENDANCE_PREPARATION_SUCCESS_TTL_MS
  );
}

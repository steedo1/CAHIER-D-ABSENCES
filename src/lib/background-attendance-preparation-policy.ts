export const ATTENDANCE_PREPARATION_CHECK_INTERVAL_MS = 30 * 60_000;
export const ATTENDANCE_PREPARATION_SUCCESS_TTL_MS = 6 * 60 * 60_000;
export const ATTENDANCE_PREPARATION_ATTEMPT_TTL_MS = 10 * 60_000;

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

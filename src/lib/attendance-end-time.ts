/** Preserve offline event time; never replace an invalid supplied time with sync time. */
export function parseAttendanceEndAt(raw: unknown, now = new Date()): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return now.toISOString(); // Legacy online callers.
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > now.getTime() + 10 * 60_000) return null;
  return new Date(time).toISOString();
}

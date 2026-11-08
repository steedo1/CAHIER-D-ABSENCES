/** Pure inbox representation of existing Parent Connect notifications. No writes. */
export type QueueNotice = {
  id: string;
  student_id?: string | null;
  institution_id?: string | null;
  session_id?: string | null;
  mark_id?: string | null;
  title?: string | null;
  body?: string | null;
  severity?: string | null;
  created_at: string;
  read_at?: string | null;
  payload?: unknown;
};

const ATTENDANCE_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

/** At most one visible attendance alert per mark, with the real session timestamp. */
export function normalizeParentNotifications<T extends QueueNotice>(
  rows: T[],
  nowMs = Date.now(),
) {
  const seenEvents = new Set<string>();
  return rows.flatMap((row) => {
    const payload = record(row.payload);
    const isAttendance = payload.kind === "attendance";
    let eventIso: string | null = null;

    if (isAttendance) {
      const session = record(payload.session);
      const when = nonEmptyString(session.started_at)
        || nonEmptyString(payload.occurred_at)
        || nonEmptyString(payload.when)
        || row.created_at;
      const eventMs = Date.parse(when);
      // Match the 180-day window of /api/parent/children/events.
      if (!Number.isFinite(eventMs) || eventMs < nowMs - ATTENDANCE_WINDOW_MS || eventMs > nowMs) {
        return [];
      }
      eventIso = new Date(eventMs).toISOString();

      const student = String(row.student_id || record(payload.student).id || "");
      const event = String(payload.event || "");
      const markKey = row.mark_id
        ? `mark:${student}:${row.mark_id}`
        : row.session_id
          ? `session:${student}:${row.session_id}:${event}`
          : `notice:${row.id}`;
      if (seenEvents.has(markKey)) return [];
      seenEvents.add(markKey);
    }

    return [{
      id: row.id,
      student_id: row.student_id ?? null,
      institution_id: row.institution_id ?? null,
      title: nonEmptyString(row.title) || nonEmptyString(payload.title) || null,
      body: nonEmptyString(row.body) || nonEmptyString(payload.body) || null,
      severity: nonEmptyString(row.severity) || nonEmptyString(payload.severity) || null,
      // Queue creation time may be days after the actual session.
      created_at: eventIso || row.created_at,
      read_at: row.read_at ?? null,
      payload: row.payload,
    }];
  });
}

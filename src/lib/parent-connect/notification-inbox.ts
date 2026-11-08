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
  parent_id?: string | null;
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
  ownParentIds: string[] = [],
) {
  const own = new Set(ownParentIds);
  // Prefer this guardian's record when the same mark was delivered to others.
  const preferred = [...rows].sort((a, b) =>
    Number(!b.parent_id || own.has(b.parent_id)) - Number(!a.parent_id || own.has(a.parent_id)));
  const seenEvents = new Set<string>();
  const normalized = preferred.flatMap((row) => {
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
      id: isAttendance && row.parent_id && !own.has(row.parent_id)
        ? `historique:${row.student_id || "eleve"}:${row.mark_id || row.session_id || row.id}`
        : row.id,
      student_id: row.student_id ?? null,
      institution_id: row.institution_id ?? null,
      title: nonEmptyString(row.title) || nonEmptyString(payload.title) || null,
      body: nonEmptyString(row.body) || nonEmptyString(payload.body) || null,
      severity: nonEmptyString(row.severity) || nonEmptyString(payload.severity) || null,
      // Queue creation time may be days after the actual session.
      created_at: eventIso || row.created_at,
      // Imported child history is not a notification sent to this parent.
      // Never expose or modify another guardian's unread/read status.
      read_at: isAttendance && row.parent_id && !own.has(row.parent_id)
        ? row.created_at
        : row.read_at ?? null,
      payload: row.payload,
    }];
  });
  return normalized.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

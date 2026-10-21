import { ATTENDANCE_AUTO_CLOSE_DELAY_MS } from "./attendance-auto-close";

export const SERVER_CLOSE_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
export const SERVER_CLOSE_BATCH_SIZE = 100;

export type ClosableAttendanceSession = {
  id: string;
  institution_id: string;
  started_at: string;
  expected_minutes: number | null;
  ended_at: string | null;
  status: string;
};

/** Same immutable session deadline as the device; unknown durations stay open. */
export function serverAttendanceClosure(row: ClosableAttendanceSession, now: number) {
  if (!Number.isFinite(now) || !row.id || !row.institution_id || row.ended_at || row.status !== "open") return null;
  const start = Date.parse(row.started_at);
  const minutes = row.expected_minutes;
  if (!Number.isFinite(start) || start < now - SERVER_CLOSE_LOOKBACK_MS || start > now) return null;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) return null;
  const deadline = start + minutes * 60_000 + ATTENDANCE_AUTO_CLOSE_DELAY_MS;
  return deadline <= now ? new Date(deadline).toISOString() : null;
}

type SessionTable = {
  update(values: { ended_at: string; status: "submitted" }): any;
};

/** Caller must have authenticated the job and explicitly enabled writes. */
export async function closeAttendanceBatch(input: {
  rows: ClosableAttendanceSession[];
  now: number;
  apply: boolean;
  table(): SessionTable;
}) {
  let eligible = 0, closed = 0, raced = 0;
  for (const row of input.rows.slice(0, SERVER_CLOSE_BATCH_SIZE)) {
    const endedAt = serverAttendanceClosure(row, input.now);
    if (!endedAt) continue;
    eligible += 1;
    if (!input.apply) continue;
    // Compare-and-set: preserve manual/offline closures and changed durations.
    const { data, error } = await input.table().update({ ended_at: endedAt, status: "submitted" })
      .eq("id", row.id).eq("institution_id", row.institution_id)
      .eq("started_at", row.started_at).eq("expected_minutes", row.expected_minutes)
      .eq("status", "open").is("ended_at", null).select("id").maybeSingle();
    if (error) throw new Error("attendance_close_write_failed");
    if (data?.id) closed += 1;
    else raced += 1;
  }
  return { eligible, closed, raced };
}

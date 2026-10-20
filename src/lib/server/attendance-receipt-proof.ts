import { createHash } from "node:crypto";

export type AtomicAttendanceMark = {
  student_id: string;
  status: "present" | "absent" | "late";
  late_minutes: number;
  comment: string | null;
};

/** Exact serialization used by apply_relay_attendance_call_v2's jsonb::text.
 * jsonb orders these fixed keys by UTF-8 byte length, then byte order.
 * This is a receipt comparison, never permission to overwrite attendance. */
export function attendancePayloadFingerprint(marks: readonly AtomicAttendanceMark[]) {
  const ids = new Set<string>();
  const canonical = [...marks].sort((a, b) => a.student_id < b.student_id ? -1 : a.student_id > b.student_id ? 1 : 0);
  for (const mark of canonical) {
    if (ids.has(mark.student_id) || !/^[0-9a-f-]{36}$/i.test(mark.student_id) ||
        !["present", "absent", "late"].includes(mark.status) ||
        !Number.isInteger(mark.late_minutes) || mark.late_minutes < 0 || mark.late_minutes > 1440) return null;
    ids.add(mark.student_id);
  }
  const json = `[${canonical.map((mark) =>
    `{"status": ${JSON.stringify(mark.status)}, "comment": ${JSON.stringify(mark.comment || null)}, "student_id": ${JSON.stringify(mark.student_id)}, "late_minutes": ${mark.status === "late" ? mark.late_minutes : 0}}`,
  ).join(", ")}]`;
  return createHash("md5").update(json, "utf8").digest("hex");
}

function captureStamp(value: string) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const fraction = /:\d{2}\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(value)?.[1] || "";
  // Postgres retains microseconds; Date.parse alone silently truncates them.
  return `${ms}:${fraction.slice(3).padEnd(3, "0")}`;
}

export function attendanceReceiptMatches(input: {
  capturedAt: string;
  marks: readonly AtomicAttendanceMark[];
  receipt: { last_operation_id?: unknown; last_captured_at_device?: unknown; last_payload_fingerprint?: unknown } | null;
}) {
  const captured = captureStamp(input.capturedAt);
  const received = captureStamp(String(input.receipt?.last_captured_at_device || ""));
  if (!input.receipt?.last_operation_id || captured === null || captured !== received) return false;
  const fingerprint = attendancePayloadFingerprint(input.marks);
  return fingerprint !== null && fingerprint === input.receipt.last_payload_fingerprint;
}

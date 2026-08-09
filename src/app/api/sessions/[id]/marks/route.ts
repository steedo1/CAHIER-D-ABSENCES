import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { POST as postTeacherAttendanceBulk } from "@/app/api/teacher/attendance/bulk/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarkStatus = "present" | "absent" | "late";
type MarkInput = {
  student_id: string;
  status: MarkStatus;
  note?: string | null;
  minutes_late?: number;
  observed_at?: string | null;
};

function isMark(value: unknown): value is MarkInput {
  if (!value || typeof value !== "object") return false;
  const mark = value as Record<string, unknown>;
  if (typeof mark.student_id !== "string" || !mark.student_id.trim()) return false;
  if (mark.status !== "present" && mark.status !== "absent" && mark.status !== "late") {
    return false;
  }
  if (mark.note != null && typeof mark.note !== "string") return false;
  if (mark.minutes_late != null && !Number.isFinite(Number(mark.minutes_late))) return false;
  if (mark.observed_at != null && typeof mark.observed_at !== "string") return false;
  return true;
}

function canonicalLegacyOperationId(
  sessionId: string,
  capturedAtDevice: string,
  marks: MarkInput[],
) {
  const canonicalMarks = marks
    .map((mark) => ({
      student_id: mark.student_id.trim(),
      status: mark.status,
      note: mark.note?.trim() || null,
      minutes_late: Math.max(0, Math.floor(Number(mark.minutes_late || 0))),
      observed_at: mark.observed_at || null,
    }))
    .sort((left, right) => left.student_id.localeCompare(right.student_id));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ sessionId, capturedAtDevice, marks: canonicalMarks }))
    .digest("hex")
    .slice(0, 48);
  return `legacy:${fingerprint}`;
}

/**
 * Compatibilité de l'ancien endpoint d'appel.
 *
 * Toutes les écritures sont désormais déléguées à la route atomique et
 * authentifiée `/api/teacher/attendance/bulk`. Aucun accès service-role direct
 * ne doit contourner les contrôles de séance, d'appareil ou de causalité.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const sessionId = String(id || "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "missing_session" }, { status: 400 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const rawMarks = body?.marks;
  if (!Array.isArray(rawMarks)) {
    return NextResponse.json(
      { error: "bad_payload", hint: "marks must be an array" },
      { status: 400 },
    );
  }
  for (let index = 0; index < rawMarks.length; index += 1) {
    if (!isMark(rawMarks[index])) {
      return NextResponse.json(
        { error: "bad_mark", index, value: rawMarks[index] },
        { status: 400 },
      );
    }
  }

  const marks = rawMarks as MarkInput[];
  const suppliedCapturedAt = String(
    body?.captured_at_device || body?.actual_call_at || "",
  ).trim();
  const capturedAtDevice = suppliedCapturedAt || new Date().toISOString();
  const suppliedOperationId = String(
    req.headers.get("x-mon-cahier-operation-id") || body?.operation_id || "",
  ).trim();
  const operationId = suppliedOperationId || canonicalLegacyOperationId(
    sessionId,
    capturedAtDevice,
    marks,
  );

  const headers = new Headers(req.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  headers.set("X-Mon-Cahier-Operation-Id", operationId);

  const forwarded = new NextRequest(req.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      operation_id: operationId,
      captured_at_device: capturedAtDevice,
      marks: marks.map((mark) => ({
        student_id: mark.student_id.trim(),
        status: mark.status,
        minutes_late: mark.minutes_late,
        reason: mark.note?.trim() || null,
        observed_at: mark.observed_at || null,
      })),
    }),
  });

  return await postTeacherAttendanceBulk(forwarded);
}

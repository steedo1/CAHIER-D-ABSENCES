//src/app/api/sessions/[id]/marks/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarkStatus = "present" | "absent" | "late";
type MarkInput = { student_id: string; status: MarkStatus; note?: string | null };

function isMark(x: unknown): x is MarkInput {
  if (!x || typeof x !== "object") return false;
  const m = x as Record<string, unknown>;
  if (typeof m.student_id !== "string" || !m.student_id.trim()) return false;
  if (typeof m.status !== "string") return false;
  if (!["present", "absent", "late"].includes(m.status)) return false;
  if (m.note != null && typeof m.note !== "string") return false;
  return true;
}

/**
 * Enregistre les marques d'appel pour une session.
 * POST /api/sessions/:id/marks
 * Body: { marks: Array<{ student_id: string; status: "present"|"absent"|"late"; note?: string }> }
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const marks = (body as Record<string, unknown>)?.marks as unknown;
  if (!Array.isArray(marks)) {
    return NextResponse.json({ error: "bad_payload", hint: "marks must be an array" }, { status: 400 });
  }
  if (marks.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  // Validation élément par élément (avec message précis)
  for (let i = 0; i < marks.length; i++) {
    if (!isMark(marks[i])) {
      return NextResponse.json(
        { error: "bad_mark", index: i, value: marks[i] },
        { status: 400 }
      );
    }
  }

  const supabase = getSupabaseServiceClient();

  const rows = (marks as MarkInput[]).map((m) => ({
    session_id: id,
    student_id: m.student_id.trim(),
    status: m.status,
    note: m.note?.trim?.() ?? null,
  }));

  const { error } = await supabase.from("attendance_marks").upsert(rows, {
    onConflict: "session_id,student_id",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}

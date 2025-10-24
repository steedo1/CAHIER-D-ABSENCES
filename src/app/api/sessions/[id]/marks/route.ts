import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

/**
 * Enregistre les marques d'appel pour une session.
 * POST /api/sessions/:id/marks
 * Body: { marks: Array<{ student_id: string; status: "present"|"absent"|"late"; note?: string }> }
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { marks } = await req.json();

  if (!Array.isArray(marks)) {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  // Exemple basique (adapte Ã  ta table `attendance_marks`)
  const rows = marks.map((m: any) => ({
    session_id: id,
    student_id: m.student_id,
    status: m.status,
    note: m.note ?? null,
  }));

  const { error } = await supabase.from("attendance_marks").upsert(rows, {
    onConflict: "session_id,student_id",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

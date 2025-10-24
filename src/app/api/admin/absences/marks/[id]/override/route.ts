import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: mark_id } = await context.params;

  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const inst = me?.institution_id as string | undefined;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const minutes =
    typeof body.minutes === "number" ? Math.max(0, Math.floor(body.minutes)) : null;
  const note = typeof body.note === "string" ? body.note : null;

  // Vérifie que la marque appartient bien à l’établissement
  const { data: chk } = await srv
    .from("attendance_marks")
    .select("id, session:session_id(teacher_sessions!inner(institution_id))")
    .eq("id", mark_id)
    .maybeSingle();

  const ok = (chk as any)?.session?.teacher_sessions?.institution_id === inst;
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (minutes === null) {
    // retirer l'override
    const { error } = await srv
      .from("attendance_mark_overrides")
      .delete()
      .eq("mark_id", mark_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, removed: true });
  }

  const { error } = await srv
    .from("attendance_mark_overrides")
    .upsert(
      { mark_id, minutes_override: minutes, note, updated_by: me?.id },
      { onConflict: "mark_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, minutes });
}

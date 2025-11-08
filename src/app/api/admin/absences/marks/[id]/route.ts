//src/app/api/admin/absences/marks/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function DELETE(
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
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const inst = me?.institution_id as string | undefined;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  // sécurité: ne supprimer que si la marque appartient à l’établissement
  const { data: chk } = await srv
    .from("attendance_marks")
    .select("id, session:session_id(teacher_sessions!inner(institution_id))")
    .eq("id", mark_id)
    .maybeSingle();

  const ok = (chk as any)?.session?.teacher_sessions?.institution_id === inst;
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await srv.from("attendance_marks").delete().eq("id", mark_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

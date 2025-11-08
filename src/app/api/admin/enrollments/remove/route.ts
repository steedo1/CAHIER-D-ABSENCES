// src/app/api/admin/enrollments/remove/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = me?.institution_id as string | null;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const { class_id, student_id } = await req.json().catch(() => ({}));
  if (!class_id || !student_id) {
    return NextResponse.json({ error: "class_id_and_student_id_required" }, { status: 400 });
  }

  // Vérifier que la classe appartient bien à mon établissement
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", class_id)
    .maybeSingle();
  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls || (cls as any).institution_id !== inst) {
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await srv
    .from("class_enrollments")
    .update({ end_date: today })
    .eq("institution_id", inst)
    .eq("class_id", class_id)
    .eq("student_id", student_id)
    .is("end_date", null)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ closed: (data ?? []).length });
}

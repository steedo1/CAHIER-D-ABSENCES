// src/app/api/admin/enrollments/remove/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = (me?.institution_id ?? null) as string | null;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const { class_id, student_id } = await req.json().catch(() => ({}));
  if (!class_id || !student_id) {
    return NextResponse.json(
      { error: "class_id_and_student_id_required" },
      { status: 400 }
    );
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

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // Fermer l'inscription active (si elle existe)
  const { data, error } = await srv
    .from("class_enrollments")
    .update({ end_date: today })
    .eq("institution_id", inst)
    .eq("class_id", class_id)
    .eq("student_id", student_id)
    .is("end_date", null)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const closed = (data ?? []).length;

  if (closed === 0) {
    // Diagnostique utile si rien n'a été fermé
    const { data: checkPair, error: checkErr } = await srv
      .from("class_enrollments")
      .select("id,end_date")
      .eq("institution_id", inst)
      .eq("class_id", class_id)
      .eq("student_id", student_id)
      .limit(1);

    if (checkErr) {
      return NextResponse.json({ error: checkErr.message }, { status: 400 });
    }

    if (!checkPair?.length) {
      // Aucune ligne pour cette paire (classe, élève)
      return NextResponse.json({ error: "not_found_in_class" }, { status: 404 });
    }

    if (checkPair[0].end_date !== null) {
      // Déjà fermé
      return NextResponse.json({ error: "already_closed" }, { status: 409 });
    }

    // Cas improbable : rien fermé mais une ligne existe et est active.
    return NextResponse.json({ error: "no_active_row_closed" }, { status: 409 });
  }

  return NextResponse.json({ closed });
}

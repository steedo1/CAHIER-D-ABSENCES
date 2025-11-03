//src/app/api/class/sessions/end/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function PATCH() {
  try {
    const supa = await getSupabaseServerClient();
    const srv  = getSupabaseServiceClient();

    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // Séance ouverte la plus récente pour ce compte
    const { data: open, error: qErr } = await srv
      .from("teacher_sessions")
      .select("id")
      .eq("teacher_id", user.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 400 });
    if (!open) return NextResponse.json({ ok: true, item: null });

    // Clôture (garde-fou pour éviter double fermeture)
    const { data: closed, error } = await srv
      .from("teacher_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", open.id)
      .is("ended_at", null)
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, item: closed ?? { id: open.id } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "end_failed" }, { status: 400 });
  }
}

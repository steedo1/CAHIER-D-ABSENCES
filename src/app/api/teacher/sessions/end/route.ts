// src/app/api/teacher/sessions/end/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(_req: NextRequest) {
  const supa = await getSupabaseServerClient(); // RLS
  const srv  = getSupabaseServiceClient();      // service (no RLS)

  try {
    // 1) Auth
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2) Dernière séance OUVERTE (sur teacher_sessions)
    const { data: sess, error: sErr } = await srv
      .from("teacher_sessions")
      .select("id, status, started_at, ended_at")
      .eq("teacher_id", user.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sErr)   return NextResponse.json({ error: sErr.message }, { status: 400 });
    if (!sess)  return NextResponse.json({ error: "no_open_session" }, { status: 404 });

    // 3) Clôture
    const nowIso = new Date().toISOString();

    const { data: updated, error: uErr } = await srv
      .from("teacher_sessions")
      .update({
        ended_at: nowIso,
        // ENUM actuel déclaré chez toi : open | submitted | validated | cancelled
        status: "submitted",
      })
      .eq("id", sess.id)
      .select("id, status, started_at, ended_at")
      .maybeSingle();

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, item: updated }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "end_failed" }, { status: 500 });
  }
}

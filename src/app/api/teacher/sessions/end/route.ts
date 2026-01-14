// src/app/api/teacher/sessions/end/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const supa = await getSupabaseServerClient(); // RLS
  const srv  = getSupabaseServiceClient();      // service (no RLS)

  try {
    // 1) Auth
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const session_id = String(body?.session_id || "").trim();

    const nowIso = new Date().toISOString();

    // 2) Si session_id fourni -> on ferme EXACTEMENT celle-là (si elle appartient au prof)
    if (session_id) {
      const { data: sess, error: sErr } = await srv
        .from("teacher_sessions")
        .select("id, teacher_id, ended_at, status, started_at")
        .eq("id", session_id)
        .maybeSingle();

      if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
      if (!sess) return NextResponse.json({ error: "session_not_found" }, { status: 404 });

      if (String(sess.teacher_id || "") !== String(user.id)) {
        return NextResponse.json({ error: "forbidden_not_owner" }, { status: 403 });
      }

      if (sess.ended_at) return NextResponse.json({ ok: true, item: { id: sess.id } }, { status: 200 });

      const { data: updated, error: uErr } = await srv
        .from("teacher_sessions")
        .update({
          ended_at: nowIso,
          status: "submitted", // si ton enum le supporte (chez toi oui)
        })
        .eq("id", session_id)
        .is("ended_at", null)
        .select("id, status, started_at, ended_at")
        .maybeSingle();

      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
      return NextResponse.json({ ok: true, item: updated ?? { id: session_id } }, { status: 200 });
    }

    // 3) Fallback : dernière séance ouverte du prof
    const { data: sess, error: qErr } = await srv
      .from("teacher_sessions")
      .select("id, status, started_at, ended_at")
      .eq("teacher_id", user.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 400 });
    if (!sess) return NextResponse.json({ error: "no_open_session" }, { status: 404 });

    const { data: updated, error: uErr } = await srv
      .from("teacher_sessions")
      .update({
        ended_at: nowIso,
        status: "submitted",
      })
      .eq("id", sess.id)
      .is("ended_at", null)
      .select("id, status, started_at, ended_at")
      .maybeSingle();

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
    return NextResponse.json({ ok: true, item: updated ?? { id: sess.id } }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "end_failed" }, { status: 500 });
  }
}

// src/app/api/teacher/sessions/end/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(_req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  try {
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      console.warn("[sessions.end] unauthorized");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Cherche la dernière séance non terminée par cet utilisateur
    const { data: sess, error: sErr } = await srv
      .from("attendance_sessions")
      .select("id, status, started_at, ended_at")
      .eq("started_by", user.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sErr) {
      console.error("[sessions.end] lookup error", sErr);
      return NextResponse.json({ error: sErr.message }, { status: 400 });
    }
    if (!sess?.id) {
      console.warn("[sessions.end] no_open_session");
      return NextResponse.json({ error: "no_open_session" }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    console.log("[sessions.end] closing", {
      session_id: sess.id,
      prev_status: sess.status,
      set_status: "submitted", // ENUM actuel: open | submitted | validated | cancelled
      nowIso,
    });

    const { data: updated, error: uErr } = await srv
      .from("attendance_sessions")
      .update({
        ended_at: nowIso,
        status: "submitted",
      })
      .eq("id", sess.id)
      .select("id, status, started_at, ended_at")
      .maybeSingle();

    if (uErr) {
      console.error("[sessions.end] update error", uErr);
      return NextResponse.json({ error: uErr.message }, { status: 400 });
    }

    console.log("[sessions.end] closed_ok", updated);
    return NextResponse.json({ ok: true, item: updated }, { status: 200 });
  } catch (e: any) {
    console.error("[sessions.end] fatal", e);
    return NextResponse.json({ error: e?.message || "end_failed" }, { status: 500 });
  }
}

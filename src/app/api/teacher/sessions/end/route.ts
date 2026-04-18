// src/app/api/teacher/sessions/end/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  session_id?: string | null;
  client_session_id?: string | null;
  actual_end_at?: string | null;
};

function parseEffectiveEndAt(raw: unknown) {
  const now = new Date();
  const s = String(raw || "").trim();
  if (!s) return now.toISOString();

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return now.toISOString();

  const maxFutureMs = 10 * 60 * 1000;
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;

  if (d.getTime() > now.getTime() + maxFutureMs) return now.toISOString();
  if (d.getTime() < now.getTime() - maxAgeMs) return now.toISOString();

  return d.toISOString();
}

export async function PATCH(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  try {
    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const session_id = String(body?.session_id || "").trim();
    const client_session_id = String(body?.client_session_id || "").trim();
    const endedAtIso = parseEffectiveEndAt(body?.actual_end_at);

    if (session_id) {
      const { data: sess, error: sErr } = await srv
        .from("teacher_sessions")
        .select("id, teacher_id, ended_at, status, started_at")
        .eq("id", session_id)
        .maybeSingle();

      if (sErr) {
        return NextResponse.json({ error: sErr.message }, { status: 400 });
      }
      if (!sess) {
        return NextResponse.json({ error: "session_not_found" }, { status: 404 });
      }

      if (String(sess.teacher_id || "") !== String(user.id)) {
        return NextResponse.json({ error: "forbidden_not_owner" }, { status: 403 });
      }

      if (sess.ended_at) {
        return NextResponse.json(
          { ok: true, item: { id: sess.id, ended_at: sess.ended_at } },
          { status: 200 }
        );
      }

      const { data: updated, error: uErr } = await srv
        .from("teacher_sessions")
        .update({
          ended_at: endedAtIso,
          status: "submitted",
        })
        .eq("id", session_id)
        .is("ended_at", null)
        .select("id, status, started_at, ended_at")
        .maybeSingle();

      if (uErr) {
        return NextResponse.json({ error: uErr.message }, { status: 400 });
      }

      return NextResponse.json(
        { ok: true, item: updated ?? { id: session_id, ended_at: endedAtIso } },
        { status: 200 }
      );
    }

    // Fallback utile si le front offline a encore seulement client_session_id.
    if (client_session_id) {
      const { data: sess, error: qErr } = await srv
        .from("teacher_sessions")
        .select("id, teacher_id, ended_at, status, started_at")
        .eq("teacher_id", user.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (qErr) {
        return NextResponse.json({ error: qErr.message }, { status: 400 });
      }
      if (!sess) {
        return NextResponse.json({ error: "no_open_session" }, { status: 404 });
      }

      const { data: updated, error: uErr } = await srv
        .from("teacher_sessions")
        .update({
          ended_at: endedAtIso,
          status: "submitted",
        })
        .eq("id", sess.id)
        .is("ended_at", null)
        .select("id, status, started_at, ended_at")
        .maybeSingle();

      if (uErr) {
        return NextResponse.json({ error: uErr.message }, { status: 400 });
      }

      return NextResponse.json(
        { ok: true, item: updated ?? { id: sess.id, ended_at: endedAtIso } },
        { status: 200 }
      );
    }

    const { data: sess, error: qErr } = await srv
      .from("teacher_sessions")
      .select("id, status, started_at, ended_at")
      .eq("teacher_id", user.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (qErr) {
      return NextResponse.json({ error: qErr.message }, { status: 400 });
    }
    if (!sess) {
      return NextResponse.json({ error: "no_open_session" }, { status: 404 });
    }

    const { data: updated, error: uErr } = await srv
      .from("teacher_sessions")
      .update({
        ended_at: endedAtIso,
        status: "submitted",
      })
      .eq("id", sess.id)
      .is("ended_at", null)
      .select("id, status, started_at, ended_at")
      .maybeSingle();

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, item: updated ?? { id: sess.id, ended_at: endedAtIso } },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "end_failed" }, { status: 500 });
  }
}

// src/app/api/teacher/sessions/end/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── helpers ───────────────── */

function parseIsoDate(v: any): Date | null {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

function resolveCandidateEndAt(body: any): Date | null {
  return (
    parseIsoDate(body?.actual_end_at) ||
    parseIsoDate(body?.ended_at) ||
    parseIsoDate(body?.client_end_at) ||
    parseIsoDate(body?.click_at) ||
    parseIsoDate(body?.clicked_at) ||
    null
  );
}

function pickEffectiveEndAt(args: {
  sessionStartedAt: string | null;
  sessionActualCallAt: string | null;
  candidateEndAt: Date | null;
  serverNow: Date;
}) {
  const { sessionStartedAt, sessionActualCallAt, candidateEndAt, serverNow } = args;

  const baseStart =
    parseIsoDate(sessionActualCallAt) ||
    parseIsoDate(sessionStartedAt) ||
    serverNow;

  if (!candidateEndAt) return serverNow.toISOString();

  const maxFutureMs = 5 * 60_000; // +5 min
  const minAllowedMs = baseStart.getTime() - 60_000; // légère tolérance
  const maxAllowedMs = baseStart.getTime() + 24 * 60 * 60_000; // 24h

  const t = candidateEndAt.getTime();
  const ok =
    t >= minAllowedMs &&
    t <= maxAllowedMs &&
    t <= serverNow.getTime() + maxFutureMs;

  return ok ? candidateEndAt.toISOString() : serverNow.toISOString();
}

/* ───────────────── handler ───────────────── */

export async function PATCH(req: NextRequest) {
  const supa = await getSupabaseServerClient(); // RLS
  const srv = getSupabaseServiceClient(); // service (no RLS)

  try {
    // 1) Auth
    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_id = String(body?.session_id || "").trim();

    const serverNow = new Date();
    const candidateEndAt = resolveCandidateEndAt(body);

    // 2) Si session_id fourni -> on ferme EXACTEMENT celle-là (si elle appartient au prof)
    if (session_id) {
      const { data: sess, error: sErr } = await srv
        .from("teacher_sessions")
        .select("id, teacher_id, ended_at, status, started_at, actual_call_at")
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
          {
            ok: true,
            item: {
              id: sess.id,
              status: sess.status,
              started_at: sess.started_at,
              actual_call_at: (sess as any).actual_call_at ?? null,
              ended_at: sess.ended_at,
            },
          },
          { status: 200 }
        );
      }

      const endedAtIso = pickEffectiveEndAt({
        sessionStartedAt: (sess.started_at as string | null) ?? null,
        sessionActualCallAt: ((sess as any).actual_call_at as string | null) ?? null,
        candidateEndAt,
        serverNow,
      });

      const { data: updated, error: uErr } = await srv
        .from("teacher_sessions")
        .update({
          ended_at: endedAtIso,
          status: "submitted",
        })
        .eq("id", session_id)
        .is("ended_at", null)
        .select("id, status, started_at, actual_call_at, ended_at")
        .maybeSingle();

      if (uErr) {
        return NextResponse.json({ error: uErr.message }, { status: 400 });
      }

      return NextResponse.json(
        { ok: true, item: updated ?? { id: session_id, ended_at: endedAtIso } },
        { status: 200 }
      );
    }

    // 3) Fallback : dernière séance ouverte du prof
    const { data: sess, error: qErr } = await srv
      .from("teacher_sessions")
      .select("id, status, started_at, actual_call_at, ended_at")
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

    const endedAtIso = pickEffectiveEndAt({
      sessionStartedAt: (sess.started_at as string | null) ?? null,
      sessionActualCallAt: ((sess as any).actual_call_at as string | null) ?? null,
      candidateEndAt,
      serverNow,
    });

    const { data: updated, error: uErr } = await srv
      .from("teacher_sessions")
      .update({
        ended_at: endedAtIso,
        status: "submitted",
      })
      .eq("id", sess.id)
      .is("ended_at", null)
      .select("id, status, started_at, actual_call_at, ended_at")
      .maybeSingle();

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, item: updated ?? { id: sess.id, ended_at: endedAtIso } },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "end_failed" },
      { status: 500 }
    );
  }
}
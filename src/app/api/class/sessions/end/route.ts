// src/app/api/class/sessions/end/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  session_id?: string | null;
  actual_end_at?: string | null;
  operation_id?: string | null;
};

function parseEffectiveEndAt(raw: unknown) {
  const now = new Date();
  const s = String(raw || "").trim();
  if (!s) return now.toISOString();

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return now.toISOString();

  const maxFutureMs = 10 * 60 * 1000;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;

  if (d.getTime() > now.getTime() + maxFutureMs) return now.toISOString();
  if (d.getTime() < now.getTime() - maxAgeMs) return now.toISOString();

  return d.toISOString();
}

export async function PATCH(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const session_id = String(body?.session_id || "").trim();
    const operationId = String(
      req.headers.get("x-mon-cahier-operation-id") ||
        body?.operation_id ||
        "",
    ).trim();
    if (!session_id) {
      return NextResponse.json(
        { error: "session_id_required" },
        { status: 400 },
      );
    }
    if (!operationId) {
      return NextResponse.json(
        { error: "operation_id_required" },
        { status: 400 },
      );
    }
    if (
      !/^[a-zA-Z0-9:_-]{8,160}$/.test(operationId) ||
      operationId.startsWith("client:")
    ) {
      return NextResponse.json(
        { error: "invalid_operation_id" },
        { status: 400 },
      );
    }
    const endedAtIso = parseEffectiveEndAt(body?.actual_end_at);

    const { data: sess, error: sErr } = await srv
      .from("teacher_sessions")
      .select("id, created_by, ended_at, status, started_at")
      .eq("id", session_id)
      .maybeSingle();

    if (sErr) {
      return NextResponse.json({ error: sErr.message }, { status: 400 });
    }
    if (!sess) {
      return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    }

    if (String(sess.created_by || "") !== String(user.id)) {
      return NextResponse.json({ error: "forbidden_not_owner" }, { status: 403 });
    }

    if (sess.ended_at) {
      return NextResponse.json(
        {
          ok: true,
          item: {
            id: sess.id,
            ended_at: sess.ended_at,
            operation_id: operationId || null,
            idempotent: true,
            server_time: new Date().toISOString(),
          },
        },
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
      {
        ok: true,
        item: {
          ...(updated ?? { id: session_id, ended_at: endedAtIso }),
          operation_id: operationId || null,
          idempotent: false,
          server_time: new Date().toISOString(),
        },
      },
      { status: 200 }
    );

  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "end_failed" },
      { status: 500 }
    );
  }
}

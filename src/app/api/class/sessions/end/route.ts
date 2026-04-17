// src/app/api/class/sessions/end/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── helpers ───────────────── */

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

function buildPhoneVariants(raw: string) {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
  const cc = "225";

  const variants = uniq<string>([
    t,
    t.replace(/\s+/g, ""),
    digits,
    `+${digits}`,
    `+${cc}${local10}`,
    `+${cc}${localNo0}`,
    `00${cc}${local10}`,
    `00${cc}${localNo0}`,
    `${cc}${local10}`,
    `${cc}${localNo0}`,
    local10,
    localNo0 ? `0${localNo0}` : "",
  ]);

  const likePatterns = uniq<string>([
    local10 ? `%${local10}%` : "",
    local10 ? `%${cc}${local10}%` : "",
    local10 ? `%+${cc}${local10}%` : "",
    local10 ? `%00${cc}${local10}%` : "",
  ]);

  return { variants, likePatterns };
}

function phoneMatchesStored(storedRaw: string | null | undefined, userPhone: string) {
  const stored = String(storedRaw || "").trim();
  if (!stored) return false;

  const { variants, likePatterns } = buildPhoneVariants(userPhone);

  if (variants.includes(stored)) return true;

  return likePatterns.some((p) => {
    const pat = String(p).replace(/%/g, ".*");
    try {
      return new RegExp(pat).test(stored);
    } catch {
      return false;
    }
  });
}

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

  const maxFutureMs = 5 * 60_000;
  const minAllowedMs = baseStart.getTime() - 60_000;
  const maxAllowedMs = baseStart.getTime() + 24 * 60 * 60_000;

  const t = candidateEndAt.getTime();
  const ok =
    t >= minAllowedMs &&
    t <= maxAllowedMs &&
    t <= serverNow.getTime() + maxFutureMs;

  return ok ? candidateEndAt.toISOString() : serverNow.toISOString();
}

async function getUserPhone(srv: ReturnType<typeof getSupabaseServiceClient>, user: any) {
  let phone = String(user?.phone || "").trim();

  if (!phone) {
    const { data: au } = await srv
      .schema("auth")
      .from("users")
      .select("phone")
      .eq("id", user.id)
      .maybeSingle();

    phone = String(au?.phone || "").trim();
  }

  return phone;
}

/* ───────────────── handler ───────────────── */

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

    const body = await req.json().catch(() => ({} as any));
    const session_id = String(body?.session_id || "").trim();

    const userPhone = await getUserPhone(srv, user);
    if (!userPhone) {
      return NextResponse.json({ error: "no_phone_for_user" }, { status: 400 });
    }

    const serverNow = new Date();
    const candidateEndAt = resolveCandidateEndAt(body);

    // 1) Cas normal : on ferme la séance précise demandée
    if (session_id) {
      const { data: sess, error: sErr } = await srv
        .from("teacher_sessions")
        .select("id, class_id, started_at, actual_call_at, ended_at, status")
        .eq("id", session_id)
        .maybeSingle();

      if (sErr) {
        return NextResponse.json({ error: sErr.message }, { status: 400 });
      }
      if (!sess) {
        return NextResponse.json({ error: "session_not_found" }, { status: 404 });
      }

      const { data: cls, error: cErr } = await srv
        .from("classes")
        .select("id, class_phone_e164")
        .eq("id", sess.class_id)
        .maybeSingle();

      if (cErr) {
        return NextResponse.json({ error: cErr.message }, { status: 400 });
      }
      if (!cls) {
        return NextResponse.json({ error: "class_not_found" }, { status: 404 });
      }

      if (!phoneMatchesStored(cls.class_phone_e164, userPhone)) {
        return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
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

      const { data: closed, error } = await srv
        .from("teacher_sessions")
        .update({
          ended_at: endedAtIso,
          status: "submitted",
        })
        .eq("id", sess.id)
        .is("ended_at", null)
        .select("id, status, started_at, actual_call_at, ended_at")
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        item: closed ?? { id: sess.id, ended_at: endedAtIso },
      });
    }

    // 2) Fallback : dernière séance ouverte liée à CE compte-classe
    const { data: openRows, error: qErr } = await srv
      .from("teacher_sessions")
      .select(`
        id,
        class_id,
        started_at,
        actual_call_at,
        ended_at,
        status,
        cls:class_id ( id, class_phone_e164 )
      `)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(30);

    if (qErr) {
      return NextResponse.json({ error: qErr.message }, { status: 400 });
    }

    const sess = (openRows || []).find((row: any) =>
      phoneMatchesStored(row?.cls?.class_phone_e164, userPhone)
    ) as any | undefined;

    if (!sess) {
      return NextResponse.json({ ok: true, item: null });
    }

    const endedAtIso = pickEffectiveEndAt({
      sessionStartedAt: (sess.started_at as string | null) ?? null,
      sessionActualCallAt: ((sess as any).actual_call_at as string | null) ?? null,
      candidateEndAt,
      serverNow,
    });

    const { data: closed, error } = await srv
      .from("teacher_sessions")
      .update({
        ended_at: endedAtIso,
        status: "submitted",
      })
      .eq("id", sess.id)
      .is("ended_at", null)
      .select("id, status, started_at, actual_call_at, ended_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      item: closed ?? { id: sess.id, ended_at: endedAtIso },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "end_failed" },
      { status: 400 }
    );
  }
}
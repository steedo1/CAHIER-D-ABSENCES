// src/app/api/grades/scores/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScoreRow = {
  evaluation_id?: string;
  student_id: string;
  score: number | string | null;
  comment?: string | null;
};

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function scoreToNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function getContext() {
  const supa = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { supa, user: null as any, profile: null as any, srv: null as any };
  }

  const srv = getSupabaseServiceClient();

  const { data: profile, error } = await srv
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile?.institution_id) {
    console.error("[grades/scores] profile error", error);
    return { supa, user, profile: null as any, srv: null as any };
  }

  return { supa, user, profile, srv };
}

async function ensureEvalAccess(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  evalId: string,
  institutionId: string
) {
  const { data: ev, error } = await srv
    .from("grade_evaluations")
    .select("id,class_id")
    .eq("id", evalId)
    .maybeSingle();

  if (error) {
    console.error("[grades/scores] evaluation fetch error", {
      evaluation_id: evalId,
      error,
    });
    return null;
  }

  if (!ev) return null;

  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", ev.class_id)
    .maybeSingle();

  if (clsErr) {
    console.error("[grades/scores] class fetch error", {
      evaluation_id: evalId,
      class_id: ev.class_id,
      error: clsErr,
    });
    return null;
  }

  if (!cls || cls.institution_id !== institutionId) {
    console.warn("[grades/scores] access denied", {
      evaluation_id: evalId,
      class_id: ev.class_id,
      expected_institution_id: institutionId,
      actual_institution_id: cls?.institution_id ?? null,
    });
    return null;
  }

  return ev;
}

export async function GET(req: NextRequest) {
  try {
    const evalId = String(
      req.nextUrl.searchParams.get("evaluation_id") || ""
    ).trim();

    if (!evalId) {
      return json({
        ok: false,
        error: "evaluation_id manquant",
        items: [],
        count: 0,
      }, 400);
    }

    const { profile, srv } = await getContext();

    if (!profile || !srv) {
      return json(
        {
          ok: false,
          error: "UNAUTHENTICATED",
          items: [],
          count: 0,
        },
        401
      );
    }

    const ev = await ensureEvalAccess(srv, evalId, profile.institution_id);

    if (!ev) {
      return json(
        {
          ok: false,
          error: "EVALUATION_NOT_FOUND_OR_FORBIDDEN",
          items: [],
          count: 0,
        },
        403
      );
    }

    const { data, error } = await srv
      .from("student_grades")
      .select("evaluation_id,student_id,score,comment")
      .eq("evaluation_id", evalId);

    if (error) {
      console.error("[grades/scores] student_grades read error", {
        evaluation_id: evalId,
        error,
      });

      return json(
        {
          ok: false,
          error: error.message || "SCORES_READ_FAILED",
          items: [],
          count: 0,
        },
        500
      );
    }

    const rows = (data ?? []) as ScoreRow[];

    const items = rows.map((r) => ({
      evaluation_id: r.evaluation_id ?? evalId,
      student_id: r.student_id,
      score: scoreToNumber(r.score),
      comment: r.comment ?? null,
    }));

    console.log("[grades/scores] done", {
      evaluation_id: evalId,
      items_count: items.length,
    });

    return json({
      ok: true,
      evaluation_id: evalId,
      items,
      count: items.length,
    });
  } catch (e: any) {
    console.error("[grades/scores] unexpected GET", e);

    return json(
      {
        ok: false,
        error: e?.message || "INTERNAL_ERROR",
        items: [],
        count: 0,
      },
      500
    );
  }
}
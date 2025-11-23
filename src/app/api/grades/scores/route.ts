// src/app/api/grades/scores/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScoreRow = {
  student_id: string;
  score: number | null;
};

async function getContext() {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { supa, user: null as any, profile: null as any, srv: null as any };
  }

  const { data: profile, error } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile?.institution_id) {
    console.error("[grades/scores] profile error", error);
    return { supa, user, profile: null as any, srv: null as any };
  }

  const srv = getSupabaseServiceClient();
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

  if (error || !ev) return null;

  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", ev.class_id)
    .maybeSingle();

  if (clsErr || !cls || cls.institution_id !== institutionId) return null;

  return ev;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const evalId = url.searchParams.get("evaluation_id") || "";
    if (!evalId) return NextResponse.json({ items: [] as ScoreRow[] });

    const { profile, srv } = await getContext();
    if (!profile || !srv) {
      return NextResponse.json({ items: [] as ScoreRow[] }, { status: 401 });
    }

    const ev = await ensureEvalAccess(srv, evalId, profile.institution_id);
    if (!ev) {
      return NextResponse.json({ items: [] as ScoreRow[] }, { status: 200 });
    }

    const { data, error } = await srv
      .from("grade_scores")
      .select("student_id,score")
      .eq("evaluation_id", evalId);

    if (error) {
      console.error("[grades/scores] GET error", error);
      return NextResponse.json({ items: [] as ScoreRow[] }, { status: 200 });
    }

    return NextResponse.json({ items: (data ?? []) as ScoreRow[] });
  } catch (e: any) {
    console.error("[grades/scores] unexpected GET", e);
    return NextResponse.json({ items: [] as ScoreRow[] }, { status: 500 });
  }
}

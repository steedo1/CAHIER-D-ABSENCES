// src/app/api/grades/adjustments/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdjItem = {
  student_id: string;
  bonus: number;
};

type Body = {
  class_id: string;
  subject_id?: string | null;
  items: AdjItem[];
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
    console.error("[grades/adjustments/bulk] profile error", error);
    return { supa, user, profile: null as any, srv: null as any };
  }

  const srv = getSupabaseServiceClient();
  return { supa, user, profile, srv };
}

async function ensureClassAccess(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  institutionId: string
) {
  const { data: cls, error } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", classId)
    .maybeSingle();

  if (error || !cls) return false;
  return cls.institution_id === institutionId;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || !body.class_id || !Array.isArray(body.items)) {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const { profile, srv } = await getContext();
    if (!profile || !srv) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const allowed = await ensureClassAccess(
      srv,
      body.class_id,
      profile.institution_id
    );
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const subj = body.subject_id && body.subject_id !== "" ? body.subject_id : null;

    const upserts = body.items.map((it) => ({
      class_id: body.class_id,
      subject_id: subj,
      student_id: it.student_id,
      bonus: Number.isFinite(it.bonus) ? Number(it.bonus) : 0,
    }));

    if (!upserts.length) {
      return NextResponse.json({ ok: true });
    }

    const { error } = await srv
      .from("grade_adjustments")
      .upsert(upserts, { onConflict: "class_id,subject_id,student_id" });

    if (error) {
      console.error("[grades/adjustments/bulk] upsert error", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[grades/adjustments/bulk] unexpected", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "adjustments_bulk_failed" },
      { status: 500 }
    );
  }
}

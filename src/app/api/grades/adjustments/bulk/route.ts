// src/app/api/grades/adjustments/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { computeAcademicYear } from "@/lib/academicYear";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdjItem = {
  student_id: string;
  bonus: number;
};

type Body = {
  class_id: string;
  subject_id?: string | null; // ⚠️ BRUT : institution_subjects.id ou null
  items: AdjItem[];
};

function bad(error: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

/* ───────── Contexte user / établissement ───────── */

async function getContext() {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    console.warn("[grades/adjustments/bulk] no user in context");
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

/**
 * Vérifie que la classe appartient bien à l'établissement de l'utilisateur.
 */
async function ensureClassAccess(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  institutionId: string
) {
  if (!classId || !institutionId) return false;

  const { data: cls, error } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", classId)
    .maybeSingle();

  if (error) {
    console.error("[grades/adjustments/bulk] class check error", error, {
      classId,
      institutionId,
    });
    return false;
  }

  const ok = !!cls && cls.institution_id === institutionId;
  if (!ok) {
    console.warn("[grades/adjustments/bulk] class access denied", {
      classId,
      institutionId,
      class_institution_id: cls?.institution_id ?? null,
    });
  }
  return ok;
}

/* ==========================================
   POST : upsert des bonus par élève
========================================== */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || !body.class_id || !Array.isArray(body.items)) {
      return bad("invalid_body", 400);
    }

    const { profile, srv } = await getContext();
    if (!profile || !srv) {
      return bad("unauthorized", 401);
    }

    const allowed = await ensureClassAccess(
      srv,
      body.class_id,
      profile.institution_id
    );
    if (!allowed) {
      return bad("forbidden", 403);
    }

    // 🔹 subject_id BRUT = institution_subjects.id (ou null)
    const subjRaw =
      body.subject_id && body.subject_id !== "" ? body.subject_id : null;

    // 🔹 même academic_year que celui utilisé dans /api/grades/averages
    const academic_year = computeAcademicYear(new Date());

    console.log("[grades/adjustments/bulk] POST", {
      class_id: body.class_id,
      subject_id_raw: subjRaw,
      academic_year,
      items_count: body.items.length,
      profile_id: profile.id,
      institution_id: profile.institution_id,
    });

    const upserts = body.items.map((it) => ({
      class_id: body.class_id,
      subject_id: subjRaw, // ⚠️ BRUT, pas converti en subjects.id
      student_id: it.student_id,
      academic_year,
      bonus: Number.isFinite(it.bonus) ? Number(it.bonus) : 0,
    }));

    if (!upserts.length) {
      return NextResponse.json({ ok: true, upserted: 0 });
    }

    const { error } = await srv
      .from("grade_adjustments")
      .upsert(upserts, {
        onConflict: "class_id,subject_id,student_id,academic_year",
      });

    if (error) {
      console.error("[grades/adjustments/bulk] upsert error", error);
      return bad(error.message || "adjustments_upsert_failed", 400);
    }

    return NextResponse.json({
      ok: true,
      upserted: upserts.length,
    });
  } catch (e: any) {
    console.error("[grades/adjustments/bulk] unexpected", e);
    return bad(e?.message || "adjustments_bulk_failed", 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  subject_component_id: string | null;
  teacher_id: string | null;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
  published_at?: string | null;
};

async function getContext() {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    console.warn("[grades/evaluations] no user in context");
    return { supa, user: null as any, profile: null as any, srv: null as any };
  }

  const { data: profile, error } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile?.institution_id) {
    console.error("[grades/evaluations] profile error", error);
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
): Promise<boolean> {
  if (!classId || !institutionId) return false;
  const { data: cls, error } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", classId)
    .maybeSingle();
  if (error) {
    console.error("[grades/evaluations] class check error", error, {
      classId,
      institutionId,
    });
    return false;
  }
  const ok = !!cls && cls.institution_id === institutionId;
  if (!ok) {
    console.warn("[grades/evaluations] class access denied", {
      classId,
      institutionId,
    });
  }
  return ok;
}

/**
 * Essaie de normaliser le subject_id pour respecter la FK :
 *  - d'abord on regarde si c'est déjà un institution_subjects.id pour cet établissement
 *  - sinon, on regarde si c'est un subject_id global rattaché à un institution_subjects
 *  - sinon, on renvoie la valeur brute (et on log un warning)
 */
async function resolveSubjectId(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  rawSubjectId?: string | null
): Promise<string | null> {
  if (!rawSubjectId) return null;
  const sid = rawSubjectId;

  // 1) Directement comme institution_subjects.id
  const { data: direct, error: err1 } = await srv
    .from("institution_subjects")
    .select("id")
    .eq("id", sid)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (err1) {
    console.error(
      "[grades/evaluations] resolveSubjectId direct error",
      err1,
      { institutionId, sid }
    );
  }
  if (direct) {
    console.log(
      "[grades/evaluations] resolveSubjectId: direct institution_subjects.id",
      {
        institutionId,
        rawSubjectId: sid,
        resolved: direct.id,
      }
    );
    return direct.id;
  }

  // 2) Comme subject_id global lié à un institution_subjects
  const { data: viaSub, error: err2 } = await srv
    .from("institution_subjects")
    .select("id")
    .eq("subject_id", sid)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (err2) {
    console.error(
      "[grades/evaluations] resolveSubjectId via subject_id error",
      err2,
      { institutionId, sid }
    );
  }
  if (viaSub) {
    console.log("[grades/evaluations] resolveSubjectId: via subject_id", {
      institutionId,
      rawSubjectId: sid,
      resolved: viaSub.id,
    });
    return viaSub.id;
  }

  // 3) Aucun match trouvé → on renvoie la valeur brute (provoquera
  // probablement l'erreur de FK, mais avec un log clair).
  console.warn(
    "[grades/evaluations] resolveSubjectId: no institution_subjects match",
    { institutionId, rawSubjectId: sid }
  );
  return sid;
}

/* ==========================================
   GET : liste des évaluations
========================================== */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const classId = url.searchParams.get("class_id") || "";
    const subjectRaw = url.searchParams.get("subject_id");
    const subjectId = subjectRaw && subjectRaw !== "" ? subjectRaw : null;

    if (!classId) {
      console.warn("[grades/evaluations] GET sans class_id");
      return NextResponse.json({ items: [] as EvalRow[] });
    }

    const { user, profile, srv } = await getContext();
    if (!user || !profile || !srv) {
      console.warn("[grades/evaluations] GET unauthorized", {
        classId,
        subjectId,
      });
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 401 });
    }

    console.log("[grades/evaluations] GET", {
      classId,
      subjectId,
      profileId: profile.id,
      institutionId: profile.institution_id,
    });

    const allowed = await ensureClassAccess(srv, classId, profile.institution_id);
    if (!allowed) {
      console.warn("[grades/evaluations] GET forbidden for class", {
        classId,
        institutionId: profile.institution_id,
      });
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 200 });
    }

    let q = srv
      .from("grade_evaluations")
      .select(
        "id,class_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at"
      )
      .eq("class_id", classId);

    if (subjectId === null) {
      q = q.is("subject_id", null);
    } else {
      q = q.eq("subject_id", subjectId);
    }

    const { data, error } = await q.order("eval_date", { ascending: true });

    if (error) {
      console.error("[grades/evaluations] GET error", error, {
        classId,
        subjectId,
      });
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 200 });
    }

    return NextResponse.json({ items: (data ?? []) as EvalRow[] });
  } catch (e: any) {
    console.error("[grades/evaluations] unexpected GET", e);
    return NextResponse.json({ items: [] as EvalRow[] }, { status: 500 });
  }
}

/* ==========================================
   POST : création d’une évaluation
========================================== */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "invalid_body" },
        { status: 400 }
      );
    }

    const {
      class_id,
      subject_id,
      subject_component_id,
      eval_date,
      eval_kind,
      scale,
      coeff,
    } = body as {
      class_id: string;
      subject_id?: string | null;
      subject_component_id?: string | null;
      eval_date: string;
      eval_kind: EvalKind;
      scale: number;
      coeff: number;
    };

    console.log("[grades/evaluations] POST body", body);

    if (!class_id || !eval_date || !eval_kind || !scale) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 }
      );
    }

    const { user, profile, srv } = await getContext();
    if (!user || !profile || !srv) {
      console.warn("[grades/evaluations] POST unauthorized", {
        class_id,
        subject_id,
      });
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    const allowed = await ensureClassAccess(
      srv,
      class_id,
      profile.institution_id
    );
    if (!allowed) {
      console.warn("[grades/evaluations] POST forbidden", {
        class_id,
        institutionId: profile.institution_id,
        rawSubjectId: subject_id ?? null,
      });
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    const subjRaw = subject_id && subject_id !== "" ? subject_id : null;
    const resolvedSubjectId = await resolveSubjectId(
      srv,
      profile.institution_id,
      subjRaw
    );

    console.log("[grades/evaluations] POST resolved subject", {
      class_id,
      rawSubjectId: subjRaw,
      resolvedSubjectId,
      subject_component_id: subject_component_id ?? null,
      teacher_id: user.id,
    });

    const { data, error } = await srv
      .from("grade_evaluations")
      .insert({
        class_id,
        subject_id: resolvedSubjectId,
        subject_component_id: subject_component_id ?? null,
        teacher_id: user.id,
        eval_date,
        eval_kind,
        scale,
        coeff,
        is_published: false,
        published_at: null,
      })
      .select(
        "id,class_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at"
      )
      .single();

    if (error) {
      console.error("[grades/evaluations] POST error", error, {
        class_id,
        resolvedSubjectId,
      });
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, item: data as EvalRow });
  } catch (e: any) {
    console.error("[grades/evaluations] unexpected POST", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "eval_create_failed" },
      { status: 500 }
    );
  }
}

/* ==========================================
   PATCH : mise à jour (publication)
   👉 NE TOUCHE QUE grade_evaluations
========================================== */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "invalid_body" },
        { status: 400 }
      );
    }

    const { evaluation_id, is_published } = body as {
      evaluation_id: string;
      is_published?: boolean;
    };

    console.log("[grades/evaluations] PATCH body", body);

    if (!evaluation_id) {
      return NextResponse.json(
        { ok: false, error: "missing_id" },
        { status: 400 }
      );
    }

    const { profile, srv } = await getContext();
    if (!profile || !srv) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    // On récupère la classe pour vérifier l'accès
    const { data: evalRow, error: evErr } = await srv
      .from("grade_evaluations")
      .select("id,class_id")
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evalRow) {
      console.error("[grades/evaluations] PATCH fetch eval error", evErr);
      return NextResponse.json(
        { ok: false, error: "evaluation_not_found" },
        { status: 404 }
      );
    }

    const allowed = await ensureClassAccess(
      srv,
      evalRow.class_id,
      profile.institution_id
    );
    if (!allowed) {
      console.warn("[grades/evaluations] PATCH forbidden", {
        evaluation_id,
        class_id: evalRow.class_id,
        institutionId: profile.institution_id,
      });
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    const patch: any = {};
    if (typeof is_published === "boolean") {
      patch.is_published = is_published;
      patch.published_at = is_published ? new Date().toISOString() : null;
    }

    const { data, error } = await srv
      .from("grade_evaluations")
      .update(patch)
      .eq("id", evaluation_id)
      .select(
        "id,class_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at"
      )
      .maybeSingle();

    if (error) {
      console.error("[grades/evaluations] PATCH error", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, item: data as EvalRow });
  } catch (e: any) {
    console.error("[grades/evaluations] unexpected PATCH", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "eval_update_failed" },
      { status: 500 }
    );
  }
}

/* ==========================================
   DELETE : suppression d’une évaluation
   👉 supprime aussi les notes dans student_grades
========================================== */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "invalid_body" },
        { status: 400 }
      );
    }

    const { evaluation_id } = body as { evaluation_id: string };
    console.log("[grades/evaluations] DELETE body", body);

    if (!evaluation_id) {
      return NextResponse.json(
        { ok: false, error: "missing_id" },
        { status: 400 }
      );
    }

    const { profile, srv } = await getContext();
    if (!profile || !srv) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    const { data: evalRow, error: evErr } = await srv
      .from("grade_evaluations")
      .select("id,class_id")
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evalRow) {
      console.error("[grades/evaluations] DELETE fetch eval error", evErr);
      return NextResponse.json(
        { ok: false, error: "evaluation_not_found" },
        { status: 404 }
      );
    }

    const allowed = await ensureClassAccess(
      srv,
      evalRow.class_id,
      profile.institution_id
    );
    if (!allowed) {
      console.warn("[grades/evaluations] DELETE forbidden", {
        evaluation_id,
        class_id: evalRow.class_id,
        institutionId: profile.institution_id,
      });
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    // 1️⃣ Supprimer d'abord les notes associées (nouvelle table student_grades)
    const { error: delScoresErr } = await srv
      .from("student_grades")
      .delete()
      .eq("evaluation_id", evaluation_id);

    if (delScoresErr) {
      console.error(
        "[grades/evaluations] delete student_grades error",
        delScoresErr
      );
      return NextResponse.json(
        { ok: false, error: delScoresErr.message },
        { status: 400 }
      );
    }

    // 2️⃣ Puis supprimer l'évaluation
    const { error } = await srv
      .from("grade_evaluations")
      .delete()
      .eq("id", evaluation_id);

    if (error) {
      console.error("[grades/evaluations] DELETE error", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[grades/evaluations] unexpected DELETE", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "eval_delete_failed" },
      { status: 500 }
    );
  }
}

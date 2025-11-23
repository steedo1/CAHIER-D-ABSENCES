// src/app/api/grades/evaluations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null; // ⇐ toujours un subjects.id en DB
  subject_component_id: string | null;
  teacher_id: string | null;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
  published_at?: string | null;
};

/* ───────── Contexte user / établissement ───────── */

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
  institutionId: string,
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
 * Résout le subject_id envoyé par le front en un **subjects.id** utilisable
 * dans grade_evaluations.subject_id.
 *
 * Cas gérés :
 *  - le front envoie directement un subjects.id  → on garde tel quel
 *  - le front envoie un institution_subjects.id → on récupère institution_subjects.subject_id
 *  - sinon, on renvoie la valeur brute (et on log un warning)
 */
async function resolveSubjectIdToGlobal(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  rawSubjectId?: string | null,
): Promise<string | null> {
  if (!rawSubjectId) return null;
  const sid = rawSubjectId;

  // 0) Est-ce déjà un subjects.id ?
  try {
    const { data: subj } = await srv
      .from("subjects")
      .select("id")
      .eq("id", sid)
      .maybeSingle();

    if (subj?.id) {
      console.log(
        "[grades/evaluations] resolveSubjectIdToGlobal: direct subjects.id",
        { institutionId, rawSubjectId: sid },
      );
      return subj.id;
    }
  } catch (err) {
    console.error(
      "[grades/evaluations] resolveSubjectIdToGlobal subjects error",
      err,
      { institutionId, sid },
    );
  }

  // 1) Sinon, on considère que c’est un institution_subjects.id
  try {
    const { data: instSub } = await srv
      .from("institution_subjects")
      .select("id,subject_id")
      .eq("id", sid)
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (instSub?.subject_id) {
      console.log(
        "[grades/evaluations] resolveSubjectIdToGlobal: via institution_subjects",
        {
          institutionId,
          rawSubjectId: sid,
          resolved: instSub.subject_id,
        },
      );
      return instSub.subject_id;
    }
  } catch (err) {
    console.error(
      "[grades/evaluations] resolveSubjectIdToGlobal instSub error",
      err,
      { institutionId, sid },
    );
  }

  // 2) Aucun match clair → on renvoie la valeur brute (risque de FK si vraiment invalide)
  console.warn(
    "[grades/evaluations] resolveSubjectIdToGlobal: no match",
    { institutionId, rawSubjectId: sid },
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
    const subjectParam = subjectRaw && subjectRaw !== "" ? subjectRaw : null;

    // 🔹 sous-matière éventuelle
    const subjectComponentRaw = url.searchParams.get("subject_component_id");
    const subjectComponentId =
      subjectComponentRaw && subjectComponentRaw !== ""
        ? subjectComponentRaw
        : null;

    if (!classId) {
      console.warn("[grades/evaluations] GET sans class_id");
      return NextResponse.json({ items: [] as EvalRow[] });
    }

    const { user, profile, srv } = await getContext();
    if (!user || !profile || !srv) {
      console.warn("[grades/evaluations] GET unauthorized", {
        classId,
        subjectParam,
        subjectComponentId,
      });
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 401 });
    }

    console.log("[grades/evaluations] GET", {
      classId,
      subjectParam,
      subjectComponentId,
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

    // 🔁 On normalise toujours vers un subjects.id pour filtrer la table
    let effectiveSubjectId: string | null = null;
    if (subjectParam !== null) {
      effectiveSubjectId = await resolveSubjectIdToGlobal(
        srv,
        profile.institution_id,
        subjectParam,
      );
    }

    let q = srv
      .from("grade_evaluations")
      .select(
        "id,class_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at",
      )
      .eq("class_id", classId);

    // 🔹 Priorité à la sous-matière si présente
    if (subjectComponentId) {
      q = q.eq("subject_component_id", subjectComponentId);
    } else if (effectiveSubjectId === null) {
      q = q.is("subject_id", null);
    } else {
      q = q.eq("subject_id", effectiveSubjectId);
    }

    const { data, error } = await q.order("eval_date", { ascending: true });

    if (error) {
      console.error("[grades/evaluations] GET error", error, {
        classId,
        subjectParam,
        effectiveSubjectId,
        subjectComponentId,
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
        { status: 400 },
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
        { status: 400 },
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
        { status: 401 },
      );
    }

    const allowed = await ensureClassAccess(
      srv,
      class_id,
      profile.institution_id,
    );
    if (!allowed) {
      console.warn("[grades/evaluations] POST forbidden", {
        class_id,
        institutionId: profile.institution_id,
        rawSubjectId: subject_id ?? null,
      });
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    }

    const subjRaw = subject_id && subject_id !== "" ? subject_id : null;
    const resolvedSubjectId = await resolveSubjectIdToGlobal(
      srv,
      profile.institution_id,
      subjRaw,
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
        "id,class_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at",
      )
      .single();

    if (error) {
      console.error("[grades/evaluations] POST error", error, {
        class_id,
        resolvedSubjectId,
      });
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, item: data as EvalRow });
  } catch (e: any) {
    console.error("[grades/evaluations] unexpected POST", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "eval_create_failed" },
      { status: 500 },
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
        { status: 400 },
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
        { status: 400 },
      );
    }

    const { profile, srv } = await getContext();
    if (!profile || !srv) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
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
        { status: 404 },
      );
    }

    const allowed = await ensureClassAccess(
      srv,
      evalRow.class_id,
      profile.institution_id,
    );
    if (!allowed) {
      console.warn("[grades/evaluations] PATCH forbidden", {
        evaluation_id,
        class_id: evalRow.class_id,
        institutionId: profile.institution_id,
      });
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
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
        "id,class_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at",
      )
      .maybeSingle();

    if (error) {
      console.error("[grades/evaluations] PATCH error", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, item: data as EvalRow });
  } catch (e: any) {
    console.error("[grades/evaluations] unexpected PATCH", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "eval_update_failed" },
      { status: 500 },
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
        { status: 400 },
      );
    }

    const { evaluation_id } = body as { evaluation_id: string };
    console.log("[grades/evaluations] DELETE body", body);

    if (!evaluation_id) {
      return NextResponse.json(
        { ok: false, error: "missing_id" },
        { status: 400 },
      );
    }

    const { profile, srv } = await getContext();
    if (!profile || !srv) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
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
        { status: 404 },
      );
    }

    const allowed = await ensureClassAccess(
      srv,
      evalRow.class_id,
      profile.institution_id,
    );
    if (!allowed) {
      console.warn("[grades/evaluations] DELETE forbidden", {
        evaluation_id,
        class_id: evalRow.class_id,
        institutionId: profile.institution_id,
      });
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    }

    // 1️⃣ Supprimer d'abord les notes associées
    const { error: delScoresErr } = await srv
      .from("student_grades")
      .delete()
      .eq("evaluation_id", evaluation_id);

    if (delScoresErr) {
      console.error(
        "[grades/evaluations] delete student_grades error",
        delScoresErr,
      );
      return NextResponse.json(
        { ok: false, error: delScoresErr.message },
        { status: 400 },
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
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[grades/evaluations] unexpected DELETE", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "eval_delete_failed" },
      { status: 500 },
    );
  }
}

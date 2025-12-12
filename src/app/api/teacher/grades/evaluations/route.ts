import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { queueGradeNotificationsForEvaluation } from "@/lib/push/grades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null; // subjects.id (global)
  subject_component_id: string | null;
  teacher_id: string | null;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
  published_at?: string | null;
};

type Role =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "class_device"
  | string;

/* ───────── Context + roles ───────── */

async function getContext() {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      supa,
      user: null as any,
      profile: null as any,
      institutionId: null as any,
      roles: new Set<Role>(),
      srv: null as any,
    };
  }

  const { data: profile, error } = await supa
    .from("profiles")
    .select("id,institution_id,role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile?.institution_id) {
    console.error("[teacher/grades/evaluations] profile error", error);
    return {
      supa,
      user,
      profile: null as any,
      institutionId: null as any,
      roles: new Set<Role>(),
      srv: null as any,
    };
  }

  const srv = getSupabaseServiceClient();

  // roles via user_roles (si table utilisée) + fallback profile.role
  const roles = new Set<Role>();
  if (profile?.role) roles.add(String(profile.role) as Role);

  try {
    const { data: roleRows, error: rolesErr } = await srv
      .from("user_roles")
      .select("role")
      .eq("profile_id", profile.id)
      .eq("institution_id", profile.institution_id);

    if (!rolesErr && Array.isArray(roleRows)) {
      for (const r of roleRows) roles.add(String((r as any).role) as Role);
    }
  } catch (e) {
    // si table user_roles absente ou autre, on ignore (fallback profile.role)
  }

  return {
    supa,
    user,
    profile,
    institutionId: profile.institution_id as string,
    roles,
    srv,
  };
}

/* ───────── Helpers accès ───────── */

async function ensureClassInInstitution(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  institutionId: string
) {
  const { data: cls, error } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", classId)
    .maybeSingle();

  if (error) {
    console.error("[teacher/grades/evaluations] class check error", error, {
      classId,
      institutionId,
    });
    return false;
  }
  return !!cls && cls.institution_id === institutionId;
}

/**
 * Retourne:
 * - globalId = subjects.id (utilisable dans grade_evaluations.subject_id)
 * - instId   = institution_subjects.id (souvent utilisé dans class_teachers.subject_id selon les projets)
 */
async function resolveSubjectIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  rawSubjectId?: string | null
): Promise<{ raw: string | null; globalId: string | null; instId: string | null }> {
  if (!rawSubjectId || rawSubjectId.trim() === "") {
    return { raw: null, globalId: null, instId: null };
  }
  const raw = rawSubjectId;

  // 1) raw est-il un subjects.id ?
  const { data: subj } = await srv
    .from("subjects")
    .select("id")
    .eq("id", raw)
    .maybeSingle();

  if (subj?.id) {
    // on tente de trouver institution_subjects correspondant
    const { data: instSub } = await srv
      .from("institution_subjects")
      .select("id,subject_id")
      .eq("institution_id", institutionId)
      .eq("subject_id", subj.id)
      .maybeSingle();

    return { raw, globalId: subj.id, instId: instSub?.id ?? null };
  }

  // 2) sinon raw est-il un institution_subjects.id ?
  const { data: instSub2 } = await srv
    .from("institution_subjects")
    .select("id,subject_id")
    .eq("institution_id", institutionId)
    .eq("id", raw)
    .maybeSingle();

  if (instSub2?.id) {
    return { raw, globalId: instSub2.subject_id ?? null, instId: instSub2.id };
  }

  // 3) inconnu → on laisse raw, mais globalId null (évite insert FK foireux)
  return { raw, globalId: null, instId: null };
}

async function ensureTeacherAccessForClass(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  profileId: string,
  roles: Set<Role>,
  classId: string,
  subjectCandidates: Array<string>
) {
  // admins: accès total établissement
  if (
    roles.has("super_admin") ||
    roles.has("admin") ||
    roles.has("educator")
  ) {
    return true;
  }

  // teacher: doit être affecté à la classe
  if (roles.has("teacher")) {
    // 1) essaie avec match matière si on en a
    if (subjectCandidates.length > 0) {
      const { data } = await srv
        .from("class_teachers")
        .select("id")
        .eq("institution_id", institutionId)
        .eq("class_id", classId)
        .eq("teacher_id", profileId)
        .is("end_date", null)
        .in("subject_id", subjectCandidates)
        .limit(1);

      if (data && data.length > 0) return true;
    }

    // 2) fallback: affecté à la classe (même si subject_id stocké différemment)
    const { data: anyRow } = await srv
      .from("class_teachers")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .eq("teacher_id", profileId)
      .is("end_date", null)
      .limit(1);

    return !!(anyRow && anyRow.length > 0);
  }

  return false;
}

/* ───────────────── Push dispatch immédiat ───────────────── */

async function triggerImmediatePushDispatch(originHint?: string | null) {
  try {
    const base =
      originHint ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.SITE_URL ||
      "";

    if (!base) return;

    const url = new URL("/api/push/dispatch", base).toString();
    const headers: Record<string, string> = { "content-type": "application/json" };

    if (process.env.PUSH_DISPATCH_SECRET) {
      headers["x-push-dispatch-secret"] = process.env.PUSH_DISPATCH_SECRET;
    }

    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "grades_publish" }),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[teacher/grades/evaluations] triggerImmediatePushDispatch error", err);
  }
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

    const subjectComponentRaw =
      url.searchParams.get("subject_component_id") ??
      url.searchParams.get("subjectComponentId");
    const subjectComponentId =
      subjectComponentRaw && subjectComponentRaw !== "" ? subjectComponentRaw : null;

    if (!classId) {
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 200 });
    }

    const { user, profile, institutionId, roles, srv } = await getContext();
    if (!user || !profile || !srv || !institutionId) {
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 401 });
    }

    const classOk = await ensureClassInInstitution(srv, classId, institutionId);
    if (!classOk) {
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 403 });
    }

    const { raw, globalId, instId } = await resolveSubjectIds(srv, institutionId, subjectParam);

    const subjectCandidates = [raw, globalId, instId].filter(
      (x): x is string => !!x
    );

    const accessOk = await ensureTeacherAccessForClass(
      srv,
      institutionId,
      profile.id,
      roles,
      classId,
      subjectCandidates
    );

    if (!accessOk) {
      console.warn("[teacher/grades/evaluations] forbidden", {
        classId,
        subjectParam,
        subjectCandidates,
        profileId: profile.id,
        roles: Array.from(roles),
      });
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 403 });
    }

    let q = srv
      .from("grade_evaluations")
      .select(
        "id,class_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at"
      )
      .eq("class_id", classId);

    // filtre matière : grade_evaluations.subject_id = subjects.id (global)
    if (subjectComponentId) {
      q = q.eq("subject_component_id", subjectComponentId);
    } else if (subjectParam === null) {
      q = q.is("subject_id", null);
    } else {
      // si on n'arrive pas à résoudre vers subjects.id, on renvoie vide (pas 403)
      if (!globalId) return NextResponse.json({ items: [] as EvalRow[] }, { status: 200 });
      q = q.eq("subject_id", globalId);
    }

    const { data, error } = await q.order("eval_date", { ascending: true });
    if (error) {
      console.error("[teacher/grades/evaluations] GET error", error);
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 200 });
    }

    return NextResponse.json({ items: (data ?? []) as EvalRow[] }, { status: 200 });
  } catch (e) {
    console.error("[teacher/grades/evaluations] unexpected GET", e);
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
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const {
      class_id,
      subject_id,
      subject_component_id: subject_component_id_raw,
      subjectComponentId,
      eval_date,
      eval_kind,
      scale,
      coeff,
    } = body as {
      class_id: string;
      subject_id?: string | null;
      subject_component_id?: string | null;
      subjectComponentId?: string | null;
      eval_date: string;
      eval_kind: EvalKind;
      scale: number;
      coeff: number;
    };

    if (!class_id || !eval_date || !eval_kind || !scale) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const { user, profile, institutionId, roles, srv } = await getContext();
    if (!user || !profile || !srv || !institutionId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const classOk = await ensureClassInInstitution(srv, class_id, institutionId);
    if (!classOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const subjRaw = subject_id && subject_id !== "" ? subject_id : null;
    const { raw, globalId, instId } = await resolveSubjectIds(srv, institutionId, subjRaw);

    const subjectCandidates = [raw, globalId, instId].filter(
      (x): x is string => !!x
    );

    const accessOk = await ensureTeacherAccessForClass(
      srv,
      institutionId,
      profile.id,
      roles,
      class_id,
      subjectCandidates
    );

    if (!accessOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // Normalisation du subject_component_id (camelCase OU snake_case)
    const subjectComponentIdNorm =
      typeof subjectComponentId === "string" && subjectComponentId.trim() !== ""
        ? subjectComponentId.trim()
        : typeof subject_component_id_raw === "string" && subject_component_id_raw.trim() !== ""
        ? subject_component_id_raw.trim()
        : null;

    // IMPORTANT: grade_evaluations.subject_id doit être un subjects.id
    const effectiveGlobalSubjectId = subjRaw ? globalId : null;
    if (subjRaw && !effectiveGlobalSubjectId) {
      return NextResponse.json(
        { ok: false, error: "invalid_subject_id" },
        { status: 400 }
      );
    }

    const { data, error } = await srv
      .from("grade_evaluations")
      .insert({
        class_id,
        subject_id: effectiveGlobalSubjectId,
        subject_component_id: subjectComponentIdNorm,
        teacher_id: profile.id,
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
      console.error("[teacher/grades/evaluations] POST error", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, item: data as EvalRow }, { status: 200 });
  } catch (e: any) {
    console.error("[teacher/grades/evaluations] unexpected POST", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "eval_create_failed" },
      { status: 500 }
    );
  }
}

/* ==========================================
   PATCH : publication
========================================== */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const { evaluation_id, is_published } = body as {
      evaluation_id: string;
      is_published?: boolean;
    };

    if (!evaluation_id) {
      return NextResponse.json({ ok: false, error: "missing_id" }, { status: 400 });
    }

    const { profile, institutionId, roles, srv } = await getContext();
    if (!profile || !srv || !institutionId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { data: evalRow, error: evErr } = await srv
      .from("grade_evaluations")
      .select("id,class_id,subject_id,is_published")
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evalRow) {
      return NextResponse.json({ ok: false, error: "evaluation_not_found" }, { status: 404 });
    }

    const classOk = await ensureClassInInstitution(srv, evalRow.class_id, institutionId);
    if (!classOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const subjectCandidates = [evalRow.subject_id].filter((x): x is string => !!x);

    const accessOk = await ensureTeacherAccessForClass(
      srv,
      institutionId,
      profile.id,
      roles,
      evalRow.class_id,
      subjectCandidates
    );

    if (!accessOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const patch: any = {};
    if (typeof is_published === "boolean") {
      patch.is_published = is_published;
      patch.published_at = is_published ? new Date().toISOString() : null;
    }

    const wasPublished = !!evalRow.is_published;

    const { data, error } = await srv
      .from("grade_evaluations")
      .update(patch)
      .eq("id", evaluation_id)
      .select(
        "id,class_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at"
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    if (typeof is_published === "boolean" && !wasPublished && is_published) {
      queueGradeNotificationsForEvaluation(evaluation_id)
        .then(() => triggerImmediatePushDispatch(req.headers.get("origin")))
        .catch((e) => console.error("[teacher/grades/evaluations] push queue error", e));
    }

    return NextResponse.json({ ok: true, item: data as EvalRow }, { status: 200 });
  } catch (e: any) {
    console.error("[teacher/grades/evaluations] unexpected PATCH", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "eval_update_failed" },
      { status: 500 }
    );
  }
}

/* ==========================================
   DELETE : supprime aussi student_grades
========================================== */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const { evaluation_id } = body as { evaluation_id: string };
    if (!evaluation_id) {
      return NextResponse.json({ ok: false, error: "missing_id" }, { status: 400 });
    }

    const { profile, institutionId, roles, srv } = await getContext();
    if (!profile || !srv || !institutionId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { data: evalRow, error: evErr } = await srv
      .from("grade_evaluations")
      .select("id,class_id,subject_id")
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evalRow) {
      return NextResponse.json({ ok: false, error: "evaluation_not_found" }, { status: 404 });
    }

    const classOk = await ensureClassInInstitution(srv, evalRow.class_id, institutionId);
    if (!classOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const subjectCandidates = [evalRow.subject_id].filter((x): x is string => !!x);

    const accessOk = await ensureTeacherAccessForClass(
      srv,
      institutionId,
      profile.id,
      roles,
      evalRow.class_id,
      subjectCandidates
    );

    if (!accessOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { error: delScoresErr } = await srv
      .from("student_grades")
      .delete()
      .eq("evaluation_id", evaluation_id);

    if (delScoresErr) {
      return NextResponse.json({ ok: false, error: delScoresErr.message }, { status: 400 });
    }

    const { error } = await srv
      .from("grade_evaluations")
      .delete()
      .eq("id", evaluation_id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("[teacher/grades/evaluations] unexpected DELETE", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "eval_delete_failed" },
      { status: 500 }
    );
  }
}

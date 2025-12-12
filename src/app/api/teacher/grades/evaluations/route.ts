import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { queueGradeNotificationsForEvaluation } from "@/lib/push/grades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";
type Role =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | "class_device"
  | string;

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

type Ctx =
  | {
      ok: true;
      supa: any;
      srv: ReturnType<typeof getSupabaseServiceClient>;
      userId: string;
      profileId: string;
      institutionId: string;
      roles: Set<Role>;
    }
  | {
      ok: false;
      supa: any;
      status: 401 | 403;
      error: string;
    };

/* ───────── Context ───────── */

async function getContext(): Promise<Ctx> {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supa.auth.getUser();

  if (authErr || !user?.id) {
    return { ok: false, supa, status: 401, error: "unauthorized" };
  }

  // ✅ IMPORTANT: pas de profiles.role chez toi
  const { data: profile, error: profErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr) {
    console.error("[teacher/grades/evaluations] profile error", profErr);
    return { ok: false, supa, status: 401, error: "profile_error" };
  }

  if (!profile?.id || !profile?.institution_id) {
    return { ok: false, supa, status: 403, error: "no_institution" };
  }

  const srv = getSupabaseServiceClient();

  // ✅ roles dans user_roles
  const roles = new Set<Role>();
  const { data: roleRows, error: rolesErr } = await srv
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("institution_id", profile.institution_id);

  if (rolesErr) {
    console.error("[teacher/grades/evaluations] user_roles error", rolesErr);
    // on continue quand même : l’accès prof sera validé par class_teachers
  } else if (Array.isArray(roleRows)) {
    for (const r of roleRows) roles.add(String((r as any).role) as Role);
  }

  return {
    ok: true,
    supa,
    srv,
    userId: user.id,
    profileId: profile.id,
    institutionId: profile.institution_id,
    roles,
  };
}

/* ───────── Helpers ───────── */

function isPrivileged(roles: Set<Role>) {
  return roles.has("super_admin") || roles.has("admin") || roles.has("educator");
}

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
 * Comme ton /api/teacher/grades/components :
 * - si subject_id est un subjects.id => globalId = subject_id
 * - si subject_id est un institution_subjects.id => globalId = subject_id lié
 * - si aucune correspondance => globalId = raw
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
  const { data: subj } = await srv.from("subjects").select("id").eq("id", raw).maybeSingle();
  if (subj?.id) {
    const { data: instSub } = await srv
      .from("institution_subjects")
      .select("id,subject_id")
      .eq("institution_id", institutionId)
      .eq("subject_id", subj.id)
      .maybeSingle();

    return { raw, globalId: subj.id, instId: instSub?.id ?? null };
  }

  // 2) raw est-il un institution_subjects.id ?
  const { data: instSub2 } = await srv
    .from("institution_subjects")
    .select("id,subject_id")
    .eq("institution_id", institutionId)
    .eq("id", raw)
    .maybeSingle();

  if (instSub2?.id) {
    return {
      raw,
      globalId: (instSub2.subject_id as string | null) ?? raw,
      instId: instSub2.id,
    };
  }

  // 3) fallback
  return { raw, globalId: raw, instId: null };
}

async function teacherHasAccessToClass(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  profileId: string,
  classId: string,
  subjectCandidates: string[]
) {
  // affectation prof + matière si possible
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

  // sinon affectation prof à la classe (fallback)
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
   GET
========================================== */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const classId = url.searchParams.get("class_id") || "";
    const rawSubjectId = url.searchParams.get("subject_id");
    const subjectParam = rawSubjectId && rawSubjectId !== "" ? rawSubjectId : null;

    const subjectComponentRaw =
      url.searchParams.get("subject_component_id") ??
      url.searchParams.get("subjectComponentId");
    const subjectComponentId =
      subjectComponentRaw && subjectComponentRaw !== "" ? subjectComponentRaw : null;

    if (!classId) {
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 200 });
    }

    const ctx = await getContext();
    if (!ctx.ok) {
      return NextResponse.json({ items: [] as EvalRow[] }, { status: ctx.status });
    }

    const { srv, institutionId, profileId, roles } = ctx;

    const classOk = await ensureClassInInstitution(srv, classId, institutionId);
    if (!classOk) {
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 403 });
    }

    const { raw, globalId, instId } = await resolveSubjectIds(srv, institutionId, subjectParam);
    const subjectCandidates = [raw, globalId, instId].filter((x): x is string => !!x);

    const accessOk = isPrivileged(roles)
      ? true
      : await teacherHasAccessToClass(srv, institutionId, profileId, classId, subjectCandidates);

    if (!accessOk) {
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 403 });
    }

    let q = srv
      .from("grade_evaluations")
      .select(
        "id,class_id,subject_id,subject_component_id,teacher_id,eval_date,eval_kind,scale,coeff,is_published,published_at"
      )
      .eq("class_id", classId);

    // ✅ un prof ne voit que ses évaluations (admins/educator voient tout)
    if (!isPrivileged(roles)) {
      q = q.eq("teacher_id", profileId);
    }

    if (subjectComponentId) {
      q = q.eq("subject_component_id", subjectComponentId);
    } else if (subjectParam === null) {
      q = q.is("subject_id", null);
    } else {
      q = q.eq("subject_id", globalId as string);
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
   POST
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

    if (!class_id || !eval_date || !eval_kind || typeof scale !== "number") {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const ctx = await getContext();
    if (!ctx.ok) {
      return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
    }

    const { srv, institutionId, profileId, roles } = ctx;

    const classOk = await ensureClassInInstitution(srv, class_id, institutionId);
    if (!classOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const subjRaw = subject_id && subject_id !== "" ? subject_id : null;
    const { raw, globalId, instId } = await resolveSubjectIds(srv, institutionId, subjRaw);
    const subjectCandidates = [raw, globalId, instId].filter((x): x is string => !!x);

    const accessOk = isPrivileged(roles)
      ? true
      : await teacherHasAccessToClass(srv, institutionId, profileId, class_id, subjectCandidates);

    if (!accessOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const subjectComponentIdNorm =
      typeof subjectComponentId === "string" && subjectComponentId.trim() !== ""
        ? subjectComponentId.trim()
        : typeof subject_component_id_raw === "string" && subject_component_id_raw.trim() !== ""
        ? subject_component_id_raw.trim()
        : null;

    const { data, error } = await srv
      .from("grade_evaluations")
      .insert({
        class_id,
        subject_id: subjRaw ? (globalId as string) : null,
        subject_component_id: subjectComponentIdNorm,
        teacher_id: profileId,
        eval_date,
        eval_kind,
        scale,
        coeff: typeof coeff === "number" ? coeff : 1,
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
   PATCH : publish/unpublish
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

    const ctx = await getContext();
    if (!ctx.ok) {
      return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
    }

    const { srv, institutionId, profileId, roles } = ctx;

    const { data: evalRow, error: evErr } = await srv
      .from("grade_evaluations")
      .select("id,class_id,subject_id,teacher_id,is_published")
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evalRow) {
      return NextResponse.json({ ok: false, error: "evaluation_not_found" }, { status: 404 });
    }

    const classOk = await ensureClassInInstitution(srv, evalRow.class_id, institutionId);
    if (!classOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // ✅ un prof ne publie que SES évaluations
    if (!isPrivileged(roles) && evalRow.teacher_id !== profileId) {
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
   DELETE
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

    const ctx = await getContext();
    if (!ctx.ok) {
      return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
    }

    const { srv, institutionId, profileId, roles } = ctx;

    const { data: evalRow, error: evErr } = await srv
      .from("grade_evaluations")
      .select("id,class_id,subject_id,teacher_id")
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evalRow) {
      return NextResponse.json({ ok: false, error: "evaluation_not_found" }, { status: 404 });
    }

    const classOk = await ensureClassInInstitution(srv, evalRow.class_id, institutionId);
    if (!classOk) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // ✅ un prof ne supprime que SES évaluations
    if (!isPrivileged(roles) && evalRow.teacher_id !== profileId) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { error: delScoresErr } = await srv
      .from("student_grades")
      .delete()
      .eq("evaluation_id", evaluation_id);

    if (delScoresErr) {
      return NextResponse.json({ ok: false, error: delScoresErr.message }, { status: 400 });
    }

    const { error } = await srv.from("grade_evaluations").delete().eq("id", evaluation_id);

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

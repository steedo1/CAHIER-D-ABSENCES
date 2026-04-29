// src/app/api/teacher/grades/evaluations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  getGradePublicationSettings,
  handleTeacherPublicationIntent,
  unpublishEvaluationOfficially,
} from "@/lib/grades/publication";
import { computeAcademicYear } from "@/lib/academicYear";

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

type PublicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "published"
  | string;

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  subject_component_id: string | null;
  grading_period_id: string | null;
  academic_year?: string | null;
  teacher_id: string | null;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
  published_at?: string | null;
  publication_status?: PublicationStatus | null;
  submitted_at?: string | null;
  submitted_by?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_comment?: string | null;
  publication_version?: number | null;
};

type GradePeriodRow = {
  id: string;
  institution_id: string;
  academic_year: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean | null;
  order_index: number | null;
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

async function getContext(): Promise<Ctx> {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supa.auth.getUser();

  if (authErr || !user?.id) {
    return { ok: false, supa, status: 401, error: "unauthorized" };
  }

  const { data: profile, error: profErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr) {
    console.error("[teacher/grades/evaluations] profile error", profErr);
    return { ok: false, supa, status: 401, error: "profile_error" };
  }

  if (!profile) {
    return { ok: false, supa, status: 403, error: "no_institution" };
  }

  const profileRow = profile as unknown as {
    id: string;
    institution_id: string | null;
  };

  if (!profileRow.id || !profileRow.institution_id) {
    return { ok: false, supa, status: 403, error: "no_institution" };
  }

  const srv = getSupabaseServiceClient();

  const roles = new Set<Role>();
  const { data: roleRows, error: rolesErr } = await srv
    .from("user_roles")
    .select("role")
    .eq("profile_id", profileRow.id)
    .eq("institution_id", profileRow.institution_id);

  if (rolesErr) {
    console.error("[teacher/grades/evaluations] user_roles error", rolesErr);
  } else if (Array.isArray(roleRows)) {
    for (const r of roleRows) roles.add(String((r as any).role) as Role);
  }

  return {
    ok: true,
    supa,
    srv,
    userId: user.id,
    profileId: profileRow.id,
    institutionId: profileRow.institution_id,
    roles,
  };
}

function isPrivileged(roles: Set<Role>) {
  return (
    roles.has("super_admin") || roles.has("admin") || roles.has("educator")
  );
}

function normalizeUuidLike(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v : null;
}

function computeAcademicYearFromEvalDate(evalDate: string): string {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(evalDate)
    ? new Date(`${evalDate}T12:00:00.000Z`)
    : new Date(evalDate);

  if (Number.isNaN(safe.getTime())) {
    throw new Error("invalid_eval_date");
  }

  return computeAcademicYear(safe);
}

function serverTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isGradePeriodClosed(period: GradePeriodRow | null): boolean {
  if (!period?.end_date) return false;
  return serverTodayIsoDate() > period.end_date;
}

function closedPeriodResponse(period: GradePeriodRow) {
  return NextResponse.json(
    {
      ok: false,
      error: "grading_period_closed",
      grading_period_id: period.id,
      period_end_date: period.end_date,
      today: serverTodayIsoDate(),
    },
    { status: 423 }
  );
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

  if (!cls) return false;

  const classRow = cls as unknown as {
    id: string;
    institution_id: string | null;
  };

  return classRow.institution_id === institutionId;
}

async function resolveSubjectIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  rawSubjectId?: string | null
): Promise<{ raw: string | null; globalId: string | null; instId: string | null }> {
  if (!rawSubjectId || rawSubjectId.trim() === "") {
    return { raw: null, globalId: null, instId: null };
  }

  const raw = rawSubjectId;

  const { data: subj } = await srv
    .from("subjects")
    .select("id")
    .eq("id", raw)
    .maybeSingle();

  const subjRow = subj as unknown as { id?: string } | null;

  if (subjRow?.id) {
    const { data: instSub } = await srv
      .from("institution_subjects")
      .select("id,subject_id")
      .eq("institution_id", institutionId)
      .eq("subject_id", subjRow.id)
      .maybeSingle();

    const instSubRow = instSub as unknown as {
      id?: string;
      subject_id?: string | null;
    } | null;

    return { raw, globalId: subjRow.id, instId: instSubRow?.id ?? null };
  }

  const { data: instSub2 } = await srv
    .from("institution_subjects")
    .select("id,subject_id")
    .eq("institution_id", institutionId)
    .eq("id", raw)
    .maybeSingle();

  const instSub2Row = instSub2 as unknown as {
    id?: string;
    subject_id?: string | null;
  } | null;

  if (instSub2Row?.id) {
    return {
      raw,
      globalId: instSub2Row.subject_id ?? raw,
      instId: instSub2Row.id,
    };
  }

  return { raw, globalId: raw, instId: null };
}

async function teacherHasAccessToClass(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  profileId: string,
  classId: string,
  subjectCandidates: string[]
) {
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

    if (Array.isArray(data) && data.length > 0) return true;
  }

  const { data: anyRow } = await srv
    .from("class_teachers")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .eq("teacher_id", profileId)
    .is("end_date", null)
    .limit(1);

  return !!(Array.isArray(anyRow) && anyRow.length > 0);
}

async function getGradePeriodById(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  gradingPeriodId: string
): Promise<GradePeriodRow | null> {
  const { data, error } = await srv
    .from("grade_periods")
    .select(
      "id,institution_id,academic_year,start_date,end_date,is_active,order_index"
    )
    .eq("id", gradingPeriodId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) {
    console.error("[teacher/grades/evaluations] getGradePeriodById error", {
      gradingPeriodId,
      institutionId,
      error,
    });
    return null;
  }

  return (data as unknown as GradePeriodRow | null) ?? null;
}

async function autoDetectGradePeriodId(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  academicYear: string,
  evalDate: string
): Promise<string | null> {
  const { data, error } = await srv
    .from("grade_periods")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("academic_year", academicYear)
    .eq("is_active", true)
    .lte("start_date", evalDate)
    .gte("end_date", evalDate)
    .order("order_index", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[teacher/grades/evaluations] autoDetectGradePeriodId error", {
      institutionId,
      academicYear,
      evalDate,
      error,
    });
    return null;
  }

  const row = Array.isArray(data) ? (data[0] as any) : null;

  return row?.id ? String(row.id) : null;
}

async function validateExplicitGradePeriod(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  gradingPeriodId: string,
  evalDate: string,
  academicYear: string
): Promise<{ ok: true; period: GradePeriodRow } | { ok: false; error: string }> {
  const period = await getGradePeriodById(srv, institutionId, gradingPeriodId);

  if (!period) {
    return { ok: false, error: "invalid_grading_period" };
  }

  if (period.is_active === false) {
    return { ok: false, error: "grading_period_inactive" };
  }

  if (period.academic_year !== academicYear) {
    return { ok: false, error: "grading_period_academic_year_mismatch" };
  }

  if (period.start_date && evalDate < period.start_date) {
    return { ok: false, error: "eval_date_outside_grading_period" };
  }

  if (period.end_date && evalDate > period.end_date) {
    return { ok: false, error: "eval_date_outside_grading_period" };
  }

  return { ok: true, period };
}

async function getClosedPeriodResponseIfNeeded(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  roles: Set<Role>,
  gradingPeriodId: string | null
): Promise<NextResponse | null> {
  if (isPrivileged(roles) || !gradingPeriodId) return null;

  const period = await getGradePeriodById(srv, institutionId, gradingPeriodId);
  if (!period) return null;

  if (isGradePeriodClosed(period)) {
    return closedPeriodResponse(period);
  }

  return null;
}

const EVALUATION_SELECT = [
  "id",
  "class_id",
  "subject_id",
  "subject_component_id",
  "grading_period_id",
  "academic_year",
  "teacher_id",
  "eval_date",
  "eval_kind",
  "scale",
  "coeff",
  "is_published",
  "published_at",
  "publication_status",
  "submitted_at",
  "submitted_by",
  "reviewed_at",
  "reviewed_by",
  "review_comment",
  "publication_version",
].join(",");

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const classId = url.searchParams.get("class_id") || "";
    const rawSubjectId = url.searchParams.get("subject_id");
    const subjectParam =
      rawSubjectId && rawSubjectId !== "" ? rawSubjectId : null;

    const subjectComponentRaw =
      url.searchParams.get("subject_component_id") ??
      url.searchParams.get("subjectComponentId");

    const subjectComponentId =
      subjectComponentRaw && subjectComponentRaw !== ""
        ? subjectComponentRaw
        : null;

    const gradingPeriodId =
      normalizeUuidLike(url.searchParams.get("grading_period_id")) ??
      normalizeUuidLike(url.searchParams.get("gradingPeriodId"));

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

    const { raw, globalId, instId } = await resolveSubjectIds(
      srv,
      institutionId,
      subjectParam
    );

    const subjectCandidates = [raw, globalId, instId].filter(
      (x): x is string => !!x
    );

    const accessOk = isPrivileged(roles)
      ? true
      : await teacherHasAccessToClass(
          srv,
          institutionId,
          profileId,
          classId,
          subjectCandidates
        );

    if (!accessOk) {
      return NextResponse.json({ items: [] as EvalRow[] }, { status: 403 });
    }

    if (gradingPeriodId) {
      const period = await getGradePeriodById(srv, institutionId, gradingPeriodId);

      if (!period) {
        return NextResponse.json({ items: [] as EvalRow[] }, { status: 200 });
      }
    }

    let q = srv
      .from("grade_evaluations")
      .select(EVALUATION_SELECT)
      .eq("class_id", classId);

    if (!isPrivileged(roles)) {
      q = q.eq("teacher_id", profileId);
    }

    if (gradingPeriodId) {
      q = q.eq("grading_period_id", gradingPeriodId);
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

    const items = (data ?? []) as unknown as EvalRow[];

    return NextResponse.json({ items }, { status: 200 });
  } catch (e) {
    console.error("[teacher/grades/evaluations] unexpected GET", e);
    return NextResponse.json({ items: [] as EvalRow[] }, { status: 500 });
  }
}

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
      subject_component_id: subject_component_id_raw,
      subjectComponentId,
      grading_period_id: grading_period_id_raw,
      gradingPeriodId,
      eval_date,
      eval_kind,
      scale,
      coeff,
    } = body as {
      class_id: string;
      subject_id?: string | null;
      subject_component_id?: string | null;
      subjectComponentId?: string | null;
      grading_period_id?: string | null;
      gradingPeriodId?: string | null;
      eval_date: string;
      eval_kind: EvalKind;
      scale: number;
      coeff: number;
    };

    if (!class_id || !eval_date || !eval_kind || typeof scale !== "number") {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 }
      );
    }

    const ctx = await getContext();

    if (!ctx.ok) {
      return NextResponse.json(
        { ok: false, error: ctx.error },
        { status: ctx.status }
      );
    }

    const { srv, institutionId, profileId, roles } = ctx;

    const classOk = await ensureClassInInstitution(srv, class_id, institutionId);

    if (!classOk) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    const subjRaw = subject_id && subject_id !== "" ? subject_id : null;

    const { raw, globalId, instId } = await resolveSubjectIds(
      srv,
      institutionId,
      subjRaw
    );

    const subjectCandidates = [raw, globalId, instId].filter(
      (x): x is string => !!x
    );

    const accessOk = isPrivileged(roles)
      ? true
      : await teacherHasAccessToClass(
          srv,
          institutionId,
          profileId,
          class_id,
          subjectCandidates
        );

    if (!accessOk) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    const subjectComponentIdNorm =
      typeof subjectComponentId === "string" && subjectComponentId.trim() !== ""
        ? subjectComponentId.trim()
        : typeof subject_component_id_raw === "string" &&
            subject_component_id_raw.trim() !== ""
          ? subject_component_id_raw.trim()
          : null;

    const explicitGradingPeriodId =
      normalizeUuidLike(gradingPeriodId) ??
      normalizeUuidLike(grading_period_id_raw);

    let academic_year: string;

    try {
      academic_year = computeAcademicYearFromEvalDate(eval_date);
    } catch {
      return NextResponse.json(
        { ok: false, error: "invalid_eval_date" },
        { status: 400 }
      );
    }

    let grading_period_id: string | null = null;
    let resolvedPeriod: GradePeriodRow | null = null;

    if (explicitGradingPeriodId) {
      const validated = await validateExplicitGradePeriod(
        srv,
        institutionId,
        explicitGradingPeriodId,
        eval_date,
        academic_year
      );

      if (!validated.ok) {
        return NextResponse.json(
          { ok: false, error: validated.error },
          { status: 400 }
        );
      }

      grading_period_id = validated.period.id;
      resolvedPeriod = validated.period;
    } else {
      grading_period_id = await autoDetectGradePeriodId(
        srv,
        institutionId,
        academic_year,
        eval_date
      );

      if (grading_period_id) {
        resolvedPeriod = await getGradePeriodById(
          srv,
          institutionId,
          grading_period_id
        );
      }
    }

    if (!isPrivileged(roles) && resolvedPeriod && isGradePeriodClosed(resolvedPeriod)) {
      return closedPeriodResponse(resolvedPeriod);
    }

    const { data, error } = await srv
      .from("grade_evaluations")
      .insert({
        class_id,
        subject_id: subjRaw ? (globalId as string) : null,
        subject_component_id: subjectComponentIdNorm,
        grading_period_id,
        academic_year,
        teacher_id: profileId,
        eval_date,
        eval_kind,
        scale,
        coeff: typeof coeff === "number" ? coeff : 1,
        is_published: false,
        published_at: null,
        publication_status: "draft",
        publication_version: 0,
      })
      .select(EVALUATION_SELECT)
      .single();

    if (error) {
      console.error("[teacher/grades/evaluations] POST error", error);

      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
    }

    const item = data as unknown as EvalRow;

    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (e: any) {
    console.error("[teacher/grades/evaluations] unexpected POST", e);

    return NextResponse.json(
      { ok: false, error: e?.message || "eval_create_failed" },
      { status: 500 }
    );
  }
}

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

    if (!evaluation_id) {
      return NextResponse.json(
        { ok: false, error: "missing_id" },
        { status: 400 }
      );
    }

    const ctx = await getContext();

    if (!ctx.ok) {
      return NextResponse.json(
        { ok: false, error: ctx.error },
        { status: ctx.status }
      );
    }

    const { srv, institutionId, profileId, roles } = ctx;

    const { data: evalRow, error: evErr } = await srv
      .from("grade_evaluations")
      .select(
        "id,class_id,subject_id,teacher_id,is_published,publication_status,grading_period_id"
      )
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evalRow) {
      return NextResponse.json(
        { ok: false, error: "evaluation_not_found" },
        { status: 404 }
      );
    }

    const ev = evalRow as unknown as {
      id: string;
      class_id: string;
      subject_id: string | null;
      teacher_id: string | null;
      is_published: boolean;
      publication_status: string | null;
      grading_period_id: string | null;
    };

    const classOk = await ensureClassInInstitution(
      srv,
      ev.class_id,
      institutionId
    );

    if (!classOk) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    if (!isPrivileged(roles) && ev.teacher_id !== profileId) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    const closedResp = await getClosedPeriodResponseIfNeeded(
      srv,
      institutionId,
      roles,
      normalizeUuidLike(ev.grading_period_id)
    );

    if (closedResp) return closedResp;

    if (typeof is_published !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "no_supported_patch_field" },
        { status: 400 }
      );
    }

    let publicationResult;

    if (is_published) {
      publicationResult = await handleTeacherPublicationIntent({
        evaluationId: evaluation_id,
        actorProfileId: profileId,
        comment: null,
      });
    } else {
      const settings = await getGradePublicationSettings(institutionId);

      if (
        settings.require_admin_validation &&
        !isPrivileged(roles) &&
        ev.is_published === true
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "teacher_cannot_unpublish_admin_validated_grade",
          },
          { status: 403 }
        );
      }

      publicationResult = await unpublishEvaluationOfficially({
        evaluationId: evaluation_id,
        actorProfileId: profileId,
        comment: "Évaluation repassée en brouillon depuis l’interface enseignant.",
      });
    }

    if (!publicationResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: publicationResult.error,
          details: publicationResult.details ?? null,
        },
        { status: publicationResult.status ?? 400 }
      );
    }

    const { data, error } = await srv
      .from("grade_evaluations")
      .select(EVALUATION_SELECT)
      .eq("id", evaluation_id)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: error?.message || "reload_failed" },
        { status: 400 }
      );
    }

    const item = data as unknown as EvalRow;

    return NextResponse.json(
      {
        ok: true,
        item,
        publication: publicationResult,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[teacher/grades/evaluations] unexpected PATCH", e);

    return NextResponse.json(
      { ok: false, error: e?.message || "eval_update_failed" },
      { status: 500 }
    );
  }
}

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

    if (!evaluation_id) {
      return NextResponse.json(
        { ok: false, error: "missing_id" },
        { status: 400 }
      );
    }

    const ctx = await getContext();

    if (!ctx.ok) {
      return NextResponse.json(
        { ok: false, error: ctx.error },
        { status: ctx.status }
      );
    }

    const { srv, institutionId, profileId, roles } = ctx;

    const { data: evalRow, error: evErr } = await srv
      .from("grade_evaluations")
      .select(
        [
          "id",
          "class_id",
          "subject_id",
          "teacher_id",
          "grading_period_id",
          "is_published",
          "publication_status",
          "published_at",
          "publication_version",
        ].join(",")
      )
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evalRow) {
      return NextResponse.json(
        { ok: false, error: "evaluation_not_found" },
        { status: 404 }
      );
    }

    const ev = evalRow as unknown as {
      id: string;
      class_id: string;
      subject_id: string | null;
      teacher_id: string | null;
      grading_period_id: string | null;
      is_published: boolean;
      publication_status: string | null;
      published_at: string | null;
      publication_version: number | null;
    };

    const publicationStatus = String(ev.publication_status || "draft").trim();

    if (
      ev.is_published === true ||
      publicationStatus === "published" ||
      publicationStatus === "submitted"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "evaluation_not_deletable_after_submission_or_publication",
          publication_status: publicationStatus,
          is_published: ev.is_published === true,
          published_at: ev.published_at ?? null,
          publication_version: ev.publication_version ?? null,
          message:
            "Cette évaluation est soumise ou publiée. Elle ne peut plus être supprimée directement.",
        },
        { status: 423 }
      );
    }

    const classOk = await ensureClassInInstitution(
      srv,
      ev.class_id,
      institutionId
    );

    if (!classOk) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    if (!isPrivileged(roles) && ev.teacher_id !== profileId) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    const closedResp = await getClosedPeriodResponseIfNeeded(
      srv,
      institutionId,
      roles,
      normalizeUuidLike(ev.grading_period_id)
    );

    if (closedResp) return closedResp;

    const { error: delScoresErr } = await srv
      .from("student_grades")
      .delete()
      .eq("evaluation_id", evaluation_id);

    if (delScoresErr) {
      return NextResponse.json(
        { ok: false, error: delScoresErr.message },
        { status: 400 }
      );
    }

    const { error } = await srv
      .from("grade_evaluations")
      .delete()
      .eq("id", evaluation_id);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
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
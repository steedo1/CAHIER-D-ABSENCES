// src/app/api/grades/evaluations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  handleTeacherPublicationIntent,
  unpublishEvaluationOfficially,
} from "@/lib/grades/publication";
import { computeAcademicYear } from "@/lib/academicYear";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type PublicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "published"
  | string;

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null; // ⇐ toujours un subjects.id en DB
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

  // ✅ Nouveau workflow publication
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

type UserRole = "super_admin" | "admin" | "educator" | "teacher" | "class_device" | string;

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

async function getUserRoles(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  profileId: string,
  institutionId: string
): Promise<Set<UserRole>> {
  const roles = new Set<UserRole>();

  const { data, error } = await srv
    .from("user_roles")
    .select("role")
    .eq("profile_id", profileId)
    .eq("institution_id", institutionId);

  if (error) {
    console.error("[grades/evaluations] getUserRoles error", error, {
      profileId,
      institutionId,
    });
    return roles;
  }

  for (const row of data ?? []) {
    const role = String((row as any).role || "").trim();
    if (role) roles.add(role);
  }

  return roles;
}

function isPrivileged(roles: Set<UserRole>) {
  return (
    roles.has("super_admin") ||
    roles.has("admin") ||
    roles.has("educator")
  );
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
  rawSubjectId?: string | null
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
        { institutionId, rawSubjectId: sid }
      );
      return subj.id;
    }
  } catch (err) {
    console.error(
      "[grades/evaluations] resolveSubjectIdToGlobal subjects error",
      err,
      { institutionId, sid }
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
        }
      );
      return instSub.subject_id;
    }
  } catch (err) {
    console.error(
      "[grades/evaluations] resolveSubjectIdToGlobal instSub error",
      err,
      { institutionId, sid }
    );
  }

  // 2) Aucun match clair → on renvoie la valeur brute (risque de FK si vraiment invalide)
  console.warn("[grades/evaluations] resolveSubjectIdToGlobal: no match", {
    institutionId,
    rawSubjectId: sid,
  });

  return sid;
}

/**
 * Détermine le teacher_id à enregistrer sur grade_evaluations.
 *
 * - Si l'utilisateur est un professeur "normal" → on met son profile.id
 * - Si c'est un compte-classe → on essaie de retrouver le prof via class_teachers
 *   pour (class_id, subject_id)
 * - Sinon on garde le profile.id en fallback.
 */
async function resolveTeacherIdForEvaluation(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  profileId: string,
  classId: string,
  rawSubjectId: string | null,
  resolvedSubjectId: string | null
): Promise<string | null> {
  try {
    const { data: roleRows, error: rolesErr } = await srv
      .from("user_roles")
      .select("role")
      .eq("profile_id", profileId)
      .eq("institution_id", institutionId);

    if (rolesErr) {
      console.error(
        "[grades/evaluations] resolveTeacherIdForEvaluation roles error",
        rolesErr
      );
      return profileId;
    }

    const roles = new Set<string>(
      (roleRows ?? []).map((r: any) => String(r.role))
    );

    const isTeacher = roles.has("teacher");
    const isClassDevice = roles.has("class_device");

    // Prof classique → on garde le prof lui-même
    if (isTeacher && !isClassDevice) {
      return profileId;
    }

    // Autre rôle sans class_device (admin qui crée une note par ex.)
    if (!isClassDevice) {
      return profileId;
    }

    // Compte-classe : on va chercher le prof de la classe
    const { data: ctRows, error: ctErr } = await srv
      .from("class_teachers")
      .select("teacher_id,subject_id")
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .is("end_date", null);

    if (ctErr) {
      console.error(
        "[grades/evaluations] resolveTeacherIdForEvaluation class_teachers error",
        ctErr
      );
      return profileId;
    }

    const rows = ctRows ?? [];

    if (!rows.length) {
      console.warn(
        "[grades/evaluations] resolveTeacherIdForEvaluation: aucun enseignant trouvé pour la classe",
        { classId, institutionId }
      );
      return profileId;
    }

    const matchByRaw = rawSubjectId
      ? rows.filter((r: any) => r.subject_id === rawSubjectId)
      : [];

    const matchByResolved = resolvedSubjectId
      ? rows.filter((r: any) => r.subject_id === resolvedSubjectId)
      : [];

    const candidates =
      matchByRaw.length > 0
        ? matchByRaw
        : matchByResolved.length > 0
          ? matchByResolved
          : rows;

    if (candidates.length === 1) {
      const tid = (candidates[0] as any).teacher_id || profileId;

      console.log(
        "[grades/evaluations] resolveTeacherIdForEvaluation: teacher trouvé pour compte-classe",
        { classId, rawSubjectId, resolvedSubjectId, teacher_id: tid }
      );

      return tid;
    }

    const chosen = (candidates[0] as any)?.teacher_id || profileId;

    console.warn(
      "[grades/evaluations] resolveTeacherIdForEvaluation: plusieurs enseignants possibles, on prend le premier",
      {
        classId,
        rawSubjectId,
        resolvedSubjectId,
        teacher_id: chosen,
      }
    );

    return chosen;
  } catch (err) {
    console.error(
      "[grades/evaluations] resolveTeacherIdForEvaluation unexpected error",
      err,
      { institutionId, profileId, classId }
    );

    return profileId;
  }
}

function normalizePublicationStatus(value: unknown): string {
  const v = String(value ?? "").trim();
  return v || "draft";
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
      error: "GRADING_PERIOD_CLOSED",
      grading_period_id: period.id,
      period_end_date: period.end_date,
      today: serverTodayIsoDate(),
      message: "Cette période est clôturée. La modification n’est plus autorisée.",
    },
    { status: 423 }
  );
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
    console.error("[grades/evaluations] getGradePeriodById error", {
      gradingPeriodId,
      institutionId,
      error,
    });
    return null;
  }

  return (data as GradePeriodRow | null) ?? null;
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
    console.error("[grades/evaluations] autoDetectGradePeriodId error", {
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
    return { ok: false, error: "INVALID_GRADING_PERIOD" };
  }

  if (period.is_active === false) {
    return { ok: false, error: "GRADING_PERIOD_INACTIVE" };
  }

  if (period.academic_year !== academicYear) {
    return { ok: false, error: "GRADING_PERIOD_ACADEMIC_YEAR_MISMATCH" };
  }

  if (period.start_date && evalDate < period.start_date) {
    return { ok: false, error: "EVAL_DATE_OUTSIDE_GRADING_PERIOD" };
  }

  if (period.end_date && evalDate > period.end_date) {
    return { ok: false, error: "EVAL_DATE_OUTSIDE_GRADING_PERIOD" };
  }

  return { ok: true, period };
}

async function getClosedPeriodResponseIfNeeded(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  roles: Set<UserRole>,
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


function normalizeLevelKey(value: unknown): string | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-.]/g, "");

  if (!raw) return null;

  if (["6", "6e", "6eme", "sixieme"].includes(raw)) return "6e";
  if (["5", "5e", "5eme", "cinquieme"].includes(raw)) return "5e";
  if (["4", "4e", "4eme", "quatrieme"].includes(raw)) return "4e";
  if (["3", "3e", "3eme", "troisieme"].includes(raw)) return "3e";

  return raw;
}

async function validateSubjectComponentForClass(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classId: string,
  resolvedSubjectId: string | null,
  subjectComponentId: string | null
): Promise<{ ok: true } | { ok: false; error: string; details?: Record<string, unknown> }> {
  if (!subjectComponentId) return { ok: true };

  if (!resolvedSubjectId) {
    return {
      ok: false,
      error: "INVALID_SUBJECT_COMPONENT",
      details: { reason: "missing_subject_id", subjectComponentId },
    };
  }

  const { data: cls, error: classError } = await srv
    .from("classes")
    .select("id,institution_id,level")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classError || !cls) {
    console.error("[grades/evaluations] validate component -> class error", {
      classId,
      institutionId,
      classError,
    });
    return { ok: false, error: "INVALID_CLASS_FOR_COMPONENT" };
  }

  const { data: component, error: componentError } = await srv
    .from("grade_subject_components")
    .select("id,institution_id,subject_id,level,code,label,is_active")
    .eq("id", subjectComponentId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (componentError || !component) {
    console.error("[grades/evaluations] validate component -> component error", {
      classId,
      institutionId,
      subjectComponentId,
      componentError,
    });
    return { ok: false, error: "INVALID_SUBJECT_COMPONENT" };
  }

  const componentRow = component as any;
  const classRow = cls as any;

  if (componentRow.is_active === false) {
    return {
      ok: false,
      error: "INACTIVE_SUBJECT_COMPONENT",
      details: { subjectComponentId },
    };
  }

  if (String(componentRow.subject_id || "") !== resolvedSubjectId) {
    return {
      ok: false,
      error: "SUBJECT_COMPONENT_SUBJECT_MISMATCH",
      details: {
        subjectComponentId,
        component_subject_id: componentRow.subject_id,
        resolvedSubjectId,
      },
    };
  }

  const classLevel = normalizeLevelKey(classRow.level);
  const componentLevel = normalizeLevelKey(componentRow.level);

  if (classLevel && componentLevel && classLevel !== componentLevel) {
    return {
      ok: false,
      error: "SUBJECT_COMPONENT_LEVEL_MISMATCH",
      details: {
        classLevel: classRow.level,
        componentLevel: componentRow.level,
        componentLabel: componentRow.label,
      },
    };
  }

  if (classLevel && !componentLevel) {
    const { data: exactRows, error: exactError } = await srv
      .from("grade_subject_components")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("subject_id", resolvedSubjectId)
      .eq("level", String(classRow.level || ""))
      .limit(1);

    if (!exactError && Array.isArray(exactRows) && exactRows.length > 0) {
      return {
        ok: false,
        error: "SUBJECT_COMPONENT_LEVEL_REQUIRED",
        details: {
          classLevel: classRow.level,
          subjectComponentId,
          componentLabel: componentRow.label,
        },
      };
    }
  }

  return { ok: true };
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

/* ==========================================
   GET : liste des évaluations
========================================== */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const classId = url.searchParams.get("class_id") || "";
    const subjectRaw = url.searchParams.get("subject_id");
    const subjectParam = subjectRaw && subjectRaw !== "" ? subjectRaw : null;

    const gradingPeriodId =
      normalizeUuidLike(url.searchParams.get("grading_period_id")) ??
      normalizeUuidLike(url.searchParams.get("gradingPeriodId"));

    // 🔹 sous-matière éventuelle (snake_case OU camelCase)
    const subjectComponentRaw =
      url.searchParams.get("subject_component_id") ??
      url.searchParams.get("subjectComponentId");

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
        gradingPeriodId,
      });

      return NextResponse.json({ items: [] as EvalRow[] }, { status: 401 });
    }

    console.log("[grades/evaluations] GET", {
      classId,
      subjectParam,
      subjectComponentId,
      gradingPeriodId,
      profileId: profile.id,
      institutionId: profile.institution_id,
    });

    const allowed = await ensureClassAccess(
      srv,
      classId,
      profile.institution_id
    );

    if (!allowed) {
      console.warn("[grades/evaluations] GET forbidden for class", {
        classId,
        institutionId: profile.institution_id,
      });

      return NextResponse.json({ items: [] as EvalRow[] }, { status: 200 });
    }

    if (gradingPeriodId) {
      const period = await getGradePeriodById(
        srv,
        profile.institution_id,
        gradingPeriodId
      );

      if (!period) {
        console.warn("[grades/evaluations] GET invalid grading period", {
          classId,
          gradingPeriodId,
          institutionId: profile.institution_id,
        });

        return NextResponse.json({ items: [] as EvalRow[] }, { status: 200 });
      }
    }

    // 🔁 On normalise toujours vers un subjects.id pour filtrer la table
    let effectiveSubjectId: string | null = null;

    if (subjectParam !== null) {
      effectiveSubjectId = await resolveSubjectIdToGlobal(
        srv,
        profile.institution_id,
        subjectParam
      );
    }

    let q = srv
      .from("grade_evaluations")
      .select(EVALUATION_SELECT)
      .eq("class_id", classId);

    if (gradingPeriodId) {
      q = q.eq("grading_period_id", gradingPeriodId);
    }

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
        gradingPeriodId,
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

    // 🔹 Normalisation du subject_component_id (camelCase OU snake_case)
    const subjectComponentIdNorm =
      typeof subjectComponentId === "string" && subjectComponentId.trim() !== ""
        ? subjectComponentId.trim()
        : typeof subject_component_id_raw === "string" &&
            subject_component_id_raw.trim() !== ""
          ? subject_component_id_raw.trim()
          : null;

    const resolvedSubjectId = await resolveSubjectIdToGlobal(
      srv,
      profile.institution_id,
      subjRaw
    );

    const componentValidation = await validateSubjectComponentForClass(
      srv,
      profile.institution_id,
      class_id,
      resolvedSubjectId,
      subjectComponentIdNorm
    );

    if (!componentValidation.ok) {
      const invalidComponent = componentValidation as {
        ok: false;
        error: string;
        details?: Record<string, unknown>;
      };

      console.warn("[grades/evaluations] POST invalid subject component", {
        class_id,
        subjectComponentIdNorm,
        resolvedSubjectId,
        error: invalidComponent.error,
        details: invalidComponent.details,
      });

      return NextResponse.json(
        {
          ok: false,
          error: invalidComponent.error,
          details: invalidComponent.details ?? null,
        },
        { status: 400 }
      );
    }

    const teacherId = await resolveTeacherIdForEvaluation(
      srv,
      profile.institution_id,
      profile.id,
      class_id,
      subjRaw,
      resolvedSubjectId
    );

    const explicitGradingPeriodId =
      normalizeUuidLike(gradingPeriodId) ??
      normalizeUuidLike(grading_period_id_raw);

    let academic_year: string;

    try {
      academic_year = computeAcademicYearFromEvalDate(eval_date);
    } catch {
      return NextResponse.json(
        { ok: false, error: "INVALID_EVAL_DATE" },
        { status: 400 }
      );
    }

    let grading_period_id: string | null = null;
    let resolvedPeriod: GradePeriodRow | null = null;

    if (explicitGradingPeriodId) {
      const validated = await validateExplicitGradePeriod(
        srv,
        profile.institution_id,
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
        profile.institution_id,
        academic_year,
        eval_date
      );

      if (grading_period_id) {
        resolvedPeriod = await getGradePeriodById(
          srv,
          profile.institution_id,
          grading_period_id
        );
      }
    }

    const roles = await getUserRoles(srv, profile.id, profile.institution_id);

    if (!isPrivileged(roles) && resolvedPeriod && isGradePeriodClosed(resolvedPeriod)) {
      return closedPeriodResponse(resolvedPeriod);
    }

    console.log("[grades/evaluations] POST resolved", {
      class_id,
      rawSubjectId: subjRaw,
      resolvedSubjectId,
      subjectComponentIdNorm,
      subjectComponentId,
      subject_component_id_raw,
      teacher_id: teacherId,
      grading_period_id,
      academic_year,
    });

    const { data, error } = await srv
      .from("grade_evaluations")
      .insert({
        class_id,
        subject_id: resolvedSubjectId,
        subject_component_id: subjectComponentIdNorm,
        grading_period_id,
        academic_year,
        teacher_id: teacherId,
        eval_date,
        eval_kind,
        scale,
        coeff,
        is_published: false,
        published_at: null,

        // ✅ explicite, même si la DB a déjà les defaults
        publication_status: "draft",
        publication_version: 0,
      })
      .select(EVALUATION_SELECT)
      .single();

    if (error) {
      console.error("[grades/evaluations] POST error", error, {
        class_id,
        resolvedSubjectId,
        teacherId,
        subjectComponentIdNorm,
        grading_period_id,
        academic_year,
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
   PATCH : mise à jour publication
   ✅ Passe désormais par le service central :
      - publication directe si l’établissement l’autorise
      - soumission si validation admin obligatoire
      - création snapshot officiel
      - push déclenché par le service central
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

    const { data: evalRow, error: evErr } = await srv
      .from("grade_evaluations")
      .select("id,class_id,is_published,publication_status,grading_period_id")
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

    const roles = await getUserRoles(srv, profile.id, profile.institution_id);

    const closedResp = await getClosedPeriodResponseIfNeeded(
      srv,
      profile.institution_id,
      roles,
      normalizeUuidLike((evalRow as any).grading_period_id)
    );

    if (closedResp) return closedResp;

    if (typeof is_published !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "no_supported_patch_field" },
        { status: 400 }
      );
    }

    const publicationResult = is_published
      ? await handleTeacherPublicationIntent({
          evaluationId: evaluation_id,
          actorProfileId: profile.id,
          comment: null,
        })
      : await unpublishEvaluationOfficially({
          evaluationId: evaluation_id,
          actorProfileId: profile.id,
          comment: "Évaluation repassée en brouillon depuis l’interface.",
        });

    if (!publicationResult.ok) {
      console.error("[grades/evaluations] publication service error", {
        evaluation_id,
        result: publicationResult,
      });

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
      console.error("[grades/evaluations] PATCH reload error", error);

      return NextResponse.json(
        { ok: false, error: error?.message || "reload_failed" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      item: data as EvalRow,
      publication: publicationResult,
    });
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
   👉 autorisée uniquement tant que l’évaluation n’est pas soumise/publiée
   👉 évite de supprimer les snapshots officiels grade_published_scores
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
      .select(
        [
          "id",
          "class_id",
          "is_published",
          "publication_status",
          "published_at",
          "publication_version",
          "grading_period_id",
        ].join(",")
      )
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evalRow) {
      console.error("[grades/evaluations] DELETE fetch eval error", evErr);

      return NextResponse.json(
        { ok: false, error: "evaluation_not_found" },
        { status: 404 }
      );
    }

    const publicationStatus = normalizePublicationStatus(
      (evalRow as any).publication_status
    );

    if (
      (evalRow as any).is_published === true ||
      publicationStatus === "published" ||
      publicationStatus === "submitted"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "evaluation_not_deletable_after_submission_or_publication",
          publication_status: publicationStatus,
          is_published: (evalRow as any).is_published === true,
          published_at: (evalRow as any).published_at ?? null,
          publication_version: (evalRow as any).publication_version ?? null,
          message:
            "Cette évaluation est soumise ou publiée. Elle ne peut plus être supprimée directement.",
        },
        { status: 423 }
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

    const roles = await getUserRoles(srv, profile.id, profile.institution_id);

    const closedResp = await getClosedPeriodResponseIfNeeded(
      srv,
      profile.institution_id,
      roles,
      normalizeUuidLike((evalRow as any).grading_period_id)
    );

    if (closedResp) return closedResp;

    // 1️⃣ Supprimer d'abord les notes de travail associées
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
    // Ici c’est sûr : l’évaluation n’est ni soumise ni publiée.
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
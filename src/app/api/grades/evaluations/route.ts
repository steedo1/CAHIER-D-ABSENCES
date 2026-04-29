// src/app/api/grades/evaluations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  handleTeacherPublicationIntent,
  unpublishEvaluationOfficially,
} from "@/lib/grades/publication";

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

const EVALUATION_SELECT = [
  "id",
  "class_id",
  "subject_id",
  "subject_component_id",
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
        { status: 400 }
      );
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

    const teacherId = await resolveTeacherIdForEvaluation(
      srv,
      profile.institution_id,
      profile.id,
      class_id,
      subjRaw,
      resolvedSubjectId
    );

    console.log("[grades/evaluations] POST resolved", {
      class_id,
      rawSubjectId: subjRaw,
      resolvedSubjectId,
      subjectComponentIdNorm,
      subjectComponentId,
      subject_component_id_raw,
      teacher_id: teacherId,
    });

    const { data, error } = await srv
      .from("grade_evaluations")
      .insert({
        class_id,
        subject_id: resolvedSubjectId,
        subject_component_id: subjectComponentIdNorm,
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
      .select("id,class_id,is_published,publication_status")
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
// src/app/api/grades/adjustments/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { computeAcademicYear } from "@/lib/academicYear";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_PREFIX = "[grades/adjustments/bulk]";

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type Item = {
  student_id: string;
  bonus?: number | string | null;
};

type AccessMode = "admin" | "teacher" | "class_device";

/* ───────────────── Access helper (prof / admin / compte-classe) ───────────────── */

async function getAccessModeForClass(
  svc: SupabaseClient,
  userId: string,
  classId: string
): Promise<{ mode: AccessMode | null; institutionId: string | null }> {
  const { data: profile, error: pErr } = await svc
    .from("profiles")
    .select("id,institution_id,phone")
    .eq("id", userId)
    .maybeSingle();

  if (pErr || !profile?.institution_id) {
    console.error(LOG_PREFIX, "profile error in getAccessModeForClass", pErr);
    return { mode: null, institutionId: null };
  }

  const { data: cls, error: cErr } = await svc
    .from("classes")
    .select("id,institution_id,class_phone_e164,device_phone_e164")
    .eq("id", classId)
    .maybeSingle();

  if (cErr || !cls) {
    console.error(LOG_PREFIX, "class error in getAccessModeForClass", cErr);
    return { mode: null, institutionId: null };
  }

  if (cls.institution_id !== profile.institution_id) {
    return { mode: null, institutionId: cls.institution_id as string | null };
  }

  const { data: roles, error: rErr } = await svc
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("institution_id", profile.institution_id);

  if (rErr) {
    console.error(LOG_PREFIX, "roles error in getAccessModeForClass", rErr);
  }

  const roleSet = new Set<string>((roles ?? []).map((r: any) => r.role));

  // 1) Admin / super_admin
  if (roleSet.has("super_admin") || roleSet.has("admin")) {
    return { mode: "admin", institutionId: cls.institution_id as string };
  }

  // 2) Professeur affecté à la classe
  if (roleSet.has("teacher")) {
    const { data: ct } = await svc
      .from("class_teachers")
      .select("id")
      .eq("class_id", classId)
      .eq("teacher_id", profile.id)
      .eq("institution_id", profile.institution_id)
      .is("end_date", null)
      .maybeSingle();

    if (ct) {
      return { mode: "teacher", institutionId: cls.institution_id as string };
    }
  }

  // 3) Compte-classe (téléphone associé)
  if (roleSet.has("class_device")) {
    const phone = profile.phone as string | null;

    if (
      phone &&
      (phone === cls.class_phone_e164 || phone === cls.device_phone_e164)
    ) {
      return {
        mode: "class_device",
        institutionId: cls.institution_id as string,
      };
    }
  }

  return { mode: null, institutionId: cls.institution_id as string | null };
}

/* ───────────────── Résolution subject_id local -> subject_id global ───────────────── */

async function resolveSubjectIdToGlobal(
  svc: SupabaseClient,
  institutionId: string | null,
  rawSubjectId: string | null
): Promise<string | null> {
  if (!institutionId || !rawSubjectId) return null;

  const trimmed = rawSubjectId.trim();
  if (!trimmed) return null;

  // 1) Cas où le frontend envoie déjà un subjects.id canonique
  const { data: subj } = await svc
    .from("subjects")
    .select("id")
    .eq("id", trimmed)
    .maybeSingle();

  if (subj?.id) {
    console.log(LOG_PREFIX, "resolveSubjectIdToGlobal: direct subjects", {
      institutionId,
      rawSubjectId: trimmed,
      resolved: subj.id,
    });

    return subj.id as string;
  }

  // 2) Cas compte-classe : l’ID vient de institution_subjects
  const { data: inst } = await svc
    .from("institution_subjects")
    .select("subject_id")
    .eq("id", trimmed)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (inst?.subject_id) {
    console.log(LOG_PREFIX, "resolveSubjectIdToGlobal: via institution_subjects", {
      institutionId,
      rawSubjectId: trimmed,
      resolved: inst.subject_id,
    });

    return inst.subject_id as string;
  }

  console.warn(LOG_PREFIX, "resolveSubjectIdToGlobal: not found", {
    institutionId,
    rawSubjectId: trimmed,
  });

  return null;
}

/**
 * Verrou métier des bonus.
 *
 * Pourquoi :
 * - les bonus influencent les moyennes ;
 * - une modification après soumission/publication peut modifier les bulletins ;
 * - on bloque donc les enseignants / comptes-classe si une évaluation liée
 *   est déjà soumise ou publiée.
 *
 * Admin :
 * - autorisé, car c'est une action administrative contrôlée.
 */
async function assertAdjustmentsEditable(params: {
  svc: SupabaseClient;
  mode: AccessMode;
  classId: string;
  subjectId: string | null;
  academicYear: string;
}) {
  const { svc, mode, classId, subjectId, academicYear } = params;

  if (mode === "admin") {
    return { ok: true as const };
  }

  let q = svc
    .from("grade_evaluations")
    .select("id, publication_status, is_published, published_at")
    .eq("class_id", classId)
    .eq("academic_year", academicYear)
    .or("is_published.eq.true,publication_status.eq.submitted,publication_status.eq.published")
    .limit(1);

  if (subjectId) {
    q = q.eq("subject_id", subjectId);
  }

  const { data, error } = await q;

  if (error) {
    console.error(LOG_PREFIX, "assertAdjustmentsEditable error", error, {
      classId,
      subjectId,
      academicYear,
      mode,
    });

    return {
      ok: false as const,
      status: 500,
      error: "ADJUSTMENT_LOCK_CHECK_FAILED",
      extra: {
        message: "Impossible de vérifier le verrou de publication des bonus.",
      },
    };
  }

  const blockingRow = Array.isArray(data) && data.length > 0 ? data[0] : null;

  if (blockingRow) {
    return {
      ok: false as const,
      status: 423,
      error: "ADJUSTMENTS_LOCKED_BY_PUBLICATION_WORKFLOW",
      extra: {
        editable: false,
        class_id: classId,
        subject_id: subjectId,
        academic_year: academicYear,
        evaluation_id: String((blockingRow as any).id || ""),
        publication_status: (blockingRow as any).publication_status ?? null,
        is_published: (blockingRow as any).is_published === true,
        published_at: (blockingRow as any).published_at ?? null,
        message:
          "Des évaluations sont déjà soumises ou publiées. Les bonus ne peuvent plus être modifiés par un enseignant ou un compte-classe.",
      },
    };
  }

  return { ok: true as const };
}

/* ==========================================
   POST : upsert des bonus (prof ou compte-classe)
========================================== */

export async function POST(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();

    const { data: auth } = await supabase.auth.getUser();

    if (!auth?.user) return bad("UNAUTHENTICATED", 401);

    const body = (await req.json().catch(() => ({}))) as {
      class_id?: string;
      subject_id?: string | null;
      academic_year?: string;
      items?: Item[];
    };

    const class_id = String(body.class_id || "").trim();

    const subject_id_raw =
      body.subject_id === undefined || body.subject_id === null
        ? null
        : String(body.subject_id).trim() || null;

    const academic_year =
      String(body.academic_year || "").trim() ||
      computeAcademicYear(new Date());

    const items: Item[] = Array.isArray(body.items) ? body.items : [];

    if (!class_id) return bad("class_id requis");
    if (!items.length) return bad("items vide");

    const svc = getSupabaseServiceClient();

    // Vérifier les droits + récupérer l'institution
    const { mode, institutionId } = await getAccessModeForClass(
      svc,
      auth.user.id,
      class_id
    );

    if (!mode || !institutionId) {
      return bad("FORBIDDEN", 403, { class_id });
    }

    // Résoudre l’ID local (institution_subjects.id) en ID canonique subjects.id
    const subject_id = await resolveSubjectIdToGlobal(
      svc,
      institutionId,
      subject_id_raw
    );

    if (subject_id_raw && !subject_id) {
      return bad("SUBJECT_NOT_FOUND", 400, {
        class_id,
        subject_id_raw,
        institution_id: institutionId,
      });
    }

    /*
     * ✅ Verrou publication avant upsert.
     *
     * - Bonus matière : on bloque si une évaluation de cette matière est soumise/publiée.
     * - Bonus général : on bloque si au moins une évaluation de la classe/année est soumise/publiée.
     * - Admin : autorisé.
     */
    const editable = await assertAdjustmentsEditable({
      svc,
      mode,
      classId: class_id,
      subjectId: subject_id,
      academicYear: academic_year,
    });

    if (!editable.ok) {
      console.warn(LOG_PREFIX, "adjustments locked", {
        class_id,
        subject_id_raw,
        subject_id_resolved: subject_id,
        academic_year,
        mode,
        error: editable.error,
      });

      return bad(editable.error, editable.status, editable.extra);
    }

    console.log(LOG_PREFIX, "POST", {
      class_id,
      subject_id_raw,
      subject_id_resolved: subject_id,
      academic_year,
      items_count: items.length,
      profile_id: auth.user.id,
      institution_id: institutionId,
      mode,
    });

    // Upsert dans grade_adjustments (SERVICE client → pas de RLS)
    let upserted = 0;

    for (const it of items) {
      const student_id = String(it?.student_id || "").trim();

      if (!student_id) continue;

      const rawBonus = it?.bonus;

      const n =
        rawBonus === "" || rawBonus === null || rawBonus === undefined
          ? 0
          : Number(rawBonus);

      if (!Number.isFinite(n)) {
        return bad("bonus invalide", 422, { student_id, bonus: rawBonus });
      }

      const bonus = round2(n);

      const { error } = await svc
        .from("grade_adjustments")
        .upsert(
          {
            class_id,
            // subject_id peut être null (bonus général) ou ID canonique de subjects
            subject_id: subject_id ?? null,
            student_id,
            academic_year,
            bonus,
          },
          {
            onConflict: "class_id,subject_id,student_id,academic_year",
          }
        );

      if (error) {
        console.error(LOG_PREFIX, "upsert error", error, {
          student_id,
          class_id,
          subject_id_raw,
          subject_id_resolved: subject_id,
          academic_year,
        });

        return bad(error.message || "UPSERT_FAILED", 400, { student_id });
      }

      upserted += 1;
    }

    return NextResponse.json({
      ok: true,
      upserted,
      locked_by_publication_workflow: false,
    });
  } catch (e: any) {
    console.error(LOG_PREFIX, "unexpected error", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}
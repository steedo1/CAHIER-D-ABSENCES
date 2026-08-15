// src/app/api/grades/adjustments/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { computeAcademicYear } from "@/lib/academicYear";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classDeviceMayAccessClass } from "@/lib/class-device-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_PREFIX = "[grades/adjustments/bulk]";

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function toNullishId(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  return s;
}

function serverTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

type Item = {
  student_id: string;
  bonus?: number | string | null;
};

type AccessMode = "admin" | "teacher" | "class_device";

type GradePeriodRow = {
  id: string;
  institution_id: string;
  academic_year: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean | null;
  order_index: number | null;
};

function isClosedByEndDate(period: GradePeriodRow | null): boolean {
  if (!period?.end_date) return false;
  return serverTodayIsoDate() > period.end_date;
}

/* ───────────────── Access helper prof / admin / compte-classe ───────────────── */

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

  if (roleSet.has("super_admin") || roleSet.has("admin")) {
    return { mode: "admin", institutionId: cls.institution_id as string };
  }

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

  if (roleSet.has("class_device")) {
    if (await classDeviceMayAccessClass({
      service: svc,
      userId: profile.id,
      userPhone: profile.phone,
      classId,
    })) {
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

/* ───────────────── Période ───────────────── */

async function getGradePeriodById(
  svc: SupabaseClient,
  institutionId: string,
  gradingPeriodId: string
): Promise<GradePeriodRow | null> {
  const { data, error } = await svc
    .from("grade_periods")
    .select(
      "id,institution_id,academic_year,start_date,end_date,is_active,order_index"
    )
    .eq("id", gradingPeriodId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) {
    console.error(LOG_PREFIX, "getGradePeriodById error", {
      institutionId,
      gradingPeriodId,
      error,
    });
    return null;
  }

  return (data as GradePeriodRow | null) ?? null;
}

function applyNullishEq<T extends { eq: Function; is: Function }>(
  query: T,
  column: string,
  value: string | null
): T {
  return value === null
    ? (query.is(column, null) as T)
    : (query.eq(column, value) as T);
}

/* ==========================================
   POST : upsert des bonus

   Règle métier :
   - la publication verrouille les notes brutes ;
   - la publication ne verrouille pas les bonus pédagogiques ;
   - les bonus restent modifiables par enseignant / compte-classe autorisé ;
   - le vrai verrou vient de la période clôturée ;
   - si grading_period_id est fourni, le bonus est rattaché à la période ;
   - sinon, compatibilité historique par année scolaire.
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
      grading_period_id?: string | null;
      gradingPeriodId?: string | null;
      items?: Item[];
    };

    const class_id = String(body.class_id || "").trim();

    const subject_id_raw =
      body.subject_id === undefined || body.subject_id === null
        ? null
        : String(body.subject_id).trim() || null;

    const requested_period_id =
      toNullishId(body.gradingPeriodId) ?? toNullishId(body.grading_period_id);

    let academic_year =
      String(body.academic_year || "").trim() || computeAcademicYear(new Date());

    const items: Item[] = Array.isArray(body.items) ? body.items : [];

    if (!class_id) return bad("class_id requis");
    if (!items.length) return bad("items vide");

    const svc = getSupabaseServiceClient();

    const { mode, institutionId } = await getAccessModeForClass(
      svc,
      auth.user.id,
      class_id
    );

    if (!mode || !institutionId) {
      return bad("FORBIDDEN", 403, { class_id });
    }

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

    let grading_period_id: string | null = null;
    let period: GradePeriodRow | null = null;

    if (requested_period_id) {
      period = await getGradePeriodById(svc, institutionId, requested_period_id);

      if (!period) {
        return bad("INVALID_GRADING_PERIOD", 400, {
          grading_period_id: requested_period_id,
        });
      }

      if (period.is_active === false) {
        return bad("GRADING_PERIOD_INACTIVE", 400, {
          grading_period_id: requested_period_id,
        });
      }

      academic_year = period.academic_year;
      grading_period_id = period.id;
    }

    if (
      (mode === "teacher" || mode === "class_device") &&
      period &&
      isClosedByEndDate(period)
    ) {
      return bad("GRADING_PERIOD_CLOSED", 423, {
        class_id,
        grading_period_id: period.id,
        period_end_date: period.end_date,
        today: serverTodayIsoDate(),
      });
    }

    console.log(LOG_PREFIX, "POST", {
      class_id,
      subject_id_raw,
      subject_id_resolved: subject_id,
      academic_year,
      grading_period_id,
      items_count: items.length,
      profile_id: auth.user.id,
      institution_id: institutionId,
      mode,
    });

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

      /*
       * Upsert manuel non cassant :
       * On évite de dépendre d'une contrainte unique précise.
       * Cela fonctionne avec :
       * - anciens bonus sans grading_period_id ;
       * - nouveaux bonus par période ;
       * - subject_id null pour bonus général.
       */
      let lookup = svc
        .from("grade_adjustments")
        .select("id")
        .eq("class_id", class_id)
        .eq("student_id", student_id)
        .eq("academic_year", academic_year)
        .limit(1);

      lookup = applyNullishEq(lookup, "subject_id", subject_id);
      lookup = applyNullishEq(lookup, "grading_period_id", grading_period_id);

      const { data: existingRows, error: lookupErr } = await lookup;

      if (lookupErr) {
        console.error(LOG_PREFIX, "lookup error", lookupErr, {
          student_id,
          class_id,
          subject_id,
          academic_year,
          grading_period_id,
        });

        return bad(lookupErr.message || "LOOKUP_FAILED", 400, { student_id });
      }

      const existingId =
        Array.isArray(existingRows) && existingRows.length > 0
          ? ((existingRows[0] as any).id as string)
          : null;

      if (existingId) {
        const { error: updErr } = await svc
          .from("grade_adjustments")
          .update({
            bonus,
            subject_id,
            grading_period_id,
            academic_year,
          })
          .eq("id", existingId);

        if (updErr) {
          console.error(LOG_PREFIX, "update error", updErr, {
            existingId,
            student_id,
            class_id,
            subject_id,
            academic_year,
            grading_period_id,
          });

          return bad(updErr.message || "UPDATE_FAILED", 400, { student_id });
        }
      } else {
        const { error: insErr } = await svc
          .from("grade_adjustments")
          .insert({
            class_id,
            subject_id,
            student_id,
            academic_year,
            grading_period_id,
            bonus,
          });

        if (insErr) {
          console.error(LOG_PREFIX, "insert error", insErr, {
            student_id,
            class_id,
            subject_id,
            academic_year,
            grading_period_id,
          });

          return bad(insErr.message || "INSERT_FAILED", 400, { student_id });
        }
      }

      upserted += 1;
    }

    return NextResponse.json({
      ok: true,
      upserted,
      academic_year,
      grading_period_id,
      locked_by_publication_workflow: false,
      publication_workflow_locked: false,
    });
  } catch (e: any) {
    console.error(LOG_PREFIX, "unexpected error", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}

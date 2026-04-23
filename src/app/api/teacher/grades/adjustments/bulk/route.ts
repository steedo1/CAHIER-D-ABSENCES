import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { computeAcademicYear } from "@/lib/academicYear";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function toNullishSubjectId(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "null") return null;
  return s;
}

function toNullishId(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "null") return null;
  return s;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
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

/**
 * Même logique que dans /api/teacher/grades/evaluations :
 * vérifie comment l'utilisateur accède à la classe.
 */
async function getAccessModeForClass(
  svc: SupabaseClient,
  userId: string,
  classId: string
): Promise<AccessMode | null> {
  const { data: profile, error: pErr } = await svc
    .from("profiles")
    .select("id,institution_id,phone")
    .eq("id", userId)
    .maybeSingle();

  if (pErr || !profile?.institution_id) {
    console.error(
      "[teacher/grades/adjustments] profile error in getAccessModeForClass",
      pErr
    );
    return null;
  }

  const { data: cls, error: cErr } = await svc
    .from("classes")
    .select("id,institution_id,class_phone_e164,device_phone_e164")
    .eq("id", classId)
    .maybeSingle();

  if (cErr || !cls) {
    console.error(
      "[teacher/grades/adjustments] class error in getAccessModeForClass",
      cErr
    );
    return null;
  }

  if (cls.institution_id !== profile.institution_id) {
    return null;
  }

  const { data: roles, error: rErr } = await svc
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("institution_id", profile.institution_id);

  if (rErr) {
    console.error(
      "[teacher/grades/adjustments] roles error in getAccessModeForClass",
      rErr
    );
  }

  const roleSet = new Set<string>((roles ?? []).map((r: any) => r.role as string));

  if (roleSet.has("super_admin") || roleSet.has("admin")) {
    return "admin";
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

    if (ct) return "teacher";
  }

  if (roleSet.has("class_device")) {
    const phone = profile.phone as string | null;
    if (
      phone &&
      (phone === cls.class_phone_e164 || phone === cls.device_phone_e164)
    ) {
      return "class_device";
    }
  }

  return null;
}

async function getInstitutionIdForClass(
  svc: SupabaseClient,
  classId: string
): Promise<string | null> {
  const { data, error } = await svc
    .from("classes")
    .select("institution_id")
    .eq("id", classId)
    .maybeSingle();

  if (error) {
    console.error(
      "[teacher/grades/adjustments] getInstitutionIdForClass error",
      error
    );
    return null;
  }

  return (data?.institution_id as string | null) ?? null;
}

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
    console.error("[teacher/grades/adjustments] getGradePeriodById error", {
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
  return value === null ? (query.is(column, null) as T) : (query.eq(column, value) as T);
}

/* ==========================================
   POST : upsert manuel des bonus par élève
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
    const subject_id = toNullishSubjectId(body.subject_id);
    const requested_period_id =
      toNullishId(body.gradingPeriodId) ?? toNullishId(body.grading_period_id);

    let academic_year =
      String(body.academic_year || "").trim() || computeAcademicYear(new Date());

    const items = Array.isArray(body.items) ? body.items : [];

    if (!class_id) return bad("class_id requis");
    if (!items.length) return bad("items vide");

    const svc = getSupabaseServiceClient();

    const mode = await getAccessModeForClass(svc, auth.user.id, class_id);
    if (!mode) {
      return bad("FORBIDDEN", 403, { class_id });
    }

    const institutionId = await getInstitutionIdForClass(svc, class_id);
    if (!institutionId) {
      return bad("CLASS_OR_INSTITUTION_NOT_FOUND", 400, { class_id });
    }

    let grading_period_id: string | null = null;

    if (requested_period_id) {
      const period = await getGradePeriodById(
        svc,
        institutionId,
        requested_period_id
      );

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

      // 1) Chercher une ligne existante exactement sur
      //    class_id + subject_id + student_id + academic_year + grading_period_id
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
        console.error("[teacher/grades/adjustments] lookup error", lookupErr, {
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
          ? (existingRows[0] as any).id as string
          : null;

      if (existingId) {
        // 2) Update ciblé si trouvé
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
          console.error("[teacher/grades/adjustments] update error", updErr, {
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
        // 3) Insert si absent
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
          console.error("[teacher/grades/adjustments] insert error", insErr, {
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
    });
  } catch (e: any) {
    console.error("[teacher/grades/adjustments] unexpected error", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}
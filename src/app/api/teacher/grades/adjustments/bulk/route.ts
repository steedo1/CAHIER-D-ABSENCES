// src/app/api/teacher/grades/adjustments/bulk/route.ts
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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type Item = {
  student_id: string;
  bonus?: number | string | null;
};

type AccessMode = "admin" | "teacher" | "class_device";

/**
 * Même logique que dans /api/teacher/grades/evaluations :
 * vérifie comment l'utilisateur accède à la classe.
 */
async function getAccessModeForClass(
  svc: SupabaseClient,
  userId: string,
  classId: string,
): Promise<AccessMode | null> {
  // Profil (institution + téléphone)
  const { data: profile, error: pErr } = await svc
    .from("profiles")
    .select("id,institution_id,phone")
    .eq("id", userId)
    .maybeSingle();

  if (pErr || !profile?.institution_id) {
    console.error(
      "[teacher/grades/adjustments] profile error in getAccessModeForClass",
      pErr,
    );
    return null;
  }

  // Classe
  const { data: cls, error: cErr } = await svc
    .from("classes")
    .select("id,institution_id,class_phone_e164,device_phone_e164")
    .eq("id", classId)
    .maybeSingle();

  if (cErr || !cls) {
    console.error(
      "[teacher/grades/adjustments] class error in getAccessModeForClass",
      cErr,
    );
    return null;
  }

  if (cls.institution_id !== profile.institution_id) {
    return null;
  }

  // Rôles
  const { data: roles, error: rErr } = await svc
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("institution_id", profile.institution_id);

  if (rErr) {
    console.error(
      "[teacher/grades/adjustments] roles error in getAccessModeForClass",
      rErr,
    );
  }

  const roleSet = new Set<string>((roles ?? []).map((r: any) => r.role as string));

  // 1) Admin / super_admin → OK
  if (roleSet.has("super_admin") || roleSet.has("admin")) {
    return "admin";
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

    if (ct) return "teacher";
  }

  // 3) Compte-classe (téléphone associé à la classe)
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

/* ==========================================
   POST : upsert des bonus par élève (enseignant)
========================================== */
export async function POST(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();

    // Auth côté user (cookies)
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return bad("UNAUTHENTICATED", 401);

    // Payload
    const body = (await req.json().catch(() => ({}))) as {
      class_id?: string;
      subject_id?: string | null;
      academic_year?: string;
      items?: Item[];
    };

    const class_id = String(body.class_id || "").trim();
    const subject_id = toNullishSubjectId(body.subject_id);
    const academic_year =
      String(body.academic_year || "").trim() || computeAcademicYear(new Date());
    const items = Array.isArray(body.items) ? body.items : [];

    if (!class_id) return bad("class_id requis");
    if (!items.length) return bad("items vide");

    const svc = getSupabaseServiceClient();

    // Vérifier les droits sur la classe via le service client
    const mode = await getAccessModeForClass(svc, auth.user.id, class_id);
    if (!mode) {
      return bad("FORBIDDEN", 403, { class_id });
    }

    // Upsert via SERVICE CLIENT → ne subit pas la RLS de grade_adjustments
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
            subject_id, // peut être null (moyenne générale)
            student_id,
            academic_year,
            bonus,
          },
          {
            onConflict: "class_id,subject_id,student_id,academic_year",
          },
        );

      if (error) {
        console.error(
          "[teacher/grades/adjustments] upsert error",
          error,
          { student_id, class_id, subject_id, academic_year },
        );
        // 400 pour rester cohérent avec les autres routes
        return bad(error.message || "UPSERT_FAILED", 400, { student_id });
      }

      upserted += 1;
    }

    return NextResponse.json({ ok: true, upserted });
  } catch (e: any) {
    console.error("[teacher/grades/adjustments] unexpected error", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}

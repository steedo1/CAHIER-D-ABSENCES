// src/app/api/admin/grades/predict/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type PredictBody = {
  class_id?: string;
  academic_year?: string;
  exam_date?: string;               // "YYYY-MM-DD"
  core_completion_percent?: number; // 0..100
};

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    // 1) Auth
    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2) Institution de l'utilisateur
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("id,institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr) {
      return NextResponse.json({ error: meErr.message }, { status: 400 });
    }

    const institution_id = (me?.institution_id as string) || null;
    if (!institution_id) {
      return NextResponse.json(
        { error: "no_institution", message: "Aucune institution associée à ce compte." },
        { status: 400 }
      );
    }

    // 3) Vérifier rôle admin / super_admin
    const { data: roleRow } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id)
      .maybeSingle();

    const role = (roleRow?.role as Role | undefined) || "";
    if (!["admin", "super_admin"].includes(role)) {
      return NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants pour lancer une prédiction." },
        { status: 403 }
      );
    }

    // 4) Lecture du body
    const body = (await req.json().catch(() => ({}))) as PredictBody;

    const class_id = String(body.class_id || "").trim();
    const academic_year = String(body.academic_year || "").trim();
    const exam_date = String(body.exam_date || "").trim();
    const core_completion_percent =
      typeof body.core_completion_percent === "number"
        ? body.core_completion_percent
        : NaN;

    if (!class_id) {
      return NextResponse.json(
        { error: "class_id_required", message: "class_id est obligatoire." },
        { status: 400 }
      );
    }
    if (!academic_year) {
      return NextResponse.json(
        { error: "academic_year_required", message: "academic_year est obligatoire." },
        { status: 400 }
      );
    }
    if (!exam_date) {
      return NextResponse.json(
        { error: "exam_date_required", message: "exam_date est obligatoire (YYYY-MM-DD)." },
        { status: 400 }
      );
    }
    if (!Number.isFinite(core_completion_percent)) {
      return NextResponse.json(
        {
          error: "core_completion_required",
          message: "core_completion_percent (0–100) est obligatoire.",
        },
        { status: 400 }
      );
    }

    // 5) Vérifier que la classe appartient bien à l'établissement
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,institution_id,label,level,academic_year")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json({ error: clsErr.message }, { status: 400 });
    }
    if (!cls) {
      return NextResponse.json(
        { error: "class_not_found", message: "Classe introuvable." },
        { status: 404 }
      );
    }
    if (cls.institution_id !== institution_id) {
      return NextResponse.json(
        { error: "invalid_class", message: "Cette classe n'appartient pas à votre établissement." },
        { status: 400 }
      );
    }

    // Optionnel : cohérence année scolaire
    if (cls.academic_year && typeof cls.academic_year === "string") {
      const clsYear = String(cls.academic_year);
      if (clsYear && clsYear !== academic_year) {
        // On ne bloque pas, on prévient juste
        // (si tu veux bloquer, remplace par un return 400)
        // console.warn("academic_year différent de celui de la classe", clsYear, academic_year);
      }
    }

    // 6) Appel de la fonction SQL de prédiction
    const { data: predData, error: predErr } = await srv.rpc(
      "predict_success_for_class",
      {
        p_institution_id: institution_id,
        p_class_id: class_id,
        p_academic_year: academic_year,
        p_exam_date: exam_date,
        p_core_completion_percent: core_completion_percent,
      }
    );

    if (predErr) {
      return NextResponse.json({ error: predErr.message }, { status: 400 });
    }

    const predictions = (predData || []) as Array<{
      student_id: string;
      last_name: string | null;
      first_name: string | null;
      matricule: string | null;
      academic_year: string;
      class_id: string;
      class_label: string | null;
      class_level: string | null;
      general_avg_20: number | null;
      raw_all_avg_20: number | null;
      raw_core_avg_20: number | null;
      bonus_effect_20: number | null;
      draft_ratio: number | null;
      bonus_points_total: number | null;
      presence_rate: number | null;
      total_absent_hours: number | null;
      nb_lates: number | null;
      conduct_total_20: number | null;
      conduct_norm: number | null;
      class_size: number | null;
      class_size_norm: number | null;
      p_success: number | null;
      risk_level: string;
    }>;

    const class_predicted_success_rate =
      predictions.length > 0
        ? predictions.reduce(
            (acc, row) => acc + (row.p_success ?? 0),
            0
          ) / predictions.length
        : null;

    return NextResponse.json({
      ok: true,
      class_id,
      class_label: (cls as any).label ?? null,
      class_level: (cls as any).level ?? null,
      academic_year,
      exam_date,
      core_completion_percent,
      class_predicted_success_rate,
      students: predictions,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "predict_failed" },
      { status: 500 }
    );
  }
}

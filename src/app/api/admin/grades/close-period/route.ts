//src/app/api/admin/grades/close-period/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type CloseBody = {
  class_id?: string;
  academic_year?: string;
  period_label?: string;   // "Fin T1", "Fin T2", "Fin d'année"
  snapshot_date?: string;  // optionnel (YYYY-MM-DD)
  generate_labels?: boolean; // true seulement pour "Fin d'année"
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
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // 2) Institution de l'utilisateur
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("id,institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr) {
      return NextResponse.json({ ok: false, error: meErr.message }, { status: 400 });
    }

    const institution_id = (me?.institution_id as string) || null;
    if (!institution_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_institution",
          message: "Aucune institution associée à ce compte.",
        },
        { status: 400 }
      );
    }

    // 3) Rôle admin / super_admin
    const { data: roleRow } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id)
      .maybeSingle();

    const role = (roleRow?.role as Role | undefined) || "";
    if (!["admin", "super_admin"].includes(role)) {
      return NextResponse.json(
        {
          ok: false,
          error: "forbidden",
          message: "Droits insuffisants pour clôturer une période.",
        },
        { status: 403 }
      );
    }

    // 4) Body
    const body = (await req.json().catch(() => ({}))) as CloseBody;

    const class_id = String(body.class_id || "").trim();
    const academic_year = String(body.academic_year || "").trim();
    const period_label = String(body.period_label || "").trim();
    const snapshot_date_raw = String(body.snapshot_date || "").slice(0, 10);
    const generate_labels = Boolean(body.generate_labels);

    if (!class_id || !academic_year || !period_label) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_params",
          message: "class_id, academic_year et period_label sont requis.",
        },
        { status: 400 }
      );
    }

    // 5) Vérifier la classe
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,institution_id,label,level,academic_year")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json({ ok: false, error: clsErr.message }, { status: 400 });
    }
    if (!cls || cls.institution_id !== institution_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_class",
          message: "Classe introuvable pour cette institution.",
        },
        { status: 400 }
      );
    }

    const snapshotDate =
      snapshot_date_raw && !Number.isNaN(new Date(snapshot_date_raw).getTime())
        ? snapshot_date_raw
        : new Date().toISOString().slice(0, 10);

    // 6) Snapshot des features (T1/T2/Année)
    const { error: snapErr } = await srv.rpc("snapshot_student_features_for_class", {
      p_institution_id: institution_id,
      p_class_id: class_id,
      p_academic_year: academic_year,
      p_snapshot_date: snapshotDate,
      p_period_label: period_label,
    });

    if (snapErr) {
      return NextResponse.json(
        { ok: false, error: snapErr.message || "snapshot_failed" },
        { status: 400 }
      );
    }

    // 7) Optionnel : création des labels ML pour fin d'année
    if (generate_labels) {
      const { error: labelErr } = await srv.rpc(
        "generate_training_labels_for_class",
        {
          p_institution_id: institution_id,
          p_class_id: class_id,
          p_academic_year: academic_year,
        }
      );

      if (labelErr) {
        return NextResponse.json(
          {
            ok: true,
            warning: labelErr.message,
            snapshot_date: snapshotDate,
            class: {
              id: cls.id,
              label: (cls as any).label ?? null,
              level: (cls as any).level ?? null,
              academic_year: (cls as any).academic_year ?? null,
            },
          },
          { status: 200 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        snapshot_date: snapshotDate,
        class: {
          id: cls.id,
          label: (cls as any).label ?? null,
          level: (cls as any).level ?? null,
          academic_year: (cls as any).academic_year ?? null,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "close_period_failed" },
      { status: 500 }
    );
  }
}

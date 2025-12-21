// src/app/api/admin/ml/snapshot-class/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type SnapshotBody = {
  class_id?: string;
  academic_year?: string;
  snapshot_date?: string; // "YYYY-MM-DD" optionnel
  period_label?: string;  // "Fin T1", "Fin T2", "Fin d'année", etc.
};

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Institution de l'utilisateur
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

    // Rôle admin / super_admin
    const { data: roleRow, error: roleErr } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id)
      .maybeSingle();

    if (roleErr) {
      return NextResponse.json({ error: roleErr.message }, { status: 400 });
    }

    const role = (roleRow?.role as Role | undefined) || "";
    if (!["admin", "super_admin"].includes(role)) {
      return NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants pour créer un snapshot ML." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as SnapshotBody;

    const class_id = String(body.class_id || "").trim();
    const academic_year = String(body.academic_year || "").trim();
    const period_label = (body.period_label && String(body.period_label).trim()) || null;
    const snapshot_date_str = String(body.snapshot_date || "").trim();

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

    const snapshot_date =
      snapshot_date_str && /^\d{4}-\d{2}-\d{2}$/.test(snapshot_date_str)
        ? snapshot_date_str
        : new Date().toISOString().slice(0, 10); // aujourd'hui

    // Vérifier que la classe appartient bien à l'établissement
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

    // Appel de la fonction SQL de snapshot
    const { error: rpcErr } = await srv.rpc("snapshot_student_features_for_class", {
      p_institution_id: institution_id,
      p_class_id: class_id,
      p_academic_year: academic_year,
      p_snapshot_date: snapshot_date,
      p_period_label: period_label,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      institution_id,
      class_id,
      academic_year,
      snapshot_date,
      period_label,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "snapshot_failed" },
      { status: 500 }
    );
  }
}

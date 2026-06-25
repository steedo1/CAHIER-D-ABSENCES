import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | string;

async function getAdminContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return { error: "unauthorized" as const, status: 401 as const };

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return { error: meErr.message, status: 400 as const };
  const institution_id = (me?.institution_id as string) || null;
  if (!institution_id) return { error: "no_institution", status: 400 as const };

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  const role = ((roleRow?.role as Role | undefined) || "") as Role;
  if (!["admin", "super_admin"].includes(role)) {
    return { error: "forbidden", status: 403 as const };
  }

  return { srv, user, institution_id, role };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAdminContext();
    if ("error" in ctx) {
      return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
    }

    const url = new URL(req.url);
    const academic_year = String(url.searchParams.get("academic_year") || "").trim();

    if (!academic_year) {
      return NextResponse.json(
        { ok: false, error: "academic_year_required", message: "academic_year est obligatoire." },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.srv
      .from("ai_training_samples")
      .select("*")
      .eq("institution_id", ctx.institution_id)
      .eq("academic_year", academic_year)
      .order("snapshot_date", { ascending: true })
      .limit(20000);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      model_key: "mon_cahier_ai_pedagogy",
      academic_year,
      rows_count: (data || []).length,
      rows: data || [],
      note:
        "Export destiné au script Python src/ai-service/train_mon_cahier_model.py. Les données doivent être anonymisées avant tout partage externe.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "training_export_failed" },
      { status: 500 },
    );
  }
}

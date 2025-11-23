import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

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
        { ok: false, error: "no_institution", message: "Aucune institution associée à ce compte." },
        { status: 400 }
      );
    }

    const [
      { data: classes, error: clsErr },
      { data: years, error: yearErr },
      { data: subjectCoeffs, error: coeffErr },
    ] = await Promise.all([
      srv
        .from("classes")
        .select("id,label,level,academic_year")
        .eq("institution_id", institution_id)
        .order("level", { ascending: true })
        .order("label", { ascending: true }),
      srv
        .from("academic_years")
        .select("code,label,start_date,end_date,is_current")
        .eq("institution_id", institution_id)
        .order("start_date", { ascending: false }),
      srv
        .from("institution_subject_coeffs")
        .select(
          `
          subject_id,
          coeff,
          level,
          include_in_average,
          subjects:subject_id (
            name,
            code,
            subject_key
          )
        `
        )
        .eq("institution_id", institution_id)
        .eq("include_in_average", true),
    ]);

    if (clsErr) return NextResponse.json({ ok: false, error: clsErr.message }, { status: 400 });
    if (yearErr) return NextResponse.json({ ok: false, error: yearErr.message }, { status: 400 });
    if (coeffErr) return NextResponse.json({ ok: false, error: coeffErr.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      classes: classes || [],
      academic_years: years || [],
      core_subjects: subjectCoeffs || [], // on garde le même nom côté front
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "bootstrap_failed" },
      { status: 400 }
    );
  }
}

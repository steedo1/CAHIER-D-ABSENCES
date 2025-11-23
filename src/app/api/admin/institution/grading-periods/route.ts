// src/app/api/admin/institution/grading-periods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Année scolaire par défaut : pivot en août, comme pour les classes / évaluations */
function computeAcademicYear(d = new Date()): string {
  const m = d.getUTCMonth() + 1; // 1..12
  const y = d.getUTCFullYear();
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/** Récupère l'établissement du user courant (via profiles.institution_id) */
async function getMyInstitutionId() {
  const supabaseAuth = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: me, error: meErr } = await supabaseAuth
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      error: NextResponse.json({ ok: false, error: meErr.message }, { status: 400 }),
    };
  }
  if (!me?.institution_id) {
    return {
      error: NextResponse.json({ ok: false, error: "no_institution" }, { status: 400 }),
    };
  }

  return { institution_id: me.institution_id as string };
}

/* =========================
   GET : liste des périodes
========================= */
export async function GET(req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const url = new URL(req.url);
  const academicYearParam = url.searchParams.get("academic_year");
  const academic_year = (academicYearParam || computeAcademicYear()).trim();

  const supabase = getSupabaseServiceClient();
  const { data, error: dbErr } = await supabase
    .from("grade_periods")
    .select(
      "id, institution_id, academic_year, code, label, short_label, kind, start_date, end_date, order_index, is_active, coeff"
    )
    .eq("institution_id", institution_id)
    .eq("academic_year", academic_year)
    .order("order_index", { ascending: true });

  if (dbErr) {
    return NextResponse.json({ ok: false, error: dbErr.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    academic_year,
    items: data ?? [],
  });
}

/* =========================
   PUT : enregistre les périodes
========================= */

type PeriodInput = {
  id?: string | null; // ignoré côté DB (on remplace tout)
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
  kind?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  order_index?: number | null;
  is_active?: boolean | null;
  coeff?: number | string | null; // ✅ nouveau, mais optionnel
};

export async function PUT(req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as {
    periods?: PeriodInput[];
    academic_year?: string;
  };
  const rawPeriods = Array.isArray(body.periods) ? body.periods : [];

  const academic_year =
    typeof body.academic_year === "string" && body.academic_year.trim()
      ? body.academic_year.trim()
      : computeAcademicYear();

  // Normalisation + petites validations
  const normalized = rawPeriods.map((p, idx) => {
    const code = (p.code || `P${idx + 1}`).trim();
    const label = (p.label || `Période ${idx + 1}`).trim();
    const short_label = (p.short_label || label).trim();

    const start_date = p.start_date && p.start_date.trim() ? p.start_date.trim() : null;
    const end_date = p.end_date && p.end_date.trim() ? p.end_date.trim() : null;

    // ✅ Normalisation du coefficient de période
    let coeff = 1; // valeur par défaut (comportement identique à avant)
    if (typeof p.coeff === "number") {
      coeff = Number.isFinite(p.coeff) && p.coeff >= 0 ? p.coeff : 1;
    } else if (typeof p.coeff === "string" && p.coeff.trim() !== "") {
      const parsed = parseFloat(p.coeff.replace(",", "."));
      if (!Number.isNaN(parsed) && parsed >= 0) {
        coeff = parsed;
      }
    }

    return {
      institution_id,
      academic_year,
      code,
      label,
      short_label,
      kind: p.kind && p.kind.trim() ? p.kind.trim() : null,
      start_date, // si ta colonne est NOT NULL, il faudra obliger côté UI
      end_date,
      order_index: idx + 1,
      is_active: p.is_active !== false,
      coeff, // ✅ envoyé à la BDD
    };
  });

  const supabase = getSupabaseServiceClient();

  // On remplace TOUTES les périodes de cette année scolaire pour cet établissement
  const { error: delErr } = await supabase
    .from("grade_periods")
    .delete()
    .eq("institution_id", institution_id)
    .eq("academic_year", academic_year);

  if (delErr) {
    return NextResponse.json({ ok: false, error: delErr.message }, { status: 400 });
  }

  if (normalized.length === 0) {
    // On a juste tout effacé => c'est autorisé
    return NextResponse.json({ ok: true, inserted: 0, academic_year });
  }

  const { data, error: insErr } = await supabase
    .from("grade_periods")
    .insert(normalized)
    .select(
      "id, institution_id, academic_year, code, label, short_label, kind, start_date, end_date, order_index, is_active, coeff"
    );

  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    academic_year,
    inserted: data?.length ?? 0,
    items: data ?? [],
  });
}

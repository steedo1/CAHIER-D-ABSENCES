// src/app/api/admin/institution/academic-years/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
   GET : liste des années scolaires
   ========================= */

export async function GET(_req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const supabase = getSupabaseServiceClient();
  const { data, error: dbErr } = await supabase
    .from("academic_years")
    .select("id, institution_id, code, label, start_date, end_date, is_current")
    .eq("institution_id", institution_id)
    .order("start_date", { ascending: true });

  if (dbErr) {
    return NextResponse.json({ ok: false, error: dbErr.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    items: data ?? [],
  });
}

/* =========================
   PUT : enregistre les années scolaires
   ========================= */

type AcademicYearInput = {
  code?: string | null;
  label?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
};

type NormalizedYear = {
  code: string;
  label: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

export async function PUT(req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as {
    items?: AcademicYearInput[];
  };
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const normalized: NormalizedYear[] = [];
  let currentAlreadySet = false;

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const indexHuman = i + 1;

    const code = (raw.code || "").trim();
    if (!code) {
      // on ignore simplement les lignes vides
      continue;
    }

    const label =
      (raw.label || "").trim() || `Année scolaire ${code}`;

    const start_date = (raw.start_date || "").trim();
    const end_date = (raw.end_date || "").trim();

    if (!start_date || !end_date) {
      return NextResponse.json(
        {
          ok: false,
          error: `Ligne ${indexHuman}: chaque année scolaire doit avoir une date de début et une date de fin.`,
        },
        { status: 400 }
      );
    }

    if (end_date < start_date) {
      return NextResponse.json(
        {
          ok: false,
          error: `Ligne ${indexHuman}: la date de fin doit être postérieure à la date de début.`,
        },
        { status: 400 }
      );
    }

    const is_current_raw = raw.is_current === true;
    const is_current = is_current_raw && !currentAlreadySet;
    if (is_current) currentAlreadySet = true;

    normalized.push({
      code,
      label,
      start_date,
      end_date,
      is_current,
    });
  }

  const supabase = getSupabaseServiceClient();

  // On remplace complètement la liste des années pour cet établissement.
  const { error: delErr } = await supabase
    .from("academic_years")
    .delete()
    .eq("institution_id", institution_id);

  if (delErr) {
    return NextResponse.json({ ok: false, error: delErr.message }, { status: 400 });
  }

  if (normalized.length === 0) {
    // on a tout effacé : c'est autorisé
    return NextResponse.json({
      ok: true,
      items: [],
    });
  }

  const payload = normalized.map((row) => ({
    institution_id,
    code: row.code,
    label: row.label,
    start_date: row.start_date,
    end_date: row.end_date,
    is_current: row.is_current,
  }));

  const { data, error: insErr } = await supabase
    .from("academic_years")
    .insert(payload)
    .select("id, institution_id, code, label, start_date, end_date, is_current");

  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    items: data ?? [],
  });
}

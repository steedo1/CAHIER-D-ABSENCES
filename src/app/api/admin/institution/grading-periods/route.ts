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
      error: NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      ),
    };
  }

  const { data: me, error: meErr } = await supabaseAuth
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      error: NextResponse.json(
        { ok: false, error: meErr.message },
        { status: 400 }
      ),
    };
  }

  if (!me?.institution_id) {
    return {
      error: NextResponse.json(
        { ok: false, error: "no_institution" },
        { status: 400 }
      ),
    };
  }

  return { institution_id: me.institution_id as string };
}

type GradePeriodRow = {
  id: string;
  institution_id: string;
  academic_year: string;
  code: string | null;
  label: string | null;
  short_label: string | null;
  kind: string | null;
  start_date: string | null;
  end_date: string | null;
  order_index: number | null;
  is_active: boolean | null;
  coeff: number | null;
};

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
    return NextResponse.json(
      { ok: false, error: dbErr.message },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    academic_year,
    items: data ?? [],
  });
}

/* =========================
   PUT : enregistre les périodes
   ✅ Préserve les IDs existants
   ✅ N'efface plus tout aveuglément
   ✅ Bloque la suppression d'une période déjà rattachée à des évaluations
========================= */

type PeriodInput = {
  id?: string | null;
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
  kind?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  order_index?: number | null;
  is_active?: boolean | null;
  coeff?: number | string | null;
};

type NormalizedPeriod = {
  incoming_id: string | null;
  institution_id: string;
  academic_year: string;
  code: string;
  label: string;
  short_label: string;
  kind: string | null;
  start_date: string | null;
  end_date: string | null;
  order_index: number;
  is_active: boolean;
  coeff: number;
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

  const normalized: NormalizedPeriod[] = rawPeriods.map((p, idx) => {
    const code = (p.code || `P${idx + 1}`).trim();
    const label = (p.label || `Période ${idx + 1}`).trim();
    const short_label = (p.short_label || label).trim();

    const start_date =
      p.start_date && p.start_date.trim() ? p.start_date.trim() : null;
    const end_date =
      p.end_date && p.end_date.trim() ? p.end_date.trim() : null;

    let coeff = 1;
    if (typeof p.coeff === "number") {
      coeff = Number.isFinite(p.coeff) && p.coeff >= 0 ? p.coeff : 1;
    } else if (typeof p.coeff === "string" && p.coeff.trim() !== "") {
      const parsed = parseFloat(p.coeff.replace(",", "."));
      if (!Number.isNaN(parsed) && parsed >= 0) {
        coeff = parsed;
      }
    }

    const incoming_id =
      typeof p.id === "string" && p.id.trim() ? p.id.trim() : null;

    return {
      incoming_id,
      institution_id,
      academic_year,
      code,
      label,
      short_label,
      kind: p.kind && p.kind.trim() ? p.kind.trim() : null,
      start_date,
      end_date,
      order_index: idx + 1,
      is_active: p.is_active !== false,
      coeff,
    };
  });

  const supabase = getSupabaseServiceClient();

  // 1) Lire l’existant pour cette année
  const { data: existingRows, error: existingErr } = await supabase
    .from("grade_periods")
    .select(
      "id, institution_id, academic_year, code, label, short_label, kind, start_date, end_date, order_index, is_active, coeff"
    )
    .eq("institution_id", institution_id)
    .eq("academic_year", academic_year)
    .order("order_index", { ascending: true });

  if (existingErr) {
    return NextResponse.json(
      { ok: false, error: existingErr.message },
      { status: 400 }
    );
  }

  const existing = (existingRows ?? []) as GradePeriodRow[];
  const existingById = new Map<string, GradePeriodRow>();
  const existingByCode = new Map<string, GradePeriodRow>();

  for (const row of existing) {
    existingById.set(row.id, row);
    if (row.code) existingByCode.set(String(row.code).trim(), row);
  }

  // 2) Apparier chaque période entrante à un enregistrement existant
  //    Priorité: id envoyé par le front -> sinon code
  const usedExistingIds = new Set<string>();

  const matched = normalized.map((p) => {
    let keepId: string | null = null;

    if (p.incoming_id && existingById.has(p.incoming_id)) {
      keepId = p.incoming_id;
    } else {
      const byCode = existingByCode.get(p.code);
      if (byCode) keepId = byCode.id;
    }

    if (keepId && usedExistingIds.has(keepId)) {
      keepId = null;
    }

    if (keepId) usedExistingIds.add(keepId);

    return {
      ...p,
      keep_id: keepId,
    };
  });

  const idsToKeep = new Set(
    matched.map((p) => p.keep_id).filter((v): v is string => !!v)
  );

  const idsToDelete = existing
    .map((row) => row.id)
    .filter((id) => !idsToKeep.has(id));

  // 3) Protection : ne pas supprimer une période déjà utilisée
  if (idsToDelete.length > 0) {
    const { count: linkedCount, error: linkedErr } = await supabase
      .from("grade_evaluations")
      .select("id", { count: "exact", head: true })
      .in("grading_period_id", idsToDelete);

    if (linkedErr) {
      return NextResponse.json(
        { ok: false, error: linkedErr.message },
        { status: 400 }
      );
    }

    if ((linkedCount ?? 0) > 0) {
      const blocked = existing
        .filter((row) => idsToDelete.includes(row.id))
        .map((row) => ({
          id: row.id,
          code: row.code,
          label: row.label,
        }));

      return NextResponse.json(
        {
          ok: false,
          error:
            "Impossible de supprimer une ou plusieurs périodes déjà rattachées à des évaluations.",
          blocked_periods: blocked,
        },
        { status: 409 }
      );
    }
  }

  // 4) Mettre à jour les périodes existantes conservées
  for (const p of matched) {
    if (!p.keep_id) continue;

    const { error: upErr } = await supabase
      .from("grade_periods")
      .update({
        code: p.code,
        label: p.label,
        short_label: p.short_label,
        kind: p.kind,
        start_date: p.start_date,
        end_date: p.end_date,
        order_index: p.order_index,
        is_active: p.is_active,
        coeff: p.coeff,
      })
      .eq("id", p.keep_id)
      .eq("institution_id", institution_id)
      .eq("academic_year", academic_year);

    if (upErr) {
      return NextResponse.json(
        { ok: false, error: upErr.message },
        { status: 400 }
      );
    }
  }

  // 5) Insérer les nouvelles périodes
  const rowsToInsert = matched
    .filter((p) => !p.keep_id)
    .map((p) => ({
      institution_id: p.institution_id,
      academic_year: p.academic_year,
      code: p.code,
      label: p.label,
      short_label: p.short_label,
      kind: p.kind,
      start_date: p.start_date,
      end_date: p.end_date,
      order_index: p.order_index,
      is_active: p.is_active,
      coeff: p.coeff,
    }));

  if (rowsToInsert.length > 0) {
    const { error: insErr } = await supabase
      .from("grade_periods")
      .insert(rowsToInsert);

    if (insErr) {
      return NextResponse.json(
        { ok: false, error: insErr.message },
        { status: 400 }
      );
    }
  }

  // 6) Supprimer uniquement les périodes vraiment retirées et non liées
  if (idsToDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("grade_periods")
      .delete()
      .in("id", idsToDelete)
      .eq("institution_id", institution_id)
      .eq("academic_year", academic_year);

    if (delErr) {
      return NextResponse.json(
        { ok: false, error: delErr.message },
        { status: 400 }
      );
    }
  }

  // 7) Relire l’état final
  const { data: finalRows, error: finalErr } = await supabase
    .from("grade_periods")
    .select(
      "id, institution_id, academic_year, code, label, short_label, kind, start_date, end_date, order_index, is_active, coeff"
    )
    .eq("institution_id", institution_id)
    .eq("academic_year", academic_year)
    .order("order_index", { ascending: true });

  if (finalErr) {
    return NextResponse.json(
      { ok: false, error: finalErr.message },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    academic_year,
    inserted: rowsToInsert.length,
    updated: matched.filter((p) => !!p.keep_id).length,
    deleted: idsToDelete.length,
    items: finalRows ?? [],
  });
}
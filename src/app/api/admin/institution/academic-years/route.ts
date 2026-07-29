// src/app/api/admin/institution/academic-years/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionAccess } from "../../_helpers/institutionAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACADEMIC_YEAR_READ_ROLES = [
  "admin",
  "super_admin",
  "founder",
  "finance_manager",
  "educator",
  "infirmier",
] as const;
const ACADEMIC_YEAR_WRITE_ROLES = ["admin", "super_admin"] as const;

async function getMyInstitutionId(options: { write?: boolean } = {}) {
  const access = await requireInstitutionAccess({
    allowedRoles: options.write
      ? ACADEMIC_YEAR_WRITE_ROLES
      : ACADEMIC_YEAR_READ_ROLES,
  });

  if ("error" in access) return { error: access.error };
  return { institution_id: access.institutionId };
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

   Important : on ne supprime plus / réinsère plus toute la liste.
   Des tables comme grade_periods référencent academic_years.id.
   Il faut donc conserver les id existants et faire des update/insert ciblés.
   ========================= */

type AcademicYearInput = {
  id?: string | null;
  code?: string | null;
  label?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
};

type NormalizedYear = {
  id: string | null;
  code: string;
  label: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

function isPersistedId(value?: string | null) {
  const id = String(value || "").trim();
  return id.length > 0 && !id.startsWith("temp_") && !id.startsWith("year_");
}

export async function PUT(req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId({ write: true });
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as {
    items?: AcademicYearInput[];
  };
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const normalized: NormalizedYear[] = [];
  let currentAlreadySet = false;
  const seenCodes = new Set<string>();

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const indexHuman = i + 1;

    const code = (raw.code || "").trim();
    if (!code) {
      // on ignore simplement les lignes vides
      continue;
    }

    if (seenCodes.has(code)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Ligne ${indexHuman}: l'année scolaire « ${code} » existe déjà dans la liste.`,
        },
        { status: 400 }
      );
    }
    seenCodes.add(code);

    const label = (raw.label || "").trim() || `Année scolaire ${code}`;
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
      id: isPersistedId(raw.id) ? String(raw.id).trim() : null,
      code,
      label,
      start_date,
      end_date,
      is_current,
    });
  }

  const supabase = getSupabaseServiceClient();

  const { data: existingRows, error: existingErr } = await supabase
    .from("academic_years")
    .select("id, code")
    .eq("institution_id", institution_id);

  if (existingErr) {
    return NextResponse.json({ ok: false, error: existingErr.message }, { status: 400 });
  }

  const existing = Array.isArray(existingRows) ? existingRows : [];
  const existingById = new Map(existing.map((row: any) => [String(row.id), row]));
  const existingByCode = new Map(existing.map((row: any) => [String(row.code || ""), row]));

  // Quand l'ancien front n'envoie pas encore l'id, on réassocie par code.
  const rowsWithResolvedIds = normalized.map((row) => {
    if (row.id && existingById.has(row.id)) return row;
    const byCode = existingByCode.get(row.code);
    if (byCode?.id) return { ...row, id: String(byCode.id) };
    return { ...row, id: null };
  });

  const keptIds = new Set(
    rowsWithResolvedIds
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const idsToDelete = existing.map((row: any) => String(row.id)).filter((id) => !keptIds.has(id));

  if (idsToDelete.length > 0) {
    const { count, error: periodCheckErr } = await supabase
      .from("grade_periods")
      .select("id", { count: "exact", head: true })
      .in("academic_year_id", idsToDelete);

    if (periodCheckErr) {
      return NextResponse.json({ ok: false, error: periodCheckErr.message }, { status: 400 });
    }

    if ((count || 0) > 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Impossible de supprimer une année scolaire déjà liée à des périodes d'évaluation/bulletins. Désactivez-la ou modifiez ses dates, mais ne la supprimez pas.",
        },
        { status: 400 }
      );
    }
  }

  // On garantit une seule année courante pour l'établissement.
  const { error: resetCurrentErr } = await supabase
    .from("academic_years")
    .update({ is_current: false })
    .eq("institution_id", institution_id);

  if (resetCurrentErr) {
    return NextResponse.json({ ok: false, error: resetCurrentErr.message }, { status: 400 });
  }

  for (const row of rowsWithResolvedIds) {
    if (row.id && existingById.has(row.id)) {
      const { error: updateErr } = await supabase
        .from("academic_years")
        .update({
          code: row.code,
          label: row.label,
          start_date: row.start_date,
          end_date: row.end_date,
          is_current: row.is_current,
        })
        .eq("institution_id", institution_id)
        .eq("id", row.id);

      if (updateErr) {
        return NextResponse.json({ ok: false, error: updateErr.message }, { status: 400 });
      }
    } else {
      const { error: insertErr } = await supabase.from("academic_years").insert({
        institution_id,
        code: row.code,
        label: row.label,
        start_date: row.start_date,
        end_date: row.end_date,
        is_current: row.is_current,
      });

      if (insertErr) {
        return NextResponse.json({ ok: false, error: insertErr.message }, { status: 400 });
      }
    }
  }

  if (idsToDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("academic_years")
      .delete()
      .eq("institution_id", institution_id)
      .in("id", idsToDelete);

    if (delErr) {
      return NextResponse.json({ ok: false, error: delErr.message }, { status: 400 });
    }
  }

  const { data, error: listErr } = await supabase
    .from("academic_years")
    .select("id, institution_id, code, label, start_date, end_date, is_current")
    .eq("institution_id", institution_id)
    .order("start_date", { ascending: true });

  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    items: data ?? [],
  });
}

// src/app/api/admin/notes/core-subjects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubjectCoeffRow = {
  subject_id: string;
  coeff: number;
};

type SubjectItem = {
  subject_id: string;
  subject_name: string;
  coeff: number;
};

function normalizeCoeff(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function selectTopSubjectsWithTies(
  rows: SubjectItem[],
  baseCount = 4
): SubjectItem[] {
  const dedup = new Map<string, SubjectItem>();

  for (const row of rows) {
    const subject_id = String(row.subject_id || "").trim();
    if (!subject_id) continue;

    const coeff = normalizeCoeff(row.coeff);
    const subject_name = String(row.subject_name || "Discipline").trim() || "Discipline";

    const prev = dedup.get(subject_id);
    if (!prev || coeff > prev.coeff) {
      dedup.set(subject_id, {
        subject_id,
        subject_name,
        coeff,
      });
    }
  }

  const sorted = [...dedup.values()].sort((a, b) => {
    if (b.coeff !== a.coeff) return b.coeff - a.coeff;
    return a.subject_name.localeCompare(b.subject_name, "fr", {
      sensitivity: "base",
    });
  });

  if (sorted.length <= baseCount) return sorted;

  const threshold = sorted[baseCount - 1]?.coeff ?? 0;
  return sorted.filter((x) => x.coeff >= threshold);
}

export async function GET(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const class_id = String(url.searchParams.get("class_id") || "").trim();

    if (!class_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_class_id",
          message: "class_id est requis.",
        },
        { status: 400 }
      );
    }

    // Profil + institution
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("id,institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr) {
      return NextResponse.json(
        { ok: false, error: meErr.message },
        { status: 400 }
      );
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

    // Rôle (admin / super_admin uniquement)
    const { data: roleRow } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id)
      .maybeSingle();

    const role = (roleRow?.role as string | undefined) || "";
    if (!["admin", "super_admin"].includes(role)) {
      return NextResponse.json(
        { ok: false, error: "forbidden", message: "Droits insuffisants." },
        { status: 403 }
      );
    }

    // Classe
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,label,code,level,academic_year,institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json(
        { ok: false, error: clsErr.message },
        { status: 400 }
      );
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

    const classLevel = (cls.level as string | null) || null;
    const classAcademicYear = (cls.academic_year as string | null) || null;

    // Coeffs de matières pour ce niveau
    const { data: coeffRows, error: coeffErr } = await srv
      .from("institution_subject_coeffs")
      .select("subject_id, coeff, include_in_average")
      .eq("institution_id", institution_id)
      .eq("level", classLevel)
      .eq("include_in_average", true);

    if (coeffErr) {
      return NextResponse.json(
        { ok: false, error: coeffErr.message },
        { status: 400 }
      );
    }

    const coeffBase = (coeffRows || [])
      .map((r: any) => ({
        subject_id: String(r.subject_id || "").trim(),
        coeff: normalizeCoeff(r.coeff),
      }))
      .filter((r) => !!r.subject_id);

    if (!coeffBase.length) {
      return NextResponse.json({
        ok: true,
        class: {
          id: cls.id,
          label: cls.label,
          code: cls.code,
          level: cls.level,
          academic_year: cls.academic_year,
        },
        items: [],
      });
    }

    const levelSubjectIds = new Set<string>(coeffBase.map((r) => r.subject_id));

    // Matières réellement présentes dans la classe
    const actualSubjectIds = new Set<string>();

    // 1) via class_teachers actifs sur l'année scolaire de la classe
    if (classAcademicYear) {
      const { data: ayRow } = await srv
        .from("academic_years")
        .select("start_date,end_date")
        .eq("institution_id", institution_id)
        .eq("code", classAcademicYear)
        .maybeSingle();

      const yearStart = String(ayRow?.start_date || "");
      const yearEnd = String(ayRow?.end_date || "");

      const { data: ctRows, error: ctErr } = await srv
        .from("class_teachers")
        .select("subject_id,start_date,end_date,institution_id")
        .eq("class_id", class_id)
        .eq("institution_id", institution_id);

      if (!ctErr) {
        for (const row of ctRows || []) {
          const sid = String((row as any).subject_id || "").trim();
          if (!sid) continue;

          const sd = String((row as any).start_date || "");
          const ed = String((row as any).end_date || "");

          const overlapsAcademicYear =
            (!yearStart || !ed || ed >= yearStart) &&
            (!yearEnd || !sd || sd <= yearEnd);

          if (overlapsAcademicYear) {
            actualSubjectIds.add(sid);
          }
        }
      } else {
        console.error("[core-subjects] class_teachers error", ctErr);
      }
    }

    // 2) via grade_flat_marks (notes réelles)
    if (classAcademicYear) {
      const { data: marksRows, error: marksErr } = await srv
        .from("grade_flat_marks")
        .select("subject_id")
        .eq("institution_id", institution_id)
        .eq("class_id", class_id)
        .eq("academic_year", classAcademicYear);

      if (!marksErr) {
        for (const row of marksRows || []) {
          const sid = String((row as any).subject_id || "").trim();
          if (sid) actualSubjectIds.add(sid);
        }
      } else {
        console.error("[core-subjects] grade_flat_marks error", marksErr);
      }
    }

    // Intersection coeffs ∩ matières réellement présentes
    let usedSubjectIds: Set<string>;
    if (actualSubjectIds.size > 0) {
      const intersect = new Set<string>();
      for (const sid of actualSubjectIds) {
        if (levelSubjectIds.has(sid)) intersect.add(sid);
      }
      usedSubjectIds = intersect.size > 0 ? intersect : levelSubjectIds;
    } else {
      usedSubjectIds = levelSubjectIds;
    }

    const subjectIds = [...usedSubjectIds];
    if (!subjectIds.length) {
      return NextResponse.json({
        ok: true,
        class: {
          id: cls.id,
          label: cls.label,
          code: cls.code,
          level: cls.level,
          academic_year: cls.academic_year,
        },
        items: [],
      });
    }

    // Noms des matières
    const { data: subjRows, error: subjErr } = await srv
      .from("subjects")
      .select("id,name,code,subject_key")
      .in("id", subjectIds);

    if (subjErr) {
      return NextResponse.json(
        { ok: false, error: subjErr.message },
        { status: 400 }
      );
    }

    const subjectsById: Record<string, string> = Object.fromEntries(
      (subjRows || []).map((s: any) => [
        String(s.id),
        String(s.name || s.code || s.subject_key || "Discipline"),
      ])
    );

    const allEligibleItems: SubjectItem[] = coeffBase
      .filter((r) => usedSubjectIds.has(r.subject_id))
      .map((r) => ({
        subject_id: r.subject_id,
        subject_name: subjectsById[r.subject_id] || "Discipline",
        coeff: r.coeff,
      }));

    const items = selectTopSubjectsWithTies(allEligibleItems, 4);
    const coeffThreshold =
      items.length >= 4 ? items[3]?.coeff ?? null : items[items.length - 1]?.coeff ?? null;

    return NextResponse.json({
      ok: true,
      class: {
        id: cls.id,
        label: cls.label,
        code: cls.code,
        level: cls.level,
        academic_year: cls.academic_year,
      },
      meta: {
        rule: "top_coeffs_with_ties",
        requested_base_count: 4,
        coeff_threshold: coeffThreshold,
        actual_subjects_found: actualSubjectIds.size,
        used_subject_count: usedSubjectIds.size,
      },
      items,
    });
  } catch (e: any) {
    console.error("[core-subjects] unexpected error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "core_subjects_failed" },
      { status: 400 }
    );
  }
}
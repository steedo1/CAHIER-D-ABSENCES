// src/app/api/admin/notes/core-subjects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        { ok: false, error: "missing_class_id", message: "class_id est requis." },
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

    const classLevel = cls.level as string | null;
    const classAcademicYear = cls.academic_year as string | null;

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

    const rows = coeffRows || [];
    if (!rows.length) {
      // Pas de coefficients définis : la page tombera en fallback "couverture globale".
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

    // --------------------------
    // 1) Base : sujets avec coeffs sur ce niveau
    // --------------------------
    const levelSubjectIds = new Set<string>();
    for (const r of rows) {
      const sid = (r as any).subject_id as string | null;
      if (sid) levelSubjectIds.add(sid);
    }

    // --------------------------
    // 2) Matières réellement présentes dans la classe
    //    - via class_teachers actifs
    //    - via des notes dans grade_flat_marks
    // --------------------------
    const todayStr = new Date().toISOString().slice(0, 10);
    const actualSubjectIds = new Set<string>();

    // 2.a) Subjects via class_teachers (affectations)
    const { data: ctRows, error: ctErr } = await srv
      .from("class_teachers")
      .select("subject_id,start_date,end_date,institution_id")
      .eq("class_id", class_id)
      .eq("institution_id", institution_id);

    if (!ctErr) {
      for (const row of ctRows || []) {
        const r: any = row;
        const sid = r.subject_id as string | null;
        if (!sid) continue;

        const sd = (r.start_date as string | null) || null; // "YYYY-MM-DD"
        const ed = (r.end_date as string | null) || null;   // "YYYY-MM-DD" ou null

        const isActive =
          (!sd || sd <= todayStr) &&
          (!ed || ed >= todayStr);

        if (isActive) {
          actualSubjectIds.add(sid);
        }
      }
    } else {
      console.error("[core-subjects] class_teachers error", ctErr);
    }

    // 2.b) Subjects via grade_flat_marks (notes réelles)
    if (classAcademicYear) {
      let marksQuery = srv
        .from("grade_flat_marks")
        .select("subject_id")
        .eq("institution_id", institution_id)
        .eq("class_id", class_id)
        .eq("academic_year", classAcademicYear);

      const { data: marksRows, error: marksErr } = await marksQuery;
      if (!marksErr) {
        for (const row of marksRows || []) {
          const sid = (row as any).subject_id as string | null;
          if (sid) actualSubjectIds.add(sid);
        }
      } else {
        console.error("[core-subjects] grade_flat_marks error", marksErr);
      }
    }

    // --------------------------
    // 3) Intersection : coeffs ∩ matières réellement présentes
    // --------------------------
    const intersectIds = new Set<string>();
    for (const sid of actualSubjectIds) {
      if (levelSubjectIds.has(sid)) {
        intersectIds.add(sid);
      }
    }

    let usedSubjectIds: Set<string>;
    if (intersectIds.size > 0) {
      // Cas normal : on ne garde que les matières
      // qui ont un coeff ET sont réellement présentes dans la classe
      usedSubjectIds = intersectIds;
    } else {
      // Fallback : aucune matière trouvée via affectations/notes,
      // on retombe sur tous les coeffs définis sur le niveau
      usedSubjectIds = levelSubjectIds;
    }

    if (usedSubjectIds.size === 0) {
      // Sécurité (ne devrait pas arriver si rows.length > 0)
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

    const subjectIds = Array.from(usedSubjectIds);

    // --------------------------
    // 4) Récupération des noms dans subjects
    // --------------------------
    let subjectsById: Record<string, string> = {};
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

    subjectsById = Object.fromEntries(
      (subjRows || []).map((s: any) => [
        s.id as string,
        (s.name as string) ||
          (s.code as string) ||
          (s.subject_key as string) ||
          "Discipline",
      ])
    );

    // --------------------------
    // 5) On construit les 3–4 matières clés (plus gros coeffs)
    // --------------------------
    const items = rows
      .filter((r: any) => usedSubjectIds.has(r.subject_id as string))
      .map((r: any) => ({
        subject_id: r.subject_id as string,
        subject_name: subjectsById[r.subject_id] || "Discipline",
        coeff: Number(r.coeff ?? 1),
      }))
      .sort((a, b) => b.coeff - a.coeff)
      .slice(0, 4);

    return NextResponse.json({
      ok: true,
      class: {
        id: cls.id,
        label: cls.label,
        code: cls.code,
        level: cls.level,
        academic_year: cls.academic_year,
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

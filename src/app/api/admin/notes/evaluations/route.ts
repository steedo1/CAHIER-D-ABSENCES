// src/app/api/admin/notes/evaluations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  teacher_id: string | null;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
};

type ScoreRow = {
  evaluation_id: string;
  score: number | null;
};

type ClassRow = {
  id: string;
  label?: string | null;
  level?: string | null;
};

type SubjectRow = {
  id: string;
  name?: string | null;
};

type TeacherRow = {
  id: string;
  display_name?: string | null;
};

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();

  /* ───────── Auth ───────── */
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHENTICATED" },
      { status: 401 }
    );
  }

  // rôle dans user_roles (admin ou super_admin)
  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (roleErr || !roleRow || !["super_admin", "admin"].includes(roleRow.role)) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  /* ───────── Paramètres ───────── */
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const classId = url.searchParams.get("class_id");
  const subjectIdRaw = url.searchParams.get("subject_id"); // peut être subjects.id OU institution_subjects.id
  const published = url.searchParams.get("published"); // "true" | "false" | null
  const pageParam = url.searchParams.get("page") || "1";
  const limitParam = url.searchParams.get("limit") || "30";

  let page = Number(pageParam);
  let limit = Number(limitParam);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 30;
  if (limit > 200) limit = 200;

  const fromIdx = (page - 1) * limit;
  const toIdx = fromIdx + limit - 1;

  /* ───────── Résolution du subject_id canonique ─────────
     subjectIdRaw peut être :
       - un subjects.id (directement)
       - ou un institution_subjects.id (c’est ce que renvoie ton /api/class/subjects)
     On traduit tout en subjects.id pour filtrer grade_evaluations.
  */
  let canonicalSubjectId: string | null = null;

  if (subjectIdRaw) {
    try {
      const { data: isub, error: isubErr } = await supabase
        .from("institution_subjects")
        .select("subject_id")
        .eq("id", subjectIdRaw)
        .maybeSingle();

      if (!isubErr && isub && isub.subject_id) {
        canonicalSubjectId = isub.subject_id as string;
      } else {
        // on considère que c’est déjà un subjects.id
        canonicalSubjectId = subjectIdRaw;
      }
    } catch {
      // fallback safe : on considère que c’est déjà un subjects.id
      canonicalSubjectId = subjectIdRaw;
    }
  }

  console.log("[admin.notes.evaluations] PARAMS", {
    from,
    to,
    classId,
    subjectIdRaw,
    canonicalSubjectId,
    published,
    page,
    limit,
    institution_id: roleRow.institution_id,
  });

  /* ───────── Évaluations ───────── */
  let query = supabase
    .from("grade_evaluations")
    .select(
      "id, class_id, subject_id, teacher_id, eval_date, eval_kind, scale, coeff, is_published",
      { count: "exact" }
    )
    .order("eval_date", { ascending: false });

  if (from) query = query.gte("eval_date", from);
  if (to) query = query.lte("eval_date", to);
  if (classId) query = query.eq("class_id", classId);
  if (canonicalSubjectId) query = query.eq("subject_id", canonicalSubjectId);
  if (published === "true") query = query.eq("is_published", true);
  if (published === "false") query = query.eq("is_published", false);

  query = query.range(fromIdx, toIdx);

  const { data: evalsData, error: evalErr, count } = await query;

  if (evalErr) {
    console.error("[admin.notes.evaluations] grade_evaluations error", evalErr);
    return NextResponse.json(
      { ok: false, error: "EVALS_ERROR" },
      { status: 500 }
    );
  }

  const evalRows = (evalsData || []) as EvalRow[];

  console.log("[admin.notes.evaluations] evalRows count", {
    count: evalRows.length,
    total: count ?? evalRows.length,
  });

  if (!evalRows.length) {
    return NextResponse.json({
      ok: true,
      meta: {
        page,
        limit,
        total: count ?? 0,
        from,
        to,
      },
      items: [] as any[],
    });
  }

  const evalIds = Array.from(new Set(evalRows.map((e) => e.id)));
  const classIds = Array.from(new Set(evalRows.map((e) => e.class_id)));
  const subjectIds = Array.from(
    new Set(
      evalRows.map((e) => e.subject_id).filter((x): x is string => !!x)
    )
  );
  const teacherIds = Array.from(
    new Set(
      evalRows.map((e) => e.teacher_id).filter((x): x is string => !!x)
    )
  );

  /* ───────── Notes via grade_flat_marks ───────── */
  let scoreRows: ScoreRow[] = [];
  if (evalIds.length) {
    const { data: marksData, error: marksErr } = await supabase
      .from("grade_flat_marks")
      .select("evaluation_id, raw_score")
      .in("evaluation_id", evalIds);

    if (marksErr) {
      console.error("[admin.notes.evaluations] grade_flat_marks error", marksErr);
      return NextResponse.json(
        { ok: false, error: "SCORES_ERROR" },
        { status: 500 }
      );
    }

    scoreRows = (marksData || [])
      .filter((r: any) => r.evaluation_id && r.raw_score != null)
      .map((r: any) => ({
        evaluation_id: r.evaluation_id as string,
        score: Number(r.raw_score),
      }));
  }

  /* ───────── Métadonnées classes ───────── */
  const classesById: Record<string, { label: string; level: string | null }> = {};
  if (classIds.length) {
    const { data: classesData, error: classesErr } = await supabase
      .from("classes")
      .select("id, label, level")
      .in("id", classIds);

    if (classesErr) {
      console.error("[admin.notes.evaluations] classes error", classesErr);
      return NextResponse.json(
        { ok: false, error: "CLASSES_ERROR" },
        { status: 500 }
      );
    }

    for (const c of (classesData || []) as ClassRow[]) {
      classesById[c.id] = {
        label: (c.label || "Classe").trim(),
        level: (c.level || null) ?? null,
      };
    }
  }

  /* ───────── Métadonnées matières ───────── */
  const subjectsById: Record<string, { name: string }> = {};
  if (subjectIds.length) {
    const { data: subjectsData, error: subjectsErr } = await supabase
      .from("subjects")
      .select("id, name")
      .in("id", subjectIds);

    if (subjectsErr) {
      console.error("[admin.notes.evaluations] subjects error", subjectsErr);
      return NextResponse.json(
        { ok: false, error: "SUBJECTS_ERROR" },
        { status: 500 }
      );
    }

    for (const s of (subjectsData || []) as SubjectRow[]) {
      subjectsById[s.id] = {
        name: (s.name || "Matière").trim(),
      };
    }
  }

  /* ───────── Métadonnées enseignants ───────── */
  const teachersById: Record<string, { name: string }> = {};
  if (teacherIds.length) {
    const { data: teachersData, error: teachersErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", teacherIds);

    if (teachersErr) {
      console.error("[admin.notes.evaluations] profiles error", teachersErr);
      return NextResponse.json(
        { ok: false, error: "TEACHERS_ERROR" },
        { status: 500 }
      );
    }

    for (const t of (teachersData || []) as TeacherRow[]) {
      teachersById[t.id] = {
        name: (t.display_name || "Enseignant").trim(),
      };
    }
  }

  /* ───────── Agrégations par évaluation ───────── */
  type Agg = {
    count: number;
    sumRaw: number;
    sumNorm: number;
    minRaw: number | null;
    maxRaw: number | null;
    nbAbove10: number;
  };

  const evalById = new Map<string, EvalRow>();
  for (const ev of evalRows) {
    evalById.set(ev.id, ev);
  }

  const scoresIndex = new Map<string, Agg>();

  for (const sc of scoreRows) {
    if (sc.score == null) continue;
    const ev = evalById.get(sc.evaluation_id);
    if (!ev || !ev.scale) continue;

    let agg = scoresIndex.get(ev.id);
    if (!agg) {
      agg = {
        count: 0,
        sumRaw: 0,
        sumNorm: 0,
        minRaw: null,
        maxRaw: null,
        nbAbove10: 0,
      };
      scoresIndex.set(ev.id, agg);
    }

    const score = Number(sc.score);
    agg.count += 1;
    agg.sumRaw += score;

    const normalized = (score / ev.scale) * 20;
    agg.sumNorm += normalized;

    if (agg.minRaw == null || score < agg.minRaw) agg.minRaw = score;
    if (agg.maxRaw == null || score > agg.maxRaw) agg.maxRaw = score;
    if (normalized >= 10) agg.nbAbove10 += 1;
  }

  /* ───────── Construction des items ───────── */
  const items = evalRows.map((ev) => {
    const cls = classesById[ev.class_id];
    const subj = ev.subject_id ? subjectsById[ev.subject_id] : null;
    const teacher = ev.teacher_id ? teachersById[ev.teacher_id] : null;
    const agg =
      scoresIndex.get(ev.id) || {
        count: 0,
        sumRaw: 0,
        sumNorm: 0,
        minRaw: null,
        maxRaw: null,
        nbAbove10: 0,
      };

    const avgRaw =
      agg.count > 0 ? Number((agg.sumRaw / agg.count).toFixed(2)) : null;
    const avg20 =
      agg.count > 0 ? Number((agg.sumNorm / agg.count).toFixed(2)) : null;

    return {
      id: ev.id,
      eval_date: ev.eval_date,
      eval_kind: ev.eval_kind,
      scale: ev.scale,
      coeff: ev.coeff,
      is_published: ev.is_published,
      class_id: ev.class_id,
      class_label: cls?.label ?? "Classe",
      level: cls?.level ?? null,
      subject_id: ev.subject_id,
      subject_name: subj?.name ?? null,
      teacher_id: ev.teacher_id,
      teacher_name: teacher?.name ?? null,
      stats: {
        scores_count: agg.count,
        avg_score_raw: avgRaw,
        avg_score_20: avg20,
        min_raw: agg.minRaw,
        max_raw: agg.maxRaw,
        nb_above_10: agg.nbAbove10,
      },
    };
  });

  return NextResponse.json({
    ok: true,
    meta: {
      page,
      limit,
      total: count ?? items.length,
      from,
      to,
    },
    items,
  });
}

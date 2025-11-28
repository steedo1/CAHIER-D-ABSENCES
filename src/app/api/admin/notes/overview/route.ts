// src/app/api/admin/notes/overview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null; // peut être institution_subjects.id OU subjects.id
  teacher_id: string | null;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
};

type FlatMarkRow = {
  evaluation_id: string | null;
  class_id: string | null;
  class_label: string | null;
  class_level: string | null;
  mark_20: number | null;
};

type ClassMetaRow = {
  id: string;
  label?: string | null;
  level?: string | null;
  institution_id: string;
};

type InstSubjectRow = {
  id: string;
  subject_id: string;
  custom_name?: string | null;
  subjects?: {
    name?: string | null;
  } | null;
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
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days") || "30";
  let days = Number(daysParam);
  if (!Number.isFinite(days) || days <= 0) days = 30;
  if (days < 1) days = 1;
  if (days > 365) days = 365;

  const supabase = await getSupabaseServerClient();

  /* ───────── Auth + rôle admin/super_admin ───────── */
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

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();

  if (roleErr) {
    console.error("[admin.notes.overview] user_roles error", roleErr);
    return NextResponse.json(
      { ok: false, error: "ROLE_ERROR" },
      { status: 500 }
    );
  }

  if (!roleRow) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN" },
      { status: 403 }
    );
  }

  /* ───────── Institution courante (profil) ───────── */
  const { data: me, error: meErr } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    console.error("[admin.notes.overview] profiles error", meErr);
    return NextResponse.json(
      { ok: false, error: "PROFILE_ERROR" },
      { status: 500 }
    );
  }

  const institutionId = me?.institution_id as string | null;
  if (!institutionId) {
    return NextResponse.json(
      { ok: false, error: "NO_INSTITUTION" },
      { status: 400 }
    );
  }

  /* ───────── Fenêtre de dates ───────── */
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - days + 1);

  const toYMD = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  const fromYmd = toYMD(fromDate);
  const toYmd = toYMD(today);

  /* ───────── 1) Évaluations sur la période (toutes) ───────── */
  const { data: evalsData, error: evalErr } = await supabase
    .from("grade_evaluations")
    .select(
      "id, class_id, subject_id, teacher_id, eval_date, eval_kind, scale, coeff, is_published"
    )
    .gte("eval_date", fromYmd)
    .lte("eval_date", toYmd);

  if (evalErr) {
    console.error("[admin.notes.overview] grade_evaluations error", evalErr);
    return NextResponse.json(
      { ok: false, error: "EVALS_ERROR" },
      { status: 500 }
    );
  }

  const evalRowsRaw = (evalsData || []) as EvalRow[];

  if (!evalRowsRaw.length) {
    // aucun contrôle sur la période, tous établissements confondus
    return NextResponse.json({
      ok: true,
      meta: { days },
      counts: {
        evaluations_total: 0,
        evaluations_published: 0,
        evaluations_unpublished: 0,
        scores_count: 0,
        avg_score_20: null,
      },
      breakdown: {
        by_level: [] as Array<{
          level: string;
          evals: number;
          avg_20: number | null;
        }>,
        by_class: [] as Array<{
          class_id: string;
          class_label: string;
          level?: string | null;
          evals: number;
          avg_20: number | null;
        }>,
        worst_classes: [] as Array<{
          class_id: string;
          class_label: string;
          level?: string | null;
          evals: number;
          avg_20: number | null;
        }>,
      },
      latest: [] as Array<{
        id: string;
        eval_date: string;
        eval_kind: EvalKind;
        scale: number;
        coeff: number;
        is_published: boolean;
        class_label: string;
        level: string | null;
        subject_name: string | null;
        teacher_name: string | null;
      }>,
    });
  }

  /* ───────── 1b) Filtrer par établissement via classes ───────── */
  const allClassIds = Array.from(new Set(evalRowsRaw.map((e) => e.class_id)));

  const classesById: Record<string, { label: string; level: string | null }> =
    {};
  const allowedClassIds = new Set<string>();

  if (allClassIds.length) {
    const { data: classesData, error: classesErr } = await supabase
      .from("classes")
      .select("id, label, level, institution_id")
      .in("id", allClassIds)
      .eq("institution_id", institutionId);

    if (classesErr) {
      console.error("[admin.notes.overview] classes error", classesErr);
      return NextResponse.json(
        { ok: false, error: "CLASSES_ERROR" },
        { status: 500 }
      );
    }

    for (const c of (classesData || []) as ClassMetaRow[]) {
      allowedClassIds.add(c.id);
      classesById[c.id] = {
        label: (c.label || "Classe").trim(),
        level: (c.level || null) ?? null,
      };
    }
  }

  const evalRows = evalRowsRaw.filter((e) => allowedClassIds.has(e.class_id));

  if (!evalRows.length) {
    // il existe des évaluations sur la période, mais aucune dans CET établissement
    return NextResponse.json({
      ok: true,
      meta: { days },
      counts: {
        evaluations_total: 0,
        evaluations_published: 0,
        evaluations_unpublished: 0,
        scores_count: 0,
        avg_score_20: null,
      },
      breakdown: {
        by_level: [],
        by_class: [],
        worst_classes: [],
      },
      latest: [],
    });
  }

  /* ───────── IDs utiles (après filtrage établissement) ───────── */
  const evalIds = Array.from(new Set(evalRows.map((e) => e.id)));
  const subjectIds = Array.from(
    new Set(evalRows.map((e) => e.subject_id).filter((x): x is string => !!x))
  );
  const teacherIds = Array.from(
    new Set(evalRows.map((e) => e.teacher_id).filter((x): x is string => !!x))
  );

  /* ───────── 2) Notes via grade_flat_marks.mark_20 ───────── */
  let flatMarks: FlatMarkRow[] = [];
  if (evalIds.length) {
    const { data: marksData, error: marksErr } = await supabase
      .from("grade_flat_marks")
      .select("evaluation_id, class_id, class_label, class_level, mark_20")
      .in("evaluation_id", evalIds);

    if (marksErr) {
      console.error("[admin.notes.overview] grade_flat_marks error", marksErr);
      return NextResponse.json(
        { ok: false, error: "SCORES_ERROR" },
        { status: 500 }
      );
    }

    flatMarks = (marksData || []) as FlatMarkRow[];
  }

  /* ───────── 3) Métadonnées matières & enseignants ───────── */

  const subjectsById: Record<string, { name: string }> = {};
  if (subjectIds.length) {
    // 3a) Essayer d'abord via institution_subjects (cas custom_name, ou ancien schéma)
    const { data: instById, error: instByIdErr } = await supabase
      .from("institution_subjects")
      .select("id, subject_id, custom_name, subjects(name)")
      .in("id", subjectIds)
      .eq("institution_id", institutionId);

    if (instByIdErr) {
      console.error(
        "[admin.notes.overview] institution_subjects by id error",
        instByIdErr
      );
      return NextResponse.json(
        { ok: false, error: "SUBJECTS_ERROR" },
        { status: 500 }
      );
    }

    const { data: instBySubject, error: instBySubjectErr } = await supabase
      .from("institution_subjects")
      .select("id, subject_id, custom_name, subjects(name)")
      .in("subject_id", subjectIds)
      .eq("institution_id", institutionId);

    if (instBySubjectErr) {
      console.error(
        "[admin.notes.overview] institution_subjects by subject_id error",
        instBySubjectErr
      );
      return NextResponse.json(
        { ok: false, error: "SUBJECTS_ERROR" },
        { status: 500 }
      );
    }

    const instRows = [
      ...((instById || []) as InstSubjectRow[]),
      ...((instBySubject || []) as InstSubjectRow[]),
    ];

    const resolvedIds = new Set<string>();

    for (const row of instRows) {
      const base = row.subjects?.name || "Matière";
      const finalName = (row.custom_name || base || "Matière").trim();

      // On mappe à la fois sur institution_subjects.id ET sur subjects.id
      if (row.id) {
        subjectsById[row.id] = { name: finalName };
        resolvedIds.add(row.id);
      }
      if (row.subject_id) {
        subjectsById[row.subject_id] = { name: finalName };
        resolvedIds.add(row.subject_id);
      }
    }

    // 3b) Pour les subject_ids restants, on va directement dans subjects
    const leftoverSubjectIds = subjectIds.filter((id) => !resolvedIds.has(id));

    if (leftoverSubjectIds.length) {
      const { data: subjData, error: subjErr } = await supabase
        .from("subjects")
        .select("id, name")
        .in("id", leftoverSubjectIds);

      if (subjErr) {
        console.error("[admin.notes.overview] subjects error", subjErr);
        return NextResponse.json(
          { ok: false, error: "SUBJECTS_ERROR" },
          { status: 500 }
        );
      }

      for (const s of (subjData || []) as SubjectRow[]) {
        subjectsById[s.id] = {
          name: (s.name || "Matière").trim(),
        };
      }
    }
  }

  const teachersById: Record<string, { name: string }> = {};
  if (teacherIds.length) {
    const { data: teachersData, error: teachersErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", teacherIds);

    if (teachersErr) {
      console.error("[admin.notes.overview] profiles error", teachersErr);
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

  /* ───────── 4) Agrégations globales à partir de mark_20 ───────── */

  const evaluations_total = evalRows.length;
  const evaluations_published = evalRows.filter((e) => e.is_published).length;
  const evaluations_unpublished = evaluations_total - evaluations_published;

  let scores_count = 0;
  let sumGlobal = 0;
  let countGlobal = 0;

  type AggLevel = {
    evalIds: Set<string>;
    sum: number;
    count: number;
  };
  type AggClass = {
    class_label: string;
    level: string | null;
    evalIds: Set<string>;
    sum: number;
    count: number;
  };

  const levelAgg = new Map<string, AggLevel>();
  const classAgg = new Map<string, AggClass>();

  for (const row of flatMarks) {
    if (!row.evaluation_id || row.mark_20 == null) continue;
    if (row.class_id && !allowedClassIds.has(row.class_id)) continue;

    const mark = Number(row.mark_20);
    if (!Number.isFinite(mark)) continue;

    scores_count += 1;
    sumGlobal += mark;
    countGlobal += 1;

    const levelName = (row.class_level || "Autres").trim();
    const classIdKey = row.class_id || `__no_class_${row.evaluation_id}`;
    const classLabel = (row.class_label || "Classe").trim();
    const levelValue = row.class_level || null;

    // Par niveau
    let lv = levelAgg.get(levelName);
    if (!lv) {
      lv = { evalIds: new Set<string>(), sum: 0, count: 0 };
      levelAgg.set(levelName, lv);
    }
    lv.evalIds.add(row.evaluation_id);
    lv.sum += mark;
    lv.count += 1;

    // Par classe
    let ca = classAgg.get(classIdKey);
    if (!ca) {
      ca = {
        class_label: classLabel,
        level: levelValue,
        evalIds: new Set<string>(),
        sum: 0,
        count: 0,
      };
      classAgg.set(classIdKey, ca);
    }
    ca.evalIds.add(row.evaluation_id);
    ca.sum += mark;
    ca.count += 1;
  }

  const avg_score_20 =
    countGlobal > 0 ? Number((sumGlobal / countGlobal).toFixed(2)) : null;

  const by_level = Array.from(levelAgg.entries())
    .map(([level, agg]) => ({
      level,
      evals: agg.evalIds.size,
      avg_20:
        agg.count > 0 ? Number((agg.sum / agg.count).toFixed(2)) : null,
    }))
    .sort((a, b) => a.level.localeCompare(b.level, "fr", { numeric: true }));

  const by_class = Array.from(classAgg.entries())
    .map(([class_id, agg]) => ({
      class_id,
      class_label: agg.class_label,
      level: agg.level,
      evals: agg.evalIds.size,
      avg_20:
        agg.count > 0 ? Number((agg.sum / agg.count).toFixed(2)) : null,
    }))
    .sort((a, b) =>
      a.class_label.localeCompare(b.class_label, "fr", { numeric: true })
    );

  const worst_classes = by_class
    .filter((c) => c.avg_20 != null && c.evals > 0)
    .sort((a, b) => a.avg_20! - b.avg_20!)
    .slice(0, 5);

  /* ───────── 5) Dernières évaluations (top 10) ───────── */

  const latest = [...evalRows]
    .sort((a, b) => b.eval_date.localeCompare(a.eval_date))
    .slice(0, 10)
    .map((ev) => {
      const c = classesById[ev.class_id];
      const subj = ev.subject_id ? subjectsById[ev.subject_id] : null;
      const teacher = ev.teacher_id ? teachersById[ev.teacher_id] : null;
      return {
        id: ev.id,
        eval_date: ev.eval_date,
        eval_kind: ev.eval_kind,
        scale: ev.scale,
        coeff: ev.coeff,
        is_published: ev.is_published,
        class_label: c?.label ?? "Classe",
        level: c?.level ?? null,
        subject_name: subj?.name ?? null,
        teacher_name: teacher?.name ?? null,
      };
    });

  return NextResponse.json({
    ok: true,
    meta: { days },
    counts: {
      evaluations_total,
      evaluations_published,
      evaluations_unpublished,
      scores_count,
      avg_score_20,
    },
    breakdown: {
      by_level,
      by_class,
      worst_classes,
    },
    latest,
  });
}

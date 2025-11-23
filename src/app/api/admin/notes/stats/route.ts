// src/app/api/admin/notes/stats/route.ts
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
  academic_year?: string | null;
};

type ScoreRow = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
};

type ClassRow = {
  id: string;
  label?: string | null;
  code?: string | null;
  level?: string | null;
  academic_year?: string | null;
  institution_id?: string | null;
};

type SubjectRow = { id: string; name?: string | null };
type TeacherRow = { id: string; display_name?: string | null };

type Agg = {
  evalIds: Set<string>;
  notesCount: number;
  sumNormCoeff: number; // Σ (note_normalisée_/20 × coeff)
  sumCoeff: number; // Σ coeff pour chaque note
};

function makeAgg(): Agg {
  return {
    evalIds: new Set<string>(),
    notesCount: 0,
    sumNormCoeff: 0,
    sumCoeff: 0,
  };
}

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();

  /* ───────── Auth + rôle admin via user_roles ───────── */
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("[admin.notes.stats] auth error", authError);
    return NextResponse.json(
      { ok: false, error: "UNAUTHENTICATED" },
      { status: 401 }
    );
  }

  // 1) Profil
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || !profile) {
    console.error("[admin.notes.stats] profile error", profErr, profile);
    return NextResponse.json(
      { ok: false, error: "PROFILE_ERROR" },
      { status: 403 }
    );
  }

  // 2) Rôle dans user_roles
  const { data: userRole, error: roleErr } = await supabase
    .from("user_roles")
    .select("role, institution_id")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (roleErr || !userRole) {
    console.error("[admin.notes.stats] user_roles error", roleErr, userRole);
    return NextResponse.json(
      { ok: false, error: "PROFILE_ERROR" },
      { status: 403 }
    );
  }

  const role = (userRole.role ?? "") as string;

  if (!["super_admin", "admin"].includes(role)) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const institutionId = userRole.institution_id as string | null;

  /* ───────── Filtres ───────── */
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const published = url.searchParams.get("published"); // "true" | "false" | null
  const academicYear = url.searchParams.get("academic_year"); // optionnel

  /* ───────── Récup des évaluations ───────── */
  let evalQuery = supabase
    .from("grade_evaluations")
    .select(
      "id, class_id, subject_id, teacher_id, eval_date, eval_kind, scale, coeff, is_published, academic_year",
      { count: "exact" }
    )
    .order("eval_date", { ascending: false });

  if (from) evalQuery = evalQuery.gte("eval_date", from);
  if (to) evalQuery = evalQuery.lte("eval_date", to);
  if (published === "true") evalQuery = evalQuery.eq("is_published", true);
  if (published === "false") evalQuery = evalQuery.eq("is_published", false);
  if (academicYear) evalQuery = evalQuery.eq("academic_year", academicYear);

  const { data: evalData, error: evalErr, count: evalCount } = await evalQuery;

  if (evalErr) {
    console.error("[admin.notes.stats] grade_evaluations error", evalErr);
    return NextResponse.json(
      { ok: false, error: "EVALS_ERROR" },
      { status: 500 }
    );
  }

  const evalRows = (evalData || []) as EvalRow[];

  if (!evalRows.length) {
    return NextResponse.json({
      ok: true,
      meta: {
        from,
        to,
        academic_year: academicYear,
        evals_total: 0,
      },
      global: {
        evals_count: 0,
        notes_count: 0,
        avg_score_20: null,
      },
      by_class: [] as any[],
      by_class_subject: [] as any[],
      by_teacher: [] as any[],
    });
  }

  const evalIds = Array.from(new Set(evalRows.map((e) => e.id)));
  const classIds = Array.from(new Set(evalRows.map((e) => e.class_id)));
  const subjectIds = Array.from(
    new Set(
      evalRows
        .map((e) => e.subject_id)
        .filter((x): x is string => !!x)
    )
  );
  const teacherIds = Array.from(
    new Set(
      evalRows
        .map((e) => e.teacher_id)
        .filter((x): x is string => !!x)
    )
  );

  /* ───────── Notes (student_grades) ───────── */
  let scoreRows: ScoreRow[] = [];
  if (evalIds.length) {
    const { data: scoresData, error: scoresErr } = await supabase
      .from("student_grades")
      .select("evaluation_id, student_id, score")
      .in("evaluation_id", evalIds);

    if (scoresErr) {
      console.error("[admin.notes.stats] student_grades error", scoresErr);
      return NextResponse.json(
        { ok: false, error: "SCORES_ERROR" },
        { status: 500 }
      );
    }
    scoreRows = (scoresData || []) as ScoreRow[];
  }

  /* ───────── Métadonnées classes / matières / enseignants ───────── */
  const classesById: Record<string, { label: string; level: string | null }> =
    {};
  if (classIds.length) {
    let classesQuery = supabase
      .from("classes")
      .select("id, label, level, code, academic_year, institution_id")
      .in("id", classIds);

    if (institutionId) {
      classesQuery = classesQuery.eq("institution_id", institutionId);
    }

    const { data: classesData, error: classesErr } = await classesQuery;

    if (classesErr) {
      console.error("[admin.notes.stats] classes error", classesErr);
      return NextResponse.json(
        { ok: false, error: "CLASSES_ERROR" },
        { status: 500 }
      );
    }

    for (const c of (classesData || []) as ClassRow[]) {
      const label = (c.label || c.code || "Classe").trim();
      classesById[c.id] = {
        label,
        level: (c.level || null) ?? null,
      };
    }
  }

  const subjectsById: Record<string, { name: string }> = {};
  if (subjectIds.length) {
    const { data: subjectsData, error: subjectsErr } = await supabase
      .from("subjects")
      .select("id, name")
      .in("id", subjectIds);

    if (subjectsErr) {
      console.error("[admin.notes.stats] subjects error", subjectsErr);
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

  const teachersById: Record<string, { name: string }> = {};
  if (teacherIds.length) {
    const { data: teachersData, error: teachersErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", teacherIds);

    if (teachersErr) {
      console.error("[admin.notes.stats] profiles (teachers) error", teachersErr);
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

  /* ───────── Agrégations ───────── */
  const evalById: Record<string, EvalRow> = {};
  for (const ev of evalRows) {
    evalById[ev.id] = ev;
  }

  const globalAgg: Agg = makeAgg();
  const byClassAgg = new Map<string, Agg>();
  const byClassSubjectAgg = new Map<string, Agg>();
  const byTeacherAgg = new Map<string, Agg>();

  function getAgg(map: Map<string, Agg>, key: string): Agg {
    let agg = map.get(key);
    if (!agg) {
      agg = makeAgg();
      map.set(key, agg);
    }
    return agg;
  }

  // 1) Parcours des notes non nulles
  for (const sc of scoreRows) {
    if (sc.score == null) continue;
    const ev = evalById[sc.evaluation_id];
    if (!ev) continue;
    if (!ev.scale || Number(ev.scale) <= 0) continue;

    const score = Number(sc.score);
    const scale = Number(ev.scale);
    const coeff = Number(ev.coeff || 1) || 1;

    const normalized20 = (score / scale) * 20;

    // Global
    globalAgg.notesCount += 1;
    globalAgg.sumNormCoeff += normalized20 * coeff;
    globalAgg.sumCoeff += coeff;
    globalAgg.evalIds.add(ev.id);

    // Par classe
    const classAgg = getAgg(byClassAgg, ev.class_id);
    classAgg.notesCount += 1;
    classAgg.sumNormCoeff += normalized20 * coeff;
    classAgg.sumCoeff += coeff;
    classAgg.evalIds.add(ev.id);

    // Par classe × matière
    if (ev.subject_id) {
      const key = `${ev.class_id}__${ev.subject_id}`;
      const csAgg = getAgg(byClassSubjectAgg, key);
      csAgg.notesCount += 1;
      csAgg.sumNormCoeff += normalized20 * coeff;
      csAgg.sumCoeff += coeff;
      csAgg.evalIds.add(ev.id);
    }

    // Par enseignant
    if (ev.teacher_id) {
      const tAgg = getAgg(byTeacherAgg, ev.teacher_id);
      tAgg.notesCount += 1;
      tAgg.sumNormCoeff += normalized20 * coeff;
      tAgg.sumCoeff += coeff;
      tAgg.evalIds.add(ev.id);
    }
  }

  // 2) On s'assure que toutes les évaluations sont comptées
  for (const ev of evalRows) {
    globalAgg.evalIds.add(ev.id);

    const classAgg = getAgg(byClassAgg, ev.class_id);
    classAgg.evalIds.add(ev.id);

    if (ev.subject_id) {
      const key = `${ev.class_id}__${ev.subject_id}`;
      const csAgg = getAgg(byClassSubjectAgg, key);
      csAgg.evalIds.add(ev.id);
    }

    if (ev.teacher_id) {
      const tAgg = getAgg(byTeacherAgg, ev.teacher_id);
      tAgg.evalIds.add(ev.id);
    }
  }

  function avgFromAgg(agg: Agg): number | null {
    if (!agg.sumCoeff || agg.sumCoeff <= 0) return null;
    return Number((agg.sumNormCoeff / agg.sumCoeff).toFixed(2));
  }

  const global = {
    evals_count: globalAgg.evalIds.size,
    notes_count: globalAgg.notesCount,
    avg_score_20: avgFromAgg(globalAgg),
  };

  const byClass = Array.from(byClassAgg.entries())
    .map(([classId, agg]) => {
      const cls = classesById[classId];
      return {
        class_id: classId,
        class_label: cls?.label ?? "Classe",
        level: cls?.level ?? null,
        evals_count: agg.evalIds.size,
        notes_count: agg.notesCount,
        avg_score_20: avgFromAgg(agg),
      };
    })
    .sort((a, b) => {
      const lvA = (a.level || "").toString();
      const lvB = (b.level || "").toString();
      const levelCmp = lvA.localeCompare(lvB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (levelCmp !== 0) return levelCmp;
      return a.class_label.localeCompare(b.class_label, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

  const byClassSubject = Array.from(byClassSubjectAgg.entries())
    .map(([key, agg]) => {
      const [classId, subjectId] = key.split("__");
      const cls = classesById[classId];
      const subj = subjectId ? subjectsById[subjectId] : null;
      return {
        class_id: classId,
        class_label: cls?.label ?? "Classe",
        level: cls?.level ?? null,
        subject_id: subjectId || null,
        subject_name: subj?.name ?? null,
        evals_count: agg.evalIds.size,
        notes_count: agg.notesCount,
        avg_score_20: avgFromAgg(agg),
      };
    })
    .sort((a, b) => {
      const aAvg = a.avg_score_20 ?? 0;
      const bAvg = b.avg_score_20 ?? 0;
      if (bAvg !== aAvg) return bAvg - aAvg;
      if (b.notes_count !== a.notes_count) return b.notes_count - a.notes_count;
      return (a.class_label + (a.subject_name || "")).localeCompare(
        b.class_label + (b.subject_name || ""),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        }
      );
    });

  const byTeacher = Array.from(byTeacherAgg.entries())
    .map(([teacherId, agg]) => {
      const t = teachersById[teacherId];
      return {
        teacher_id: teacherId,
        teacher_name: t?.name ?? "Enseignant",
        evals_count: agg.evalIds.size,
        notes_count: agg.notesCount,
        avg_score_20: avgFromAgg(agg),
      };
    })
    .sort((a, b) => {
      if (b.notes_count !== a.notes_count) return b.notes_count - a.notes_count;
      if (b.evals_count !== a.evals_count) return b.evals_count - a.evals_count;
      const aAvg = a.avg_score_20 ?? 0;
      const bAvg = b.avg_score_20 ?? 0;
      return bAvg - aAvg;
    });

  return NextResponse.json({
    ok: true,
    meta: {
      from,
      to,
      academic_year: academicYear,
      evals_total: evalCount ?? evalRows.length,
    },
    global,
    by_class: byClass,
    by_class_subject: byClassSubject,
    by_teacher: byTeacher,
  });
}

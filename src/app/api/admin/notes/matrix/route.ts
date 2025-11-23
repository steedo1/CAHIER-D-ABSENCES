// src/app/api/admin/notes/matrix/route.ts
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
  title: string | null;
  is_published: boolean;
};

type MarkRow = {
  evaluation_id: string;
  student_id: string;
  raw_score: number | null;
  mark_20: number | null;
  last_name: string | null;
  first_name: string | null;
  matricule: string | null;
};

type TeacherRow = {
  id: string;
  display_name: string | null;
};

type StudentOut = {
  student_id: string;
  full_name: string;
  matricule: string | null;
};

type EvalOut = {
  id: string;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  title: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
};

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();

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
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (roleErr || !roleRow || !["super_admin", "admin"].includes(roleRow.role)) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const classId = url.searchParams.get("class_id");
  const subjectIdRaw = url.searchParams.get("subject_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const published = url.searchParams.get("published"); // pour rester cohérent avec la liste d’évals

  if (!classId || !subjectIdRaw) {
    return NextResponse.json(
      { ok: false, error: "MISSING_PARAMS" },
      { status: 400 }
    );
  }

  // Résoudre subjectIdRaw (institution_subjects.id ou subjects.id) en subjects.id
  let canonicalSubjectId: string | null = null;

  try {
    const { data: isub, error: isubErr } = await supabase
      .from("institution_subjects")
      .select("subject_id")
      .eq("id", subjectIdRaw)
      .maybeSingle();

    if (!isubErr && isub && isub.subject_id) {
      canonicalSubjectId = isub.subject_id as string;
    } else {
      canonicalSubjectId = subjectIdRaw;
    }
  } catch {
    canonicalSubjectId = subjectIdRaw;
  }

  console.log("[admin.notes.matrix] PARAMS", {
    classId,
    subjectIdRaw,
    canonicalSubjectId,
    from,
    to,
    published,
    institution_id: roleRow.institution_id,
  });

  if (!canonicalSubjectId) {
    return NextResponse.json(
      { ok: false, error: "SUBJECT_RESOLUTION_FAILED" },
      { status: 400 }
    );
  }

  // 1) Évaluations de la classe + matière
  let evalQuery = supabase
    .from("grade_evaluations")
    .select(
      "id, class_id, subject_id, teacher_id, eval_date, eval_kind, scale, coeff, title, is_published",
      { count: "exact" }
    )
    .eq("class_id", classId)
    .eq("subject_id", canonicalSubjectId)
    .order("eval_date", { ascending: true });

  if (from) evalQuery = evalQuery.gte("eval_date", from);
  if (to) evalQuery = evalQuery.lte("eval_date", to);
  if (published === "true") evalQuery = evalQuery.eq("is_published", true);
  if (published === "false") evalQuery = evalQuery.eq("is_published", false);

  const { data: evalsData, error: evalErr } = await evalQuery;

  if (evalErr) {
    console.error("[admin.notes.matrix] grade_evaluations error", evalErr);
    return NextResponse.json(
      { ok: false, error: "EVALS_ERROR" },
      { status: 500 }
    );
  }

  const evalRows = (evalsData || []) as EvalRow[];

  if (!evalRows.length) {
    return NextResponse.json({
      ok: true,
      meta: {
        class_id: classId,
        subject_id: canonicalSubjectId,
        evaluations_count: 0,
        students_count: 0,
        from,
        to,
      },
      evaluations: [] as EvalOut[],
      students: [] as StudentOut[],
      marks: {} as Record<string, any>,
    });
  }

  const evalIds = Array.from(new Set(evalRows.map((e) => e.id)));

  // 2) Notes depuis grade_flat_marks
  const { data: marksData, error: marksErr } = await supabase
    .from("grade_flat_marks")
    .select(
      "evaluation_id, student_id, raw_score, mark_20, last_name, first_name, matricule"
    )
    .in("evaluation_id", evalIds);

  if (marksErr) {
    console.error("[admin.notes.matrix] grade_flat_marks error", marksErr);
    return NextResponse.json(
      { ok: false, error: "MARKS_ERROR" },
      { status: 500 }
    );
  }

  const marksRows = (marksData || []) as MarkRow[];

  // 3) Construire élèves + matrice de notes
  const studentsById = new Map<string, StudentOut>();
  const marksByStudent: Record<
    string,
    Record<string, { raw: number | null; mark_20: number | null }>
  > = {};

  for (const row of marksRows) {
    const sid = row.student_id;
    if (!sid) continue;

    if (!studentsById.has(sid)) {
      const ln = (row.last_name || "").trim();
      const fn = (row.first_name || "").trim();
      const full = (ln || fn) ? `${ln} ${fn}`.trim() : "Élève";
      studentsById.set(sid, {
        student_id: sid,
        full_name: full,
        matricule: row.matricule ?? null,
      });
    }

    if (!marksByStudent[sid]) {
      marksByStudent[sid] = {};
    }
    marksByStudent[sid][row.evaluation_id] = {
      raw: row.raw_score != null ? Number(row.raw_score) : null,
      mark_20: row.mark_20 != null ? Number(row.mark_20) : null,
    };
  }

  // Trier les élèves par nom
  const students = Array.from(studentsById.values()).sort((a, b) =>
    a.full_name.localeCompare(b.full_name, undefined, {
      sensitivity: "base",
      numeric: true,
    })
  );

  // 4) Noms des enseignants
  const teacherIds = Array.from(
    new Set(
      evalRows.map((e) => e.teacher_id).filter((x): x is string => !!x)
    )
  );

  const teachersById: Record<string, string> = {};
  if (teacherIds.length) {
    const { data: teachersData, error: teachersErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", teacherIds);

    if (teachersErr) {
      console.error("[admin.notes.matrix] profiles error", teachersErr);
      return NextResponse.json(
        { ok: false, error: "TEACHERS_ERROR" },
        { status: 500 }
      );
    }

    for (const t of (teachersData || []) as TeacherRow[]) {
      teachersById[t.id] = (t.display_name || "Enseignant").trim();
    }
  }

  const evaluations: EvalOut[] = evalRows.map((ev) => ({
    id: ev.id,
    eval_date: ev.eval_date,
    eval_kind: ev.eval_kind,
    scale: ev.scale,
    coeff: ev.coeff,
    title: ev.title ?? null,
    teacher_id: ev.teacher_id,
    teacher_name: ev.teacher_id ? teachersById[ev.teacher_id] ?? null : null,
  }));

  return NextResponse.json({
    ok: true,
    meta: {
      class_id: classId,
      subject_id: canonicalSubjectId,
      evaluations_count: evaluations.length,
      students_count: students.length,
      from,
      to,
    },
    evaluations,
    students,
    marks: marksByStudent,
  });
}

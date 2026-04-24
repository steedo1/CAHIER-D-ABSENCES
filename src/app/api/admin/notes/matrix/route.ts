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
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
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

function cleanName(...parts: Array<string | null | undefined>) {
  return parts
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function studentFullName(s: any) {
  const full = cleanName(s?.full_name);
  if (full) return full;

  const lastFirst = cleanName(s?.last_name, s?.first_name);
  if (lastFirst) return lastFirst;

  const firstLast = cleanName(s?.first_name, s?.last_name);
  if (firstLast) return firstLast;

  return "Élève";
}

function teacherDisplayName(t: TeacherRow) {
  const direct = cleanName(t.display_name);
  if (direct) return direct;

  const lastFirst = cleanName(t.last_name, t.first_name);
  if (lastFirst) return lastFirst;

  const email = cleanName(t.email);
  if (email) return email.includes("@") ? email.split("@")[0] : email;

  return "Enseignant";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))
  );
}

function chunks<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();

  try {
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

    const institutionId = roleRow.institution_id as string | null;
    if (!institutionId) {
      return NextResponse.json(
        { ok: false, error: "NO_INSTITUTION" },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const classId = url.searchParams.get("class_id");
    const subjectIdRaw = url.searchParams.get("subject_id");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const published = url.searchParams.get("published");

    if (!classId || !subjectIdRaw) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PARAMS" },
        { status: 400 }
      );
    }

    /* ───────── Vérifier que la classe appartient à l'établissement ───────── */
    const { data: cls, error: clsErr } = await supabase
      .from("classes")
      .select("id, institution_id, label, level")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) {
      console.error("[admin.notes.matrix] classes check error", clsErr);
      return NextResponse.json(
        { ok: false, error: "CLASSES_ERROR" },
        { status: 500 }
      );
    }

    if (!cls || (cls as any).institution_id !== institutionId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN_CLASS" },
        { status: 403 }
      );
    }

    /*
      Résolution matière :
      - subjectIdRaw peut être un subjects.id
      - ou un institution_subjects.id
      - et certaines anciennes évaluations peuvent encore avoir l'un ou l'autre.
      Donc on construit une liste acceptée pour ne pas perdre les anciennes données.
    */
    let canonicalSubjectId: string | null = null;
    const acceptedSubjectIds = new Set<string>();
    acceptedSubjectIds.add(subjectIdRaw);

    const { data: isub, error: isubErr } = await supabase
      .from("institution_subjects")
      .select("id, subject_id, institution_id")
      .eq("id", subjectIdRaw)
      .maybeSingle();

    if (isubErr) {
      console.error("[admin.notes.matrix] institution_subjects by id error", isubErr);
      return NextResponse.json(
        { ok: false, error: "SUBJECTS_ERROR" },
        { status: 500 }
      );
    }

    if (isub) {
      if ((isub as any).institution_id !== institutionId) {
        return NextResponse.json(
          { ok: false, error: "FORBIDDEN_SUBJECT" },
          { status: 403 }
        );
      }

      canonicalSubjectId = String((isub as any).subject_id);
      acceptedSubjectIds.add(String((isub as any).id));
      acceptedSubjectIds.add(canonicalSubjectId);
    } else {
      canonicalSubjectId = subjectIdRaw;

      const { data: links, error: linksErr } = await supabase
        .from("institution_subjects")
        .select("id, subject_id, institution_id")
        .eq("subject_id", canonicalSubjectId)
        .eq("institution_id", institutionId);

      if (linksErr) {
        console.error("[admin.notes.matrix] institution_subjects by subject_id error", linksErr);
        return NextResponse.json(
          { ok: false, error: "SUBJECTS_ERROR" },
          { status: 500 }
        );
      }

      for (const link of links || []) {
        if ((link as any).id) acceptedSubjectIds.add(String((link as any).id));
        if ((link as any).subject_id) acceptedSubjectIds.add(String((link as any).subject_id));
      }
    }

    if (!canonicalSubjectId) {
      return NextResponse.json(
        { ok: false, error: "SUBJECT_RESOLUTION_FAILED" },
        { status: 400 }
      );
    }

    const subjectIdsForQuery = Array.from(acceptedSubjectIds);

    console.log("[admin.notes.matrix] PARAMS", {
      classId,
      subjectIdRaw,
      canonicalSubjectId,
      subjectIdsForQuery,
      from,
      to,
      published,
      institution_id: institutionId,
    });

    /* ───────── 1) Évaluations de la classe + matière ───────── */
    let evalQuery = supabase
      .from("grade_evaluations")
      .select(
        "id, class_id, subject_id, teacher_id, eval_date, eval_kind, scale, coeff, title, is_published, classes!inner(institution_id)",
        { count: "exact" }
      )
      .eq("classes.institution_id", institutionId)
      .eq("class_id", classId)
      .in("subject_id", subjectIdsForQuery)
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

    const evalRows = (evalsData || []) as any as EvalRow[];

    /*
      Même s'il n'y a pas d'évaluation, on ne bloque pas brutalement.
      Mais pour la matrice matière, sans évaluation il n'y a pas de notes à afficher.
    */
    if (!evalRows.length) {
      return NextResponse.json({
        ok: true,
        meta: {
          class_id: classId,
          subject_id: canonicalSubjectId,
          subject_ids_used: subjectIdsForQuery,
          class_label: (cls as any)?.label ?? null,
          level: (cls as any)?.level ?? null,
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

    /* ───────── 2) Roster historique de la classe ───────── */
    const rosterFrom = from || "0001-01-01";
    const rosterTo = to || "9999-12-31";

    let enrollQuery = supabase
      .from("class_enrollments")
      .select(
        `
        student_id,
        students:student_id (
          id,
          full_name,
          first_name,
          last_name,
          matricule
        )
      `
      )
      .eq("class_id", classId);

    if (from || to) {
      enrollQuery = enrollQuery
        .lte("start_date", rosterTo)
        .or(`end_date.is.null,end_date.gte.${rosterFrom}`);
    } else {
      enrollQuery = enrollQuery.is("end_date", null);
    }

    const { data: enrollData, error: enrollErr } = await enrollQuery;

    if (enrollErr) {
      console.error("[admin.notes.matrix] class_enrollments error", enrollErr);
      return NextResponse.json(
        { ok: false, error: "ENROLLMENTS_ERROR" },
        { status: 500 }
      );
    }

    const initialStudents: StudentOut[] = (enrollData || []).map((r: any) => {
      const s = r.students || {};
      return {
        student_id: String(r.student_id),
        full_name: studentFullName(s),
        matricule: (s.matricule ?? null) as string | null,
      };
    });

    /* ───────── 3) Notes depuis grade_flat_marks ───────── */
    const marksRows: MarkRow[] = [];

    for (const part of chunks(evalIds, 500)) {
      const { data: marksData, error: marksErr } = await supabase
        .from("grade_flat_marks")
        .select(
          "evaluation_id, student_id, raw_score, mark_20, last_name, first_name, matricule"
        )
        .in("evaluation_id", part);

      if (marksErr) {
        console.error("[admin.notes.matrix] grade_flat_marks error", marksErr);
        return NextResponse.json(
          { ok: false, error: "MARKS_ERROR" },
          { status: 500 }
        );
      }

      marksRows.push(...((marksData || []) as MarkRow[]));
    }

    /* ───────── 4) Construire élèves + matrice de notes ───────── */
    const studentsById = new Map<string, StudentOut>();

    for (const st of initialStudents) {
      if (!st.student_id) continue;
      studentsById.set(st.student_id, st);
    }

    const marksByStudent: Record<
      string,
      Record<string, { raw: number | null; mark_20: number | null }>
    > = {};

    for (const row of marksRows) {
      const sid = row.student_id;
      if (!sid) continue;

      if (!studentsById.has(sid)) {
        const full = cleanName(row.last_name, row.first_name) || "Élève";
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

    const students = Array.from(studentsById.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, {
        sensitivity: "base",
        numeric: true,
      })
    );

    /* ───────── 5) Noms des enseignants ───────── */
    const teacherIds = uniqueStrings(evalRows.map((e) => e.teacher_id));

    const teachersById: Record<string, string> = {};

    if (teacherIds.length) {
      const { data: teachersData, error: teachersErr } = await supabase
        .from("profiles")
        .select("id, display_name, first_name, last_name, email")
        .in("id", teacherIds);

      if (teachersErr) {
        console.error("[admin.notes.matrix] profiles error", teachersErr);
        return NextResponse.json(
          { ok: false, error: "TEACHERS_ERROR" },
          { status: 500 }
        );
      }

      for (const t of (teachersData || []) as TeacherRow[]) {
        teachersById[t.id] = teacherDisplayName(t);
      }
    }

    const evaluations: EvalOut[] = evalRows.map((ev) => ({
      id: ev.id,
      eval_date: ev.eval_date,
      eval_kind: ev.eval_kind,
      scale: Number(ev.scale || 20),
      coeff: Number(ev.coeff || 1),
      title: ev.title ?? null,
      teacher_id: ev.teacher_id,
      teacher_name: ev.teacher_id ? teachersById[ev.teacher_id] ?? null : null,
    }));

    return NextResponse.json({
      ok: true,
      meta: {
        class_id: classId,
        subject_id: canonicalSubjectId,
        subject_ids_used: subjectIdsForQuery,
        class_label: (cls as any)?.label ?? null,
        level: (cls as any)?.level ?? null,
        evaluations_count: evaluations.length,
        students_count: students.length,
        from,
        to,
      },
      evaluations,
      students,
      marks: marksByStudent,
    });
  } catch (e: any) {
    console.error("[admin.notes.matrix] fatal error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
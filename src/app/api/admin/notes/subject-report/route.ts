// src/app/api/admin/notes/subject-report/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type ClassRow = {
  id: string;
  label: string | null;
  level: string | null;
};

type SubjectRow = {
  id: string;
  name: string | null;
};

type RosterRow = {
  student_id: string;
  students: {
    full_name: string | null;
    matricule: string | null;
  } | null;
};

type MarkRow = {
  evaluation_id: string;
  student_id: string;
  mark_20: number | null;
  eval_coeff: number | null;
  eval_date: string;
  academic_year: string | null;
};

type StudentAgg = {
  evalIds: Set<string>;
  notesCount: number;
  sumNormCoeff: number;
  sumCoeff: number;
};

function makeStudentAgg(): StudentAgg {
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
    console.error("[admin.notes.subject-report] auth error", authError);
    return NextResponse.json(
      { ok: false, error: "UNAUTHENTICATED" },
      { status: 401 }
    );
  }

  // Profil
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || !profile) {
    console.error("[admin.notes.subject-report] profile error", profErr, profile);
    return NextResponse.json(
      { ok: false, error: "PROFILE_ERROR" },
      { status: 403 }
    );
  }

  // Rôle
  const { data: userRole, error: roleErr } = await supabase
    .from("user_roles")
    .select("role, institution_id")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (roleErr || !userRole) {
    console.error("[admin.notes.subject-report] user_roles error", roleErr, userRole);
    return NextResponse.json(
      { ok: false, error: "PROFILE_ERROR" },
      { status: 403 }
    );
  }

  const role = (userRole.role ?? "") as Role;
  if (!["super_admin", "admin"].includes(role)) {
    return NextResponse.json(
      { ok: false, error: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const institutionId = userRole.institution_id as string | null;

  /* ───────── Params ───────── */
  const url = new URL(req.url);
  const classId = url.searchParams.get("class_id");
  const subjectId = url.searchParams.get("subject_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const academicYear = url.searchParams.get("academic_year");

  if (!classId || !subjectId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_PARAMS" },
      { status: 400 }
    );
  }

  /* ───────── Classe & matière ───────── */
  const { data: classData, error: classErr } = await supabase
    .from("classes")
    .select("id, label, level")
    .eq("id", classId)
    .maybeSingle();

  if (classErr || !classData) {
    console.error("[admin.notes.subject-report] classes error", classErr, classData);
    return NextResponse.json(
      { ok: false, error: "CLASS_ERROR" },
      { status: 500 }
    );
  }

  const cls = classData as ClassRow;

  const { data: subjectData, error: subjectErr } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("id", subjectId)
    .maybeSingle();

  if (subjectErr || !subjectData) {
    console.error("[admin.notes.subject-report] subjects error", subjectErr, subjectData);
    return NextResponse.json(
      { ok: false, error: "SUBJECT_ERROR" },
      { status: 500 }
    );
  }

  const subj = subjectData as SubjectRow;

  /* ───────── Roster : TOUS les élèves de la classe ───────── */
  let rosterQuery = supabase
    .from("class_students")
    .select("student_id, students(full_name, matricule)")
    .eq("class_id", classId);

  if (institutionId) {
    rosterQuery = rosterQuery.eq("institution_id", institutionId);
  }

  // si tu as une colonne end_date pour les anciens élèves, tu peux filtrer ici :
  // rosterQuery = rosterQuery.is("end_date", null);

  const { data: rosterData, error: rosterErr } = await rosterQuery;

  if (rosterErr) {
    console.error("[admin.notes.subject-report] class_students error", rosterErr);
    return NextResponse.json(
      { ok: false, error: "ROSTER_ERROR" },
      { status: 500 }
    );
  }

  // Normalisation pour gérer le cas où Supabase tape `students` comme tableau
  const roster: RosterRow[] = (rosterData ?? []).map((row: any) => {
    const rawStudents = row.students;
    let normalized: RosterRow["students"] = null;

    if (Array.isArray(rawStudents)) {
      const first = rawStudents[0];
      if (first && typeof first === "object") {
        normalized = {
          full_name:
            typeof first.full_name === "string" || first.full_name == null
              ? first.full_name
              : String(first.full_name),
          matricule:
            typeof first.matricule === "string" || first.matricule == null
              ? first.matricule
              : String(first.matricule),
        };
      }
    } else if (rawStudents && typeof rawStudents === "object") {
      normalized = {
        full_name:
          typeof rawStudents.full_name === "string" || rawStudents.full_name == null
            ? rawStudents.full_name
            : String(rawStudents.full_name),
        matricule:
          typeof rawStudents.matricule === "string" || rawStudents.matricule == null
            ? rawStudents.matricule
            : String(rawStudents.matricule),
      };
    }

    return {
      student_id: String(row.student_id),
      students: normalized,
    };
  });

  if (!roster.length) {
    return NextResponse.json({
      ok: true,
      meta: {
        class_id: classId,
        class_label: cls.label ?? "Classe",
        class_level: cls.level,
        subject_id: subjectId,
        subject_name: subj.name ?? "Matière",
        from,
        to,
        academic_year: academicYear,
        evals_count: 0,
        notes_count: 0,
        class_avg_20: null,
        min_avg_20: null,
        max_avg_20: null,
      },
      distribution: {
        lt5: 0,
        gte5_lt10: 0,
        gte10_lt12: 0,
        gte12_lt15: 0,
        gte15: 0,
      },
      students: [] as any[],
    });
  }

  /* ───────── Notes pour cette classe + matière ─────────
     On part de la vue GRADE_FLAT_MARKS pour récupérer directement mark_20 & eval_coeff
  ─────────────────────────────────────────────────────── */
  let marksQuery = supabase
    .from("grade_flat_marks")
    .select(
      "evaluation_id, student_id, mark_20, eval_coeff, eval_date, academic_year"
    )
    .eq("class_id", classId)
    .eq("subject_id", subjectId);

  if (from) marksQuery = marksQuery.gte("eval_date", from);
  if (to) marksQuery = marksQuery.lte("eval_date", to);
  if (academicYear) marksQuery = marksQuery.eq("academic_year", academicYear);

  const { data: marksData, error: marksErr } = await marksQuery;

  if (marksErr) {
    console.error("[admin.notes.subject-report] grade_flat_marks error", marksErr);
    return NextResponse.json(
      { ok: false, error: "MARKS_ERROR" },
      { status: 500 }
    );
  }

  const marks = (marksData || []) as MarkRow[];

  // Agrégations par élève
  const studentAggMap = new Map<string, StudentAgg>();
  const evalIdsGlobal = new Set<string>();
  let notesCountGlobal = 0;

  function getStudentAgg(studentId: string): StudentAgg {
    let agg = studentAggMap.get(studentId);
    if (!agg) {
      agg = makeStudentAgg();
      studentAggMap.set(studentId, agg);
    }
    return agg;
  }

  for (const m of marks) {
    if (m.mark_20 == null) continue;

    const coeff = Number(m.eval_coeff ?? 1) || 1;
    const note20 = Number(m.mark_20);

    notesCountGlobal += 1;
    evalIdsGlobal.add(m.evaluation_id);

    const agg = getStudentAgg(m.student_id);
    agg.notesCount += 1;
    agg.evalIds.add(m.evaluation_id);
    agg.sumCoeff += coeff;
    agg.sumNormCoeff += note20 * coeff;
  }

  /* ───────── Construction des élèves + moyennes + rangs ───────── */

  type StudentRow = {
    student_id: string;
    full_name: string;
    matricule: string | null;
    avg_20: number; // moyenne affichée (0 pour aucun devoir)
    has_grades: boolean; // true si au moins une note
    evals_count: number;
    notes_count: number;
    rank?: number;
  };

  const students: StudentRow[] = [];

  let sumAvgForClass = 0;
  let minAvg: number | null = null;
  let maxAvg: number | null = null;

  const distribution = {
    lt5: 0,
    gte5_lt10: 0,
    gte10_lt12: 0,
    gte12_lt15: 0,
    gte15: 0,
  };

  for (const r of roster) {
    const stud = r.students;
    const fullNameBase = stud?.full_name ?? "Élève";
    const fullName = fullNameBase ? fullNameBase.trim() : "Élève";
    const matricule = stud?.matricule ?? null;

    const agg = studentAggMap.get(r.student_id);

    let avg20 = 0;
    let hasGrades = false;
    let evalsCount = 0;
    let notesCount = 0;

    if (agg && agg.sumCoeff > 0) {
      hasGrades = true;
      evalsCount = agg.evalIds.size;
      notesCount = agg.notesCount;
      avg20 = Number((agg.sumNormCoeff / agg.sumCoeff).toFixed(2));
    } else {
      // AUCUNE NOTE → moyenne 0 (demandé)
      avg20 = 0;
      hasGrades = false;
      evalsCount = 0;
      notesCount = 0;
    }

    // stats globales (incluent les élèves à 0)
    sumAvgForClass += avg20;

    if (minAvg === null || avg20 < minAvg) minAvg = avg20;
    if (maxAvg === null || avg20 > maxAvg) maxAvg = avg20;

    // Répartition des moyennes
    if (avg20 < 5) distribution.lt5 += 1;
    else if (avg20 < 10) distribution.gte5_lt10 += 1;
    else if (avg20 < 12) distribution.gte10_lt12 += 1;
    else if (avg20 < 15) distribution.gte12_lt15 += 1;
    else distribution.gte15 += 1;

    students.push({
      student_id: r.student_id,
      full_name: fullName,
      matricule,
      avg_20: avg20,
      has_grades: hasGrades,
      evals_count: evalsCount,
      notes_count: notesCount,
    });
  }

  // Moyenne de classe = moyenne des moyennes élèves (y compris ceux à 0)
  const classAvg =
    students.length > 0
      ? Number((sumAvgForClass / students.length).toFixed(2))
      : null;

  // Tri + rangs
  students.sort((a, b) => {
    if (b.avg_20 !== a.avg_20) return b.avg_20 - a.avg_20;
    return a.full_name.localeCompare(b.full_name, undefined, {
      sensitivity: "base",
    });
  });

  let currentRank = 1;
  for (let i = 0; i < students.length; i++) {
    if (i > 0 && students[i].avg_20 !== students[i - 1].avg_20) {
      currentRank = i + 1;
    }
    students[i].rank = currentRank;
  }

  return NextResponse.json({
    ok: true,
    meta: {
      class_id: classId,
      class_label: cls.label ?? "Classe",
      class_level: cls.level,
      subject_id: subjectId,
      subject_name: subj.name ?? "Matière",
      from,
      to,
      academic_year: academicYear,
      evals_count: evalIdsGlobal.size,
      notes_count: notesCountGlobal,
      class_avg_20: classAvg,
      min_avg_20: minAvg,
      max_avg_20: maxAvg,
    },
    distribution,
    students,
  });
}

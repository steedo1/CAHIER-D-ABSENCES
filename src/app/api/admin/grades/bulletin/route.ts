// src/app/api/admin/grades/bulletin/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | string;

type ClassRow = {
  id: string;
  label?: string | null;
  code?: string | null;
  institution_id?: string | null;
  academic_year?: string | null;
  head_teacher_id?: string | null;
  level?: string | null;
};

type HeadTeacherRow = {
  id: string;
  display_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  eval_date: string;
  scale: number;
  coeff: number;
  is_published: boolean;
  subject_component_id?: string | null; // ✅ sous-matière éventuelle
};

type ScoreRow = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
};

type ClassStudentRow = {
  student_id: string;
  students?: {
    full_name?: string | null;
    last_name?: string | null;
    first_name?: string | null;
    matricule?: string | null;

    // 🆕 champs identité réellement présents en BDD
    gender?: string | null;
    birthdate?: string | null;
    birth_place?: string | null;
    nationality?: string | null;
    regime?: string | null;
    is_repeater?: boolean | null;
    is_boarder?: boolean | null;
    is_affecte?: boolean | null;
  } | null;
};

type SubjectRow = {
  id: string;
  name?: string | null;
  code?: string | null;
};

type SubjectCoeffRow = {
  subject_id: string;
  coeff: number;
  include_in_average?: boolean | null;
  level?: string | null;
};

type BulletinSubjectGroupItem = {
  id: string;
  group_id: string;
  institution_subject_id: string;
  subject_id: string;
  subject_name: string;
  level: string | null;
  order_index: number;
  subject_coeff_override: number | null;
  is_optional: boolean;
};

type BulletinSubjectGroup = {
  id: string;
  code: string;
  label: string;
  short_label: string | null;
  order_index: number;
  is_active: boolean;
  annual_coeff: number;
  items: BulletinSubjectGroupItem[];
};

// ✅ Sous-matières renvoyées au front
type BulletinSubjectComponent = {
  id: string;
  subject_id: string; // subjects.id parent
  label: string;
  short_label: string | null;
  coeff_in_subject: number;
  order_index: number;
};

// Nettoyage des nombres et arrondi à 2 décimales
function cleanNumber(x: any): number | null {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function cleanCoeff(c: any): number {
  const n = Number(c);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Number(n.toFixed(2));
}

function isUuid(v: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v
  );
}

/* ───────── helper : récup user_roles + institution ───────── */
async function getAdminAndInstitution(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>
) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "UNAUTHENTICATED" as const };
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { error: "PROFILE_NOT_FOUND" as const };
  }

  const role = roleRow.role as Role;
  if (!["super_admin", "admin"].includes(role)) {
    return { error: "FORBIDDEN" as const };
  }

  const institutionId = roleRow.institution_id;
  if (!institutionId) {
    return { error: "NO_INSTITUTION" as const };
  }

  return { user, institutionId, role };
}

/* ───────── helper : rang par matière (subject_rank) ───────── */
/**
 * Ajoute ps.subject_rank dans items[*].per_subject[*]
 * Rang 1 = meilleure moyenne, ex-aequo gérés (même moyenne → même rang).
 */
function applySubjectRanks(items: any[]) {
  if (!items || !items.length) return;

  type Entry = { index: number; avg: number; subject_id: string };

  const bySubject = new Map<string, Entry[]>();

  items.forEach((item, idx) => {
    const perSubject = item.per_subject as any[] | undefined;
    if (!Array.isArray(perSubject)) return;

    perSubject.forEach((ps) => {
      const avg =
        typeof ps.avg20 === "number" && Number.isFinite(ps.avg20)
          ? ps.avg20
          : null;
      const sid = ps.subject_id as string | undefined;
      if (!sid || avg === null) return;

      const arr = bySubject.get(sid) || [];
      arr.push({ index: idx, avg, subject_id: sid });
      bySubject.set(sid, arr);
    });
  });

  bySubject.forEach((entries, subjectId) => {
    // tri décroissant : meilleure moyenne → rang 1
    entries.sort((a, b) => b.avg - a.avg);

    let lastAvg: number | null = null;
    let currentRank = 0;
    let position = 0;

    for (const { index, avg } of entries) {
      position += 1;
      if (lastAvg === null || avg !== lastAvg) {
        currentRank = position;
        lastAvg = avg;
      }

      const perSubject = items[index].per_subject as any[];
      if (!Array.isArray(perSubject)) continue;

      const cell = perSubject.find(
        (ps: any) => ps.subject_id === subjectId
      );
      if (cell) {
        (cell as any).subject_rank = currentRank;
      }
    }
  });
}

/* ───────── helper : nom du professeur par matière (teacher_name) ───────── */
/**
 * Utilise:
 * - class_teachers : id, class_id, subject_id, teacher_id, start_date, end_date, institution_id
 * - teacher_subjects : profile_id, subject_id, institution_id, teacher_name, subject_name, updated_at
 *
 * Remplit per_subject[*].teacher_name pour la classe + période.
 */
async function attachTeachersToSubjects(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  items: any[],
  subjectIds: string[],
  institutionId: string,
  classId: string,
  dateFrom?: string | null,
  dateTo?: string | null
) {
  if (!subjectIds.length || !items.length) return;

  // 1) Récupérer les lignes class_teachers pour cette classe / ces matières
  let ctQuery = supabase
    .from("class_teachers")
    .select("subject_id, teacher_id, start_date, end_date")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .in("subject_id", subjectIds);

  const pivot = dateTo || dateFrom || null;
  if (pivot) {
    // end_date >= pivot OU end_date IS NULL
    ctQuery = ctQuery.or(`end_date.is.null,end_date.gte.${pivot}`);
  } else {
    // par défaut : prof encore affecté (end_date IS NULL)
    ctQuery = ctQuery.is("end_date", null);
  }

  const { data: ctData, error: ctErr } = await ctQuery;

  if (ctErr) {
    console.error("[bulletin] class_teachers error", ctErr);
    return;
  }
  if (!ctData || !ctData.length) return;

  const teacherIds = Array.from(
    new Set(
      (ctData as any[])
        .map((row) => row.teacher_id as string | null)
        .filter((v): v is string => !!v)
    )
  );
  if (!teacherIds.length) return;

  // 2) Noms de profs spécifiques par (subject_id, profile_id) dans teacher_subjects
  const { data: tsData, error: tsErr } = await supabase
    .from("teacher_subjects")
    .select("profile_id, subject_id, teacher_name")
    .eq("institution_id", institutionId)
    .in("subject_id", subjectIds)
    .in("profile_id", teacherIds);

  if (tsErr) {
    console.error("[bulletin] teacher_subjects error", tsErr);
  }

  const teacherNameBySubjectTeacher = new Map<string, string>();
  (tsData || []).forEach((row: any) => {
    const key = `${row.subject_id}::${row.profile_id}`;
    if (row.teacher_name) {
      teacherNameBySubjectTeacher.set(key, String(row.teacher_name));
    }
  });

  // 3) Fallback : display_name dans profiles
  const { data: profs, error: profErr } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", teacherIds);

  if (profErr) {
    console.error("[bulletin] profiles (teachers) error", profErr);
  }

  const displayById = new Map<string, string>();
  (profs || []).forEach((p: any) => {
    if (p.id && p.display_name) {
      displayById.set(p.id, String(p.display_name));
    }
  });

  // 4) Map final subject_id → teacher_name (pour CETTE classe)
  const teacherBySubject = new Map<string, string>();

  (ctData as any[]).forEach((row) => {
    const subjectId = String(row.subject_id);
    const teacherId = row.teacher_id as string | null;
    if (!subjectId || !teacherId) return;

    if (teacherBySubject.has(subjectId)) return; // déjà trouvé pour cette matière

    const key = `${subjectId}::${teacherId}`;
    const name =
      teacherNameBySubjectTeacher.get(key) || displayById.get(teacherId);

    if (!name) return;

    teacherBySubject.set(subjectId, name);
  });

  if (!teacherBySubject.size) return;

  // 5) Injection dans items[*].per_subject[*].teacher_name
  for (const item of items) {
    const perSubject = item.per_subject as any[] | undefined;
    if (!Array.isArray(perSubject)) continue;

    perSubject.forEach((ps) => {
      const name = teacherBySubject.get(ps.subject_id) ?? null;
      (ps as any).teacher_name = name;
    });
  }
}

/* ───────── GET /api/admin/grades/bulletin ─────────
   Params:
   - class_id (obligatoire)
   - from (YYYY-MM-DD, optionnel)
   - to   (YYYY-MM-DD, optionnel)
─────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient(); // service-role pour certaines tables
  const ctx = await getAdminAndInstitution(supabase);

  if ("error" in ctx) {
    const status =
      ctx.error === "UNAUTHENTICATED"
        ? 401
        : ctx.error === "FORBIDDEN"
        ? 403
        : 400;
    return NextResponse.json({ ok: false, error: ctx.error }, { status });
  }

  const { institutionId } = ctx;

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("class_id");
  const dateFrom = searchParams.get("from");
  const dateTo = searchParams.get("to");

  if (!classId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_CLASS_ID" },
      { status: 400 }
    );
  }

  /* 1) Vérifier que la classe appartient à l'établissement + récupérer prof principal */
  const { data: cls, error: clsErr } = await supabase
    .from("classes")
    .select(
      "id, label, code, institution_id, academic_year, head_teacher_id, level"
    )
    .eq("id", classId)
    .maybeSingle();

  if (clsErr) {
    console.error("[bulletin] classes error", clsErr);
    return NextResponse.json(
      { ok: false, error: "CLASS_ERROR" },
      { status: 500 }
    );
  }
  if (!cls) {
    return NextResponse.json(
      { ok: false, error: "CLASS_NOT_FOUND" },
      { status: 404 }
    );
  }

  const classRow = cls as ClassRow;

  if (classRow.institution_id && classRow.institution_id !== institutionId) {
    return NextResponse.json(
      { ok: false, error: "CLASS_FORBIDDEN" },
      { status: 403 }
    );
  }

  // 1a) Lookup du professeur principal (facultatif)
  let headTeacher: HeadTeacherRow | null = null;
  if (classRow.head_teacher_id) {
    const { data: ht, error: htErr } = await supabase
      .from("profiles")
      .select("id, display_name, phone, email")
      .eq("id", classRow.head_teacher_id)
      .maybeSingle();

    if (htErr) {
      console.error("[bulletin] head_teacher lookup error", htErr);
    } else if (ht) {
      headTeacher = ht as HeadTeacherRow;
    }
  }

  /* 1bis) Retrouver éventuellement la période de bulletin (grade_periods) + son coeff */
  let periodMeta: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
  } = { from: dateFrom, to: dateTo };

  if (dateFrom && dateTo) {
    const { data: gp, error: gpErr } = await supabase
      .from("grade_periods")
      .select(
        "id, academic_year, code, label, short_label, start_date, end_date, coeff"
      )
      .eq("institution_id", institutionId)
      .eq("start_date", dateFrom)
      .eq("end_date", dateTo)
      .maybeSingle();

    if (gpErr) {
      console.error("[bulletin] grade_periods lookup error", gpErr);
    } else if (gp) {
      periodMeta = {
        from: dateFrom,
        to: dateTo,
        code: gp.code ?? null,
        label: gp.label ?? null,
        short_label: gp.short_label ?? null,
        academic_year: gp.academic_year ?? null,
        coeff:
          gp.coeff === null || gp.coeff === undefined
            ? null
            : cleanCoeff(gp.coeff),
      };
    }
  }

  /* 2) Récupérer les élèves de la classe (photo historique si période) */
  const hasDateFilter = !!dateFrom || !!dateTo;

  let enrollQuery = supabase
    .from("class_enrollments")
    .select(
      `
      student_id,
      students(
        matricule,
        first_name,
        last_name,
        full_name,
        gender,
        birthdate,
        birth_place,
        nationality,
        regime,
        is_repeater,
        is_boarder,
        is_affecte
      )
    `
    )
    .eq("class_id", classId);

  if (!hasDateFilter) {
    // 🔁 Comportement historique : uniquement les élèves encore inscrits
    enrollQuery = enrollQuery.is("end_date", null);
  } else if (dateFrom) {
    // 🕒 Photo historique : élèves dont la fin d'inscription
    // est postérieure au début de la période OU encore inscrits
    enrollQuery = enrollQuery.or(`end_date.gte.${dateFrom},end_date.is.null`);
  }
  // Si seulement "to" est renseigné, on garde le filtrage par défaut (élèves actifs)

  enrollQuery = enrollQuery.order("student_id", { ascending: true });

  const { data: csData, error: csErr } = await enrollQuery;

  if (csErr) {
    console.error("[bulletin] class_enrollments error", csErr);
    return NextResponse.json(
      { ok: false, error: "CLASS_STUDENTS_ERROR" },
      { status: 500 }
    );
  }

  const classStudents = (csData || []) as ClassStudentRow[];

  if (!classStudents.length) {
    return NextResponse.json({
      ok: true,
      class: {
        id: classRow.id,
        label: classRow.label || classRow.code || "Classe",
        code: classRow.code || null,
        academic_year: classRow.academic_year || null,
        head_teacher: headTeacher
          ? {
              id: headTeacher.id,
              display_name: headTeacher.display_name || null,
              phone: headTeacher.phone || null,
              email: headTeacher.email || null,
            }
          : null,
      },
      period: periodMeta,
      subjects: [],
      subject_groups: [],
      subject_components: [], // ✅ pour que le front ait toujours la clé
      items: [],
    });
  }

  const studentIds = classStudents.map((cs) => cs.student_id);

  /* 3) Récupérer les évaluations de la période pour cette classe */
  let evalQuery = supabase
    .from("grade_evaluations")
    .select(
      "id, class_id, subject_id, eval_date, scale, coeff, is_published, subject_component_id"
    )
    .eq("class_id", classId)
    .eq("is_published", true);

  if (dateFrom) {
    evalQuery = evalQuery.gte("eval_date", dateFrom);
  }
  if (dateTo) {
    evalQuery = evalQuery.lte("eval_date", dateTo);
  }

  const { data: evalData, error: evalErr } = await evalQuery;

  if (evalErr) {
    console.error("[bulletin] evaluations error", evalErr);
    return NextResponse.json(
      { ok: false, error: "EVALUATIONS_ERROR" },
      { status: 500 }
    );
  }

  const evals = (evalData || []) as EvalRow[];
  if (!evals.length) {
    return NextResponse.json({
      ok: true,
      class: {
        id: classRow.id,
        label: classRow.label || classRow.code || "Classe",
        code: classRow.code || null,
        academic_year: classRow.academic_year || null,
        head_teacher: headTeacher
          ? {
              id: headTeacher.id,
              display_name: headTeacher.display_name || null,
              phone: headTeacher.phone || null,
              email: headTeacher.email || null,
            }
          : null,
      },
      period: periodMeta,
      subjects: [],
      subject_groups: [],
      subject_components: [],
      items: classStudents.map((cs) => {
        const stu = cs.students || {};
        const fullName =
          stu.full_name ||
          [stu.last_name, stu.first_name].filter(Boolean).join(" ") ||
          "Élève";
        return {
          student_id: cs.student_id,
          full_name: fullName,
          matricule: stu.matricule || null,
          gender: stu.gender || null,
          birth_date: stu.birthdate || null,
          birth_place: stu.birth_place || null,
          nationality: stu.nationality || null,
          regime: stu.regime || null,
          is_repeater: stu.is_repeater ?? null,
          is_boarder: stu.is_boarder ?? null,
          is_affecte: stu.is_affecte ?? null,
          per_subject: [],
          per_group: [],
          general_avg: null,
          per_subject_components: [],
        };
      }),
    });
  }

  const evalIds = evals.map((e) => e.id);

  /* 4) Récupérer les notes (depuis student_grades) */
  const { data: scoreData, error: scoreErr } = await supabase
    .from("student_grades")
    .select("evaluation_id, student_id, score")
    .in("evaluation_id", evalIds)
    .in("student_id", studentIds);

  if (scoreErr) {
    console.error("[bulletin] scores error", scoreErr);
    return NextResponse.json(
      { ok: false, error: "SCORES_ERROR" },
      { status: 500 }
    );
  }

  const scores = (scoreData || []) as ScoreRow[];

  /* 5) Matières concernées (à partir des évaluations) */
  const subjectIdSet = new Set<string>();
  for (const e of evals) {
    if (e.subject_id) subjectIdSet.add(String(e.subject_id));
  }
  const subjectIdsRaw = Array.from(subjectIdSet);
  const subjectIds = subjectIdsRaw.filter((sid) => isUuid(sid));

  if (subjectIds.length !== subjectIdsRaw.length) {
    console.warn(
      "[bulletin] some subject_ids are invalid and have been ignored",
      {
        subjectIdsRaw,
        subjectIds,
      }
    );
  }

  if (!subjectIds.length) {
    return NextResponse.json({
      ok: true,
      class: {
        id: classRow.id,
        label: classRow.label || classRow.code || "Classe",
        code: classRow.code || null,
        academic_year: classRow.academic_year || null,
        head_teacher: headTeacher
          ? {
              id: headTeacher.id,
              display_name: headTeacher.display_name || null,
              phone: headTeacher.phone || null,
              email: headTeacher.email || null,
            }
          : null,
      },
      period: periodMeta,
      subjects: [],
      subject_groups: [],
      subject_components: [],
      items: classStudents.map((cs) => {
        const stu = cs.students || {};
        const fullName =
          stu.full_name ||
          [stu.last_name, stu.first_name].filter(Boolean).join(" ") ||
          "Élève";
        return {
          student_id: cs.student_id,
          full_name: fullName,
          matricule: stu.matricule || null,
          gender: stu.gender || null,
          birth_date: stu.birthdate || null,
          birth_place: stu.birth_place || null,
          nationality: stu.nationality || null,
          regime: stu.regime || null,
          is_repeater: stu.is_repeater ?? null,
          is_boarder: stu.is_boarder ?? null,
          is_affecte: stu.is_affecte ?? null,
          per_subject: [],
          per_group: [],
          general_avg: null,
          per_subject_components: [],
        };
      }),
    });
  }

  // Noms des matières (via service client pour éviter les soucis RLS)
  const { data: subjData, error: subjErr } = await srv
    .from("subjects")
    .select("id, name, code")
    .in("id", subjectIds);

  if (subjErr) {
    console.error("[bulletin] subjects error", subjErr);
    return NextResponse.json(
      { ok: false, error: "SUBJECTS_ERROR" },
      { status: 500 }
    );
  }

  const subjects = (subjData || []) as SubjectRow[];
  const subjectById = new Map<string, SubjectRow>();
  for (const s of subjects) subjectById.set(s.id, s);

  /* 6) Coefficients bulletin par matière pour cet établissement + niveau */
  let coeffQuery = supabase
    .from("institution_subject_coeffs")
    .select("subject_id, coeff, include_in_average, level")
    .eq("institution_id", institutionId)
    .in("subject_id", subjectIds);

  if (classRow.level) {
    coeffQuery = coeffQuery.eq("level", classRow.level);
  }

  const { data: coeffData, error: coeffErr } = await coeffQuery;

  if (coeffErr) {
    console.error("[bulletin] coeffs error", coeffErr);
    return NextResponse.json(
      { ok: false, error: "COEFFS_ERROR" },
      { status: 500 }
    );
  }

  const coeffBySubject = new Map<string, { coeff: number; include: boolean }>();
  for (const row of (coeffData || []) as SubjectCoeffRow[]) {
    const sid = row.subject_id;
    const coeff = cleanCoeff(row.coeff);
    const include = row.include_in_average !== false; // par défaut on inclut
    coeffBySubject.set(sid, { coeff, include });
  }

  // Liste des matières pour le bulletin
  const subjectsForReport = subjectIds.map((sid) => {
    const s = subjectById.get(sid);
    const name = s?.name || s?.code || "Matière";
    const info = coeffBySubject.get(sid);
    const coeffBulletin = info ? info.coeff : 1;
    const includeInAverage = info ? info.include : true;

    return {
      subject_id: sid,
      subject_name: name,
      coeff_bulletin: coeffBulletin,
      include_in_average: includeInAverage,
    };
  });

  /* 6bis) Sous-matières */
  let subjectComponentsForReport: BulletinSubjectComponent[] = [];
  const subjectComponentById = new Map<string, BulletinSubjectComponent>();

  const { data: compData, error: compErr } = await srv
    .from("grade_subject_components")
    .select(
      "id, subject_id, label, short_label, coeff_in_subject, order_index, is_active"
    )
    .eq("institution_id", institutionId)
    .in("subject_id", subjectIds);

  if (compErr) {
    console.error("[bulletin] subject_components error", compErr);
  } else {
    const rows = (compData || [])
      .filter((r: any) => r.is_active !== false)
      .map((r: any) => {
        const coeff =
          r.coeff_in_subject !== null && r.coeff_in_subject !== undefined
            ? Number(r.coeff_in_subject)
            : 1;
        const ord =
          r.order_index !== null && r.order_index !== undefined
            ? Number(r.order_index)
            : 1;
        const obj: BulletinSubjectComponent = {
          id: String(r.id),
          subject_id: String(r.subject_id),
          label: (r.label as string) || "Sous-matière",
          short_label: r.short_label ? String(r.short_label) : null,
          coeff_in_subject: cleanCoeff(coeff),
          order_index: ord,
        };
        return obj;
      }) as BulletinSubjectComponent[];

    rows.sort((a, b) => {
      if (a.subject_id !== b.subject_id) {
        return a.subject_id.localeCompare(b.subject_id);
      }
      return a.order_index - b.order_index;
    });

    subjectComponentsForReport = rows;
    rows.forEach((c) => subjectComponentById.set(c.id, c));
  }

  /* 6ter) Groupes de disciplines pour ce niveau (si configurés) */
  let subjectGroups: BulletinSubjectGroup[] = [];
  const groupedSubjectIds = new Set<string>();

  if (classRow.level) {
    const { data: groupsData, error: groupsErr } = await supabase
      .from("bulletin_subject_groups")
      .select(
        "id, level, code, label, short_label, order_index, is_active, annual_coeff"
      )
      .eq("institution_id", institutionId)
      .eq("level", classRow.level)
      .order("order_index", { ascending: true });

    if (groupsErr) {
      console.error("[bulletin] groups error", groupsErr);
    } else if (groupsData && groupsData.length) {
      const activeGroups = (groupsData as any[]).filter(
        (g) => g.is_active !== false
      );
      if (activeGroups.length) {
        const groupIds = activeGroups.map((g) => String(g.id));

        const { data: itemsData, error: itemsErr } = await supabase
          .from("bulletin_subject_group_items")
          .select(
            `
            id,
            group_id,
            institution_subject_id,
            order_index,
            subject_coeff_override,
            is_optional,
            institution_subjects (
              id,
              level,
              subject_id,
              label,
              short_label,
              subjects (
                id,
                name,
                code
              )
            )
          `
          )
          .in("group_id", groupIds);

        if (itemsErr) {
          console.error("[bulletin] group_items error", itemsErr);
        } else {
          const itemsByGroup = new Map<string, any[]>();
          for (const row of (itemsData || []) as any[]) {
            const gId = String(row.group_id);
            const arr = itemsByGroup.get(gId) || [];
            arr.push(row);
            itemsByGroup.set(gId, arr);
          }

          subjectGroups = activeGroups.map((g: any) => {
            const rows = itemsByGroup.get(String(g.id)) || [];
            const items: BulletinSubjectGroupItem[] = rows
              .map((row: any) => {
                const instSub = row.institution_subjects || {};
                const subj = instSub.subjects || {};
                const subjectId: string | null =
                  (subj && subj.id) || instSub.subject_id || null;

                if (!subjectId) {
                  return null;
                }

                const subjectName =
                  instSub.label ||
                  instSub.short_label ||
                  subj.name ||
                  subj.code ||
                  "Matière";

                const item: BulletinSubjectGroupItem = {
                  id: String(row.id),
                  group_id: String(row.group_id),
                  institution_subject_id: String(row.institution_subject_id),
                  subject_id: String(subjectId),
                  subject_name: String(subjectName),
                  level: instSub.level ?? null,
                  order_index: Number(row.order_index ?? 1),
                  subject_coeff_override:
                    row.subject_coeff_override !== null &&
                    row.subject_coeff_override !== undefined
                      ? Number(row.subject_coeff_override)
                      : null,
                  is_optional: row.is_optional === true,
                };

                if (subjectIdSet.has(item.subject_id)) {
                  groupedSubjectIds.add(item.subject_id);
                }

                return item;
              })
              .filter(
                (
                  it: BulletinSubjectGroupItem | null
                ): it is BulletinSubjectGroupItem => !!it
              )
              .sort((a, b) => a.order_index - b.order_index);

            const annualCoeff =
              g.annual_coeff !== null && g.annual_coeff !== undefined
                ? Number(g.annual_coeff)
                : 1;

            return {
              id: String(g.id),
              code: String(g.code),
              label: String(g.label),
              short_label: g.short_label ? String(g.short_label) : null,
              order_index: Number(g.order_index ?? 1),
              is_active: g.is_active !== false,
              annual_coeff: cleanCoeff(annualCoeff),
              items,
            };
          });
        }
      }
    }
  }

  const hasGroupConfig = subjectGroups.length > 0;
  const useGroupsForAverage = groupedSubjectIds.size > 0;

  /* 7) Préparer des maps pour le calcul (par matière + par sous-matière) */
  const evalById = new Map<string, EvalRow>();
  for (const e of evals) {
    evalById.set(e.id, e);
  }

  const perStudentSubject = new Map<
    string,
    Map<string, { sumWeighted: number; sumCoeff: number }>
  >();

  // agrégats par sous-matière
  const perStudentSubjectComponent = new Map<
    string,
    Map<
      string,
      {
        subject_id: string;
        sumWeighted: number;
        sumCoeff: number;
      }
    >
  >();

  for (const sc of scores) {
    const ev = evalById.get(sc.evaluation_id);
    if (!ev) continue;
    if (!ev.subject_id) continue;
    if (!ev.scale || ev.scale <= 0) continue;

    if (sc.score === null || sc.score === undefined) continue;

    const score = Number(sc.score);
    if (!Number.isFinite(score)) continue;

    const norm20 = (score / ev.scale) * 20;
    const weight = ev.coeff ?? 1;

    // 7a) par matière
    let stuMap = perStudentSubject.get(sc.student_id);
    if (!stuMap) {
      stuMap = new Map();
      perStudentSubject.set(sc.student_id, stuMap);
    }
    const key = ev.subject_id;
    const cell = stuMap.get(key) || { sumWeighted: 0, sumCoeff: 0 };
    cell.sumWeighted += norm20 * weight;
    cell.sumCoeff += weight;
    stuMap.set(key, cell);

    // 7b) par sous-matière
    if (ev.subject_component_id) {
      const comp = subjectComponentById.get(ev.subject_component_id);
      if (comp) {
        let stuCompMap = perStudentSubjectComponent.get(sc.student_id);
        if (!stuCompMap) {
          stuCompMap = new Map();
          perStudentSubjectComponent.set(sc.student_id, stuCompMap);
        }
        const compCell =
          stuCompMap.get(comp.id) || {
            subject_id: comp.subject_id,
            sumWeighted: 0,
            sumCoeff: 0,
          };
        compCell.sumWeighted += norm20 * weight;
        compCell.sumCoeff += weight;
        stuCompMap.set(comp.id, compCell);
      }
    }
  }

  /* 8) Construire la réponse : par élève */
  const items = classStudents.map((cs) => {
    const stu = cs.students || {};
    const fullName =
      stu.full_name ||
      [stu.last_name, stu.first_name].filter(Boolean).join(" ") ||
      "Élève";

    const stuMap =
      perStudentSubject.get(cs.student_id) ||
      new Map<string, { sumWeighted: number; sumCoeff: number }>();

    const stuCompMap =
      perStudentSubjectComponent.get(cs.student_id) ||
      new Map<
        string,
        {
          subject_id: string;
          sumWeighted: number;
          sumCoeff: number;
        }
      >();

    // Moyenne par matière
    const per_subject = subjectsForReport.map((s) => {
      const cell = stuMap.get(s.subject_id);
      let avg20: number | null = null;
      if (cell && cell.sumCoeff > 0) {
        avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff);
      }
      return {
        subject_id: s.subject_id,
        avg20,
      };
    });

    // Moyenne par sous-matière
    const per_subject_components =
      subjectComponentsForReport.length === 0
        ? []
        : subjectComponentsForReport.map((comp) => {
            const cell = stuCompMap.get(comp.id);
            let avg20: number | null = null;
            if (cell && cell.sumCoeff > 0) {
              avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff);
            }
            return {
              subject_id: comp.subject_id,
              component_id: comp.id,
              avg20,
            };
          });

    // Moyenne par groupe
    let per_group:
      | {
          group_id: string;
          group_avg: number | null;
        }[]
      | [] = [];

    if (hasGroupConfig) {
      per_group = subjectGroups.map((g) => {
        let sum = 0;
        let sumCoeffLocal = 0;

        for (const it of g.items) {
          const cell = stuMap.get(it.subject_id);
          if (!cell || cell.sumCoeff <= 0) continue;

          const subAvgRaw = cell.sumWeighted / cell.sumCoeff;
          if (!Number.isFinite(subAvgRaw)) continue;

          const subAvg = subAvgRaw;
          const w =
            it.subject_coeff_override !== null &&
            it.subject_coeff_override !== undefined
              ? Number(it.subject_coeff_override)
              : 1;
          if (w <= 0) continue;

          sum += subAvg * w;
          sumCoeffLocal += w;
        }

        const groupAvg =
          sumCoeffLocal > 0 ? cleanNumber(sum / sumCoeffLocal) : null;

        return {
          group_id: g.id,
          group_avg: groupAvg,
        };
      });
    }

    // Moyenne générale
    let general_avg: number | null = null;

    if (useGroupsForAverage) {
      let sumGen = 0;
      let sumCoeffGen = 0;

      // 1) Groupes
      for (const g of subjectGroups) {
        const coeffGroup = g.annual_coeff ?? 0;
        if (!coeffGroup || coeffGroup <= 0) continue;

        const pg = per_group.find((x) => x.group_id === g.id);
        const groupAvg = pg?.group_avg ?? null;
        if (groupAvg === null || groupAvg === undefined) continue;

        sumGen += groupAvg * coeffGroup;
        sumCoeffGen += coeffGroup;
      }

      // 2) Matières non groupées
      for (const s of subjectsForReport) {
        if (groupedSubjectIds.has(s.subject_id)) continue;
        if (s.include_in_average === false) continue;

        const coeffSub = s.coeff_bulletin ?? 0;
        if (!coeffSub || coeffSub <= 0) continue;

        const cell = stuMap.get(s.subject_id);
        if (!cell || cell.sumCoeff <= 0) continue;

        const subAvgRaw = cell.sumWeighted / cell.sumCoeff;
        if (!Number.isFinite(subAvgRaw)) continue;
        const subAvg = subAvgRaw;

        sumGen += subAvg * coeffSub;
        sumCoeffGen += coeffSub;
      }

      general_avg = sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen) : null;
    } else {
      let sumGen = 0;
      let sumCoeffGen = 0;

      for (const s of subjectsForReport) {
        if (s.include_in_average === false) continue;
        const coeffSub = s.coeff_bulletin ?? 0;
        if (!coeffSub || coeffSub <= 0) continue;

        const cell = stuMap.get(s.subject_id);
        if (!cell || cell.sumCoeff <= 0) continue;

        const subAvgRaw = cell.sumWeighted / cell.sumCoeff;
        if (!Number.isFinite(subAvgRaw)) continue;
        const subAvg = subAvgRaw;

        sumGen += subAvg * coeffSub;
        sumCoeffGen += coeffSub;
      }

      general_avg = sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen) : null;
    }

    return {
      student_id: cs.student_id,
      full_name: fullName,
      matricule: stu.matricule || null,
      gender: stu.gender || null,
      birth_date: stu.birthdate || null, // 🔁 API renvoie toujours birth_date, mappée sur students.birthdate
      birth_place: stu.birth_place || null,
      nationality: stu.nationality || null,
      regime: stu.regime || null,
      is_repeater: stu.is_repeater ?? null,
      is_boarder: stu.is_boarder ?? null,
      is_affecte: stu.is_affecte ?? null,
      per_subject,
      per_group,
      general_avg,
      per_subject_components,
    };
  });

  // 9) Rang par matière
  applySubjectRanks(items);

  // 10) Nom du professeur par matière pour CETTE classe + période
  await attachTeachersToSubjects(
    supabase,
    items,
    subjectIds,
    institutionId,
    classRow.id,
    dateFrom,
    dateTo
  );

  return NextResponse.json({
    ok: true,
    class: {
      id: classRow.id,
      label: classRow.label || classRow.code || "Classe",
      code: classRow.code || null,
      academic_year: classRow.academic_year || null,
      head_teacher: headTeacher
        ? {
            id: headTeacher.id,
            display_name: headTeacher.display_name || null,
            phone: headTeacher.phone || null,
            email: headTeacher.email || null,
          }
        : null,
    },
    period: periodMeta,
    subjects: subjectsForReport,
    subject_groups: subjectGroups,
    subject_components: subjectComponentsForReport,
    items,
  });
}

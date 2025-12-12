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
  teacher_id: string | null; // ✅ prof qui a créé l'évaluation
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
  students?:
    | {
        full_name?: string | null;
        last_name?: string | null;
        first_name?: string | null;
        matricule?: string | null;

        gender?: string | null;
        birthdate?: string | null;
        birth_place?: string | null;
        nationality?: string | null;
        regime?: string | null;
        is_repeater?: boolean | null;
        is_boarder?: boolean | null;
        is_affecte?: boolean | null;
      }
    | null;
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
  subject_id: string;
  subject_name: string;
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

/* ───────── helpers nombres ───────── */

// ✅ IMPORTANT: on garde plus de précision (4 décimales) pour éviter
// les écarts Total vs somme/pondération (ex: Français = sous-matières).
function cleanNumber(x: any, precision: number = 2): number | null {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(precision));
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

// ✅ Normalisation du niveau "bulletin"
function normalizeBulletinLevel(level?: string | null): string | null {
  if (!level) return null;
  const x = String(level).trim().toLowerCase();

  if (["6e", "5e", "4e", "3e", "seconde", "première", "terminale"].includes(x)) {
    return x;
  }
  if (x === "premiere") return "première";

  if (x.startsWith("2de") || x.startsWith("2nde") || x.startsWith("2")) return "seconde";
  if (x.startsWith("1re") || x.startsWith("1ere") || x.startsWith("1")) return "première";
  if (x.startsWith("t")) return "terminale";

  return null;
}

/* ───────── classification bilans (API) ───────── */

function normText(s?: string | null) {
  return (s ?? "").toString().trim().toLowerCase();
}

// ⚠️ EPS / EDHC / Musique / Arts / Conduite / Vie scolaire => AUTRES
function isOtherSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);

  return (
    /(^|\b)(eps|e\.p\.s|sport)(\b|$)/.test(c) ||
    /(^|\b)(eps|e\.p\.s|sport)(\b|$)/.test(n) ||
    /(education\s*physique|éducation\s*physique|sportive|eps)/.test(n) ||
    /(edhc|civique|citoyenn|vie\s*scolaire|conduite)/.test(n) ||
    /(musique|chant|arts?\s*plastiques|dessin|th[eé]atre)/.test(n) ||
    /(tic|tice|informatique\s*(de\s*base)?)/.test(n) ||
    /(entrepreneuriat|travail\s*manuel|tm|bonus)/.test(n)
  );
}

// ✅ PHILO => LETTRES
function isPhiloSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);
  return /(philo|philosoph)/.test(n) || /(philo|philosoph)/.test(c);
}

// ✅ Sciences
function isScienceSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);

  // ⚠️ ne PAS classer EPS/EDHC/Musique en sciences
  if (isOtherSubject(name, code)) return false;

  return (
    /(math|math[ée]m|phys|chim|svt|bio|science|info|algo|stat|techno)/.test(c) ||
    /(math|math[ée]m|phys|chim|svt|bio|science|informat|algo|stat|technolog)/.test(n)
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
function applySubjectRanks(items: any[]) {
  if (!items || !items.length) return;

  type Entry = { index: number; avg: number; subject_id: string };
  const bySubject = new Map<string, Entry[]>();

  items.forEach((item, idx) => {
    const perSubject = item.per_subject as any[] | undefined;
    if (!Array.isArray(perSubject)) return;

    perSubject.forEach((ps) => {
      const avg =
        typeof ps.avg20 === "number" && Number.isFinite(ps.avg20) ? ps.avg20 : null;
      const sid = ps.subject_id as string | undefined;
      if (!sid || avg === null) return;

      const arr = bySubject.get(sid) || [];
      arr.push({ index: idx, avg, subject_id: sid });
      bySubject.set(sid, arr);
    });
  });

  bySubject.forEach((entries, subjectId) => {
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

      const cell = perSubject.find((ps: any) => ps.subject_id === subjectId);
      if (cell) (cell as any).subject_rank = currentRank;
    }
  });
}

/* ───────── helper : rang par sous-matière (component_rank) ───────── */
function applySubjectComponentRanks(items: any[]) {
  if (!items || !items.length) return;

  type Entry = { index: number; avg: number; component_id: string };
  const byComponent = new Map<string, Entry[]>();

  items.forEach((item, idx) => {
    const perComp = item.per_subject_components as any[] | undefined;
    if (!Array.isArray(perComp)) return;

    perComp.forEach((psc) => {
      const avg =
        typeof psc.avg20 === "number" && Number.isFinite(psc.avg20) ? psc.avg20 : null;
      const cid = psc.component_id as string | undefined;
      if (!cid || avg === null) return;

      const arr = byComponent.get(cid) || [];
      arr.push({ index: idx, avg, component_id: cid });
      byComponent.set(cid, arr);
    });
  });

  byComponent.forEach((entries, componentId) => {
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

      const perComp = items[index].per_subject_components as any[] | undefined;
      if (!Array.isArray(perComp)) continue;

      const cell = perComp.find((psc: any) => psc.component_id === componentId);
      if (cell) (cell as any).component_rank = currentRank;
    }
  });
}

/* ───────── helper : nom du professeur par matière (teacher_name) ───────── */
async function attachTeachersToSubjects(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  srv: Awaited<ReturnType<typeof getSupabaseServiceClient>>,
  items: any[],
  evals: EvalRow[],
  subjectIds: string[],
  institutionId: string,
  classId: string,
  dateFrom?: string | null,
  dateTo?: string | null
) {
  if (!items.length || !subjectIds.length) return;

  const teacherBySubject = new Map<string, string>();

  /* ── A. À partir de grade_evaluations.teacher_id ─────────────────────── */
  if (evals.length) {
    type ST = { teacher_id: string; lastEvalDate: string };
    const bySubjectEval = new Map<string, ST>();

    for (const ev of evals) {
      if (!ev.subject_id || !ev.teacher_id) continue;
      const sid = String(ev.subject_id);
      const tid = String(ev.teacher_id);
      const date = ev.eval_date ?? "";

      const existing = bySubjectEval.get(sid);
      if (existing) {
        if (date && date > existing.lastEvalDate) {
          bySubjectEval.set(sid, { teacher_id: tid, lastEvalDate: date });
        }
      } else {
        bySubjectEval.set(sid, { teacher_id: tid, lastEvalDate: date });
      }
    }

    const teacherIdsEval = Array.from(
      new Set(Array.from(bySubjectEval.values()).map((v) => v.teacher_id))
    );

    if (teacherIdsEval.length) {
      const { data: profsEval, error: profErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", teacherIdsEval);

      if (profErr) {
        console.error("[bulletin] teacher profiles (evals) error", profErr);
      } else {
        const nameByIdEval = new Map<string, string>();
        (profsEval || []).forEach((p: any) => {
          if (p.id && p.display_name) nameByIdEval.set(String(p.id), String(p.display_name));
        });

        bySubjectEval.forEach((info, sid) => {
          const name = nameByIdEval.get(info.teacher_id);
          if (name) teacherBySubject.set(sid, name);
        });
      }
    }
  }

  /* ── B. Fallback via institution_subjects + class_teachers ───────────── */
  const missingSubjectIds = subjectIds.filter((sid) => !teacherBySubject.has(sid));

  if (missingSubjectIds.length) {
    const { data: instSubs, error: instErr } = await srv
      .from("institution_subjects")
      .select("id, subject_id")
      .eq("institution_id", institutionId)
      .in("subject_id", missingSubjectIds);

    if (instErr) {
      console.error("[bulletin] institution_subjects error", instErr);
    } else {
      const instIds: string[] = [];
      const subjectIdByInstId = new Map<string, string>();

      (instSubs || []).forEach((row: any) => {
        const sid = String(row.subject_id);
        const instId = String(row.id);
        if (!sid || !instId) return;
        instIds.push(instId);
        subjectIdByInstId.set(instId, sid);
      });

      if (instIds.length) {
        let ctQuery = srv
          .from("class_teachers")
          .select("subject_id, teacher_id, start_date, end_date")
          .eq("institution_id", institutionId)
          .eq("class_id", classId)
          .in("subject_id", instIds);

        const pivot = dateTo || dateFrom || null;
        if (pivot) {
          ctQuery = ctQuery.or(`end_date.is.null,end_date.gte.${pivot}`);
        } else {
          ctQuery = ctQuery.is("end_date", null);
        }

        const { data: ctData, error: ctErr } = await ctQuery;

        if (ctErr) {
          console.error("[bulletin] class_teachers error", ctErr);
        } else if (ctData && ctData.length) {
          const teacherIdsCt = Array.from(
            new Set(
              (ctData as any[])
                .map((row) => row.teacher_id as string | null)
                .filter((v): v is string => !!v)
            )
          );

          const nameByIdCt = new Map<string, string>();

          if (teacherIdsCt.length) {
            const { data: profsCt, error: profErrCt } = await supabase
              .from("profiles")
              .select("id, display_name")
              .in("id", teacherIdsCt);

            if (profErrCt) {
              console.error("[bulletin] teacher profiles (class_teachers) error", profErrCt);
            } else {
              (profsCt || []).forEach((p: any) => {
                if (p.id && p.display_name) nameByIdCt.set(String(p.id), String(p.display_name));
              });
            }
          }

          (ctData as any[]).forEach((row) => {
            const instSubId = String(row.subject_id);
            const sid = subjectIdByInstId.get(instSubId);
            const teacherId = row.teacher_id as string | null;
            if (!sid || !teacherId) return;
            if (teacherBySubject.has(sid)) return;
            const name = nameByIdCt.get(teacherId);
            if (!name) return;
            teacherBySubject.set(sid, name);
          });
        }
      }
    }
  }

  if (!teacherBySubject.size) return;

  for (const item of items) {
    const perSubject = item.per_subject as any[] | undefined;
    if (!Array.isArray(perSubject)) continue;

    perSubject.forEach((ps) => {
      const sid = ps.subject_id as string | undefined;
      const name = sid ? teacherBySubject.get(sid) ?? null : null;
      (ps as any).teacher_name = name;
    });
  }
}

/* ───────── GET /api/admin/grades/bulletin ───────── */
export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
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
    return NextResponse.json({ ok: false, error: "MISSING_CLASS_ID" }, { status: 400 });
  }

  /* 1) Vérifier que la classe appartient à l'établissement + récupérer prof principal */
  const { data: cls, error: clsErr } = await supabase
    .from("classes")
    .select("id, label, code, institution_id, academic_year, head_teacher_id, level")
    .eq("id", classId)
    .maybeSingle();

  if (clsErr) {
    console.error("[bulletin] classes error", clsErr);
    return NextResponse.json({ ok: false, error: "CLASS_ERROR" }, { status: 500 });
  }
  if (!cls) {
    return NextResponse.json({ ok: false, error: "CLASS_NOT_FOUND" }, { status: 404 });
  }

  const classRow = cls as ClassRow;

  if (!classRow.institution_id) {
    return NextResponse.json({ ok: false, error: "CLASS_NO_INSTITUTION" }, { status: 400 });
  }
  if (classRow.institution_id !== institutionId) {
    return NextResponse.json({ ok: false, error: "CLASS_FORBIDDEN" }, { status: 403 });
  }

  const bulletinLevel = normalizeBulletinLevel(classRow.level);

  // 1a) Lookup du professeur principal (facultatif)
  let headTeacher: HeadTeacherRow | null = null;
  if (classRow.head_teacher_id) {
    const { data: ht, error: htErr } = await supabase
      .from("profiles")
      .select("id, display_name, phone, email")
      .eq("id", classRow.head_teacher_id)
      .maybeSingle();

    if (htErr) console.error("[bulletin] head_teacher lookup error", htErr);
    else if (ht) headTeacher = ht as HeadTeacherRow;
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
      .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
      .eq("institution_id", institutionId)
      .eq("start_date", dateFrom)
      .eq("end_date", dateTo)
      .maybeSingle();

    if (gpErr) console.error("[bulletin] grade_periods lookup error", gpErr);
    else if (gp) {
      periodMeta = {
        from: dateFrom,
        to: dateTo,
        code: gp.code ?? null,
        label: gp.label ?? null,
        short_label: gp.short_label ?? null,
        academic_year: gp.academic_year ?? null,
        coeff: gp.coeff === null || gp.coeff === undefined ? null : cleanCoeff(gp.coeff),
      };
    }
  }

  /* 2) Récupérer les élèves */
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

  if (!hasDateFilter) enrollQuery = enrollQuery.is("end_date", null);
  else if (dateFrom) enrollQuery = enrollQuery.or(`end_date.gte.${dateFrom},end_date.is.null`);

  enrollQuery = enrollQuery.order("student_id", { ascending: true });

  const { data: csData, error: csErr } = await enrollQuery;

  if (csErr) {
    console.error("[bulletin] class_enrollments error", csErr);
    return NextResponse.json({ ok: false, error: "CLASS_STUDENTS_ERROR" }, { status: 500 });
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
        level: classRow.level || null,
        bulletin_level: bulletinLevel,
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
      items: [],
    });
  }

  const studentIds = classStudents.map((cs) => cs.student_id);

  /* 3) Evaluations publiées */
  let evalQuery = supabase
    .from("grade_evaluations")
    .select(
      "id, class_id, subject_id, teacher_id, eval_date, scale, coeff, is_published, subject_component_id"
    )
    .eq("class_id", classId)
    .eq("is_published", true);

  if (dateFrom) evalQuery = evalQuery.gte("eval_date", dateFrom);
  if (dateTo) evalQuery = evalQuery.lte("eval_date", dateTo);

  const { data: evalData, error: evalErr } = await evalQuery;

  if (evalErr) {
    console.error("[bulletin] evaluations error", evalErr);
    return NextResponse.json({ ok: false, error: "EVALUATIONS_ERROR" }, { status: 500 });
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
        level: classRow.level || null,
        bulletin_level: bulletinLevel,
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
          stu.full_name || [stu.last_name, stu.first_name].filter(Boolean).join(" ") || "Élève";
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

  /* 4) Notes */
  const { data: scoreData, error: scoreErr } = await supabase
    .from("student_grades")
    .select("evaluation_id, student_id, score")
    .in("evaluation_id", evalIds)
    .in("student_id", studentIds);

  if (scoreErr) {
    console.error("[bulletin] scores error", scoreErr);
    return NextResponse.json({ ok: false, error: "SCORES_ERROR" }, { status: 500 });
  }

  const scores = (scoreData || []) as ScoreRow[];

  /* 5) Matières concernées */
  const subjectIdSet = new Set<string>();
  for (const e of evals) if (e.subject_id) subjectIdSet.add(String(e.subject_id));

  const subjectIdsRaw = Array.from(subjectIdSet);
  const subjectIds = subjectIdsRaw.filter((sid) => isUuid(sid));

  if (!subjectIds.length) {
    return NextResponse.json({
      ok: true,
      class: {
        id: classRow.id,
        label: classRow.label || classRow.code || "Classe",
        code: classRow.code || null,
        academic_year: classRow.academic_year || null,
        level: classRow.level || null,
        bulletin_level: bulletinLevel,
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
      items: [],
    });
  }

  /* 5bis) Noms/code matières */
  const { data: subjData, error: subjErr } = await srv
    .from("subjects")
    .select("id, name, code")
    .in("id", subjectIds);

  if (subjErr) {
    console.error("[bulletin] subjects error", subjErr);
    return NextResponse.json({ ok: false, error: "SUBJECTS_ERROR" }, { status: 500 });
  }

  const subjects = (subjData || []) as SubjectRow[];
  const subjectById = new Map<string, SubjectRow>();
  for (const s of subjects) subjectById.set(s.id, s);

  /* 6) Coefficients bulletin par matière */
  let coeffQuery = supabase
    .from("institution_subject_coeffs")
    .select("subject_id, coeff, include_in_average, level")
    .eq("institution_id", institutionId)
    .in("subject_id", subjectIds);

  if (bulletinLevel) coeffQuery = coeffQuery.eq("level", bulletinLevel);

  const { data: coeffData, error: coeffErr } = await coeffQuery;

  if (coeffErr) {
    console.error("[bulletin] coeffs error", coeffErr);
    return NextResponse.json({ ok: false, error: "COEFFS_ERROR" }, { status: 500 });
  }

  const coeffBySubject = new Map<string, { coeff: number; include: boolean }>();
  for (const row of (coeffData || []) as SubjectCoeffRow[]) {
    const sid = row.subject_id;
    const coeff = cleanCoeff(row.coeff);
    const include = row.include_in_average !== false;
    coeffBySubject.set(sid, { coeff, include });
  }

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
  const compsBySubject = new Map<string, BulletinSubjectComponent[]>();

  const { data: compData, error: compErr } = await srv
    .from("grade_subject_components")
    .select("id, subject_id, label, short_label, coeff_in_subject, order_index, is_active")
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
          r.order_index !== null && r.order_index !== undefined ? Number(r.order_index) : 1;

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
      if (a.subject_id !== b.subject_id) return a.subject_id.localeCompare(b.subject_id);
      return a.order_index - b.order_index;
    });

    subjectComponentsForReport = rows;
    rows.forEach((c) => {
      subjectComponentById.set(c.id, c);
      const arr = compsBySubject.get(c.subject_id) || [];
      arr.push(c);
      compsBySubject.set(c.subject_id, arr);
    });
  }

  /* 6ter) Groupes (BILAN LETTRES / SCIENCES / AUTRES) */
  let subjectGroups: BulletinSubjectGroup[] = [];
  let groupedSubjectIds = new Set<string>();

  // Helpers pour (re)router vers le bon bilan (EPS => AUTRES)
  const subjectInfoById = new Map<string, { name: string; code: string }>();
  subjects.forEach((s) =>
    subjectInfoById.set(s.id, { name: s.name ?? "", code: s.code ?? "" })
  );

  if (bulletinLevel) {
    const { data: groupsData, error: groupsErr } = await srv
      .from("bulletin_subject_groups")
      .select("id, level, label, order_index, is_active, code, short_label, annual_coeff")
      .eq("institution_id", institutionId)
      .eq("level", bulletinLevel)
      .order("order_index", { ascending: true });

    if (groupsErr) {
      console.error("[bulletin] groups error", groupsErr);
    } else if (groupsData && groupsData.length) {
      const activeGroups = (groupsData as any[]).filter((g) => g.is_active !== false);

      if (activeGroups.length) {
        const groupIds = activeGroups.map((g) => String(g.id));

        const { data: itemsData, error: itemsErr } = await srv
          .from("bulletin_subject_group_items")
          .select("id, group_id, subject_id, created_at")
          .in("group_id", groupIds);

        if (itemsErr) console.error("[bulletin] group_items error", itemsErr);

        const rawItems = (itemsData || []) as any[];

        rawItems.sort((a, b) => {
          const ag = String(a.group_id || "");
          const bg = String(b.group_id || "");
          if (ag !== bg) return ag.localeCompare(bg);
          const ac = String(a.created_at || "");
          const bc = String(b.created_at || "");
          return ac.localeCompare(bc);
        });

        // sujets listés dans items
        const groupSubjectIds = Array.from(
          new Set(
            rawItems
              .map((r) => (r.subject_id ? String(r.subject_id) : ""))
              .filter((v) => v && isUuid(v))
          )
        );

        const subjMetaInGroups = new Map<string, { name: string; code: string }>();
        if (groupSubjectIds.length) {
          const { data: sRows, error: sErr } = await srv
            .from("subjects")
            .select("id, name, code")
            .in("id", groupSubjectIds);

          if (sErr) console.error("[bulletin] subjects lookup for group items error", sErr);
          else {
            (sRows || []).forEach((s: any) => {
              const sid = String(s.id);
              subjMetaInGroups.set(sid, {
                name: String(s.name || ""),
                code: String(s.code || ""),
              });
            });
          }
        }

        const itemsByGroup = new Map<string, any[]>();
        rawItems.forEach((row) => {
          const gId = String(row.group_id);
          const arr = itemsByGroup.get(gId) || [];
          arr.push(row);
          itemsByGroup.set(gId, arr);
        });

        // 1) fabriquer groupes depuis DB
        const builtGroups: BulletinSubjectGroup[] = activeGroups.map((g: any) => {
          const rows = itemsByGroup.get(String(g.id)) || [];
          const items: BulletinSubjectGroupItem[] = rows.flatMap((row: any, idx: number) => {
            const sid = row.subject_id ? String(row.subject_id) : "";
            if (!sid || !isUuid(sid)) return [];

            const meta =
              subjMetaInGroups.get(sid) || subjectInfoById.get(sid) || { name: "", code: "" };
            const subjectName = meta.name || meta.code || "Matière";

            const it: BulletinSubjectGroupItem = {
              id: String(row.id),
              group_id: String(row.group_id),
              subject_id: sid,
              subject_name: String(subjectName),
              order_index: idx + 1,
              subject_coeff_override: null,
              is_optional: false,
            };

            return [it];
          });

          const annualCoeffRaw =
            (g as any).annual_coeff !== null && (g as any).annual_coeff !== undefined
              ? Number((g as any).annual_coeff)
              : 1;

          const groupCode =
            (g as any).code && String((g as any).code).trim() !== ""
              ? String((g as any).code)
              : String(g.label);

          const shortLabel =
            (g as any).short_label && String((g as any).short_label).trim() !== ""
              ? String((g as any).short_label)
              : null;

          return {
            id: String(g.id),
            code: groupCode,
            label: String(g.label),
            short_label: shortLabel,
            order_index: Number(g.order_index ?? 1),
            is_active: g.is_active !== false,
            annual_coeff: cleanCoeff(annualCoeffRaw),
            items,
          };
        });

        // 2) ROUTAGE + ANTI-DOUBLONS + EPS=>AUTRES + PHILO=>LETTRES
        const byCode = new Map<string, BulletinSubjectGroup>();
        builtGroups.forEach((g) => byCode.set(g.code, g));

        const gLetters = byCode.get("BILAN_LETTRES") || null;
        const gSciences = byCode.get("BILAN_SCIENCES") || null;
        const gAutres = byCode.get("BILAN_AUTRES") || null;

        // Choix final: 1 seul groupe par subject_id
        const chosenGroupIdBySubject = new Map<string, string>();
        const firstSeenOrder = new Map<string, number>();

        const groupOrder = builtGroups
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .map((g) => g.id);

        const groupById = new Map<string, BulletinSubjectGroup>();
        builtGroups.forEach((g) => groupById.set(g.id, g));

        function desiredGroupIdForSubject(sid: string): string | null {
          const meta = subjectInfoById.get(sid) || { name: "", code: "" };
          const name = meta.name;
          const code = meta.code;

          // forçages
          if (isOtherSubject(name, code)) return gAutres?.id ?? null;
          if (isPhiloSubject(name, code)) return gLetters?.id ?? null;
          if (isScienceSubject(name, code)) return gSciences?.id ?? null;

          // défaut = lettres si existe, sinon null
          return gLetters?.id ?? null;
        }

        // 2a) passer sur items DB dans l’ordre et enregistrer "first seen"
        for (const gid of groupOrder) {
          const g = groupById.get(gid);
          if (!g) continue;
          for (const it of g.items) {
            const sid = it.subject_id;
            if (!isUuid(sid)) continue;
            if (!firstSeenOrder.has(sid)) firstSeenOrder.set(sid, it.order_index);
            // tentative initiale: ce que dit la DB
            if (!chosenGroupIdBySubject.has(sid)) chosenGroupIdBySubject.set(sid, g.id);
          }
        }

        // 2b) appliquer forçages (EPS=>AUTRES, etc.)
        for (const sid of chosenGroupIdBySubject.keys()) {
          const desired = desiredGroupIdForSubject(sid);
          if (desired) chosenGroupIdBySubject.set(sid, desired);
        }

        // 2c) reconstruire items par groupe, sans doublons
        const rebuilt = builtGroups.map((g) => ({ ...g, items: [] as BulletinSubjectGroupItem[] }));

        const rebuiltById = new Map<string, BulletinSubjectGroup>();
        rebuilt.forEach((g) => rebuiltById.set(g.id, g));

        // injecter sujets présents dans les items DB
        for (const [sid, gid] of chosenGroupIdBySubject.entries()) {
          const target = rebuiltById.get(gid);
          if (!target) continue;

          const meta = subjectInfoById.get(sid) || { name: "", code: "" };
          const subjectName = meta.name || meta.code || "Matière";

          target.items.push({
            id: `virt-${sid}`, // id virtuel (ne casse pas le front)
            group_id: gid,
            subject_id: sid,
            subject_name: subjectName,
            order_index: firstSeenOrder.get(sid) ?? 9999,
            subject_coeff_override: null,
            is_optional: false,
          });
        }

        // trier items par order_index
        rebuilt.forEach((g) => {
          g.items.sort((a, b) => a.order_index - b.order_index);
          // re-indexer proprement
          g.items = g.items.map((it, idx) => ({ ...it, order_index: idx + 1 }));
        });

        subjectGroups = rebuilt;

        // ✅ recalcul groupedSubjectIds sur base finale
        groupedSubjectIds = new Set<string>();
        subjectGroups.forEach((g) => {
          g.items.forEach((it) => {
            if (subjectIdSet.has(it.subject_id)) groupedSubjectIds.add(it.subject_id);
          });
        });
      }
    }
  }

  const hasGroupConfig = subjectGroups.length > 0;

  /* 7) Maps calcul */
  const evalById = new Map<string, EvalRow>();
  for (const e of evals) evalById.set(e.id, e);

  const perStudentSubject = new Map<string, Map<string, { sumWeighted: number; sumCoeff: number }>>();

  const perStudentSubjectComponent = new Map<
    string,
    Map<string, { subject_id: string; sumWeighted: number; sumCoeff: number }>
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

    if (ev.subject_component_id) {
      const comp = subjectComponentById.get(ev.subject_component_id);
      if (comp) {
        let stuCompMap = perStudentSubjectComponent.get(sc.student_id);
        if (!stuCompMap) {
          stuCompMap = new Map();
          perStudentSubjectComponent.set(sc.student_id, stuCompMap);
        }
        const compCell =
          stuCompMap.get(comp.id) || { subject_id: comp.subject_id, sumWeighted: 0, sumCoeff: 0 };
        compCell.sumWeighted += norm20 * weight;
        compCell.sumCoeff += weight;
        stuCompMap.set(comp.id, compCell);
      }
    }
  }

  /* 8) Construire la réponse (par élève) */
  const items = classStudents.map((cs) => {
    const stu = cs.students || {};
    const fullName =
      stu.full_name || [stu.last_name, stu.first_name].filter(Boolean).join(" ") || "Élève";

    const stuMap =
      perStudentSubject.get(cs.student_id) ||
      new Map<string, { sumWeighted: number; sumCoeff: number }>();

    const stuCompMap =
      perStudentSubjectComponent.get(cs.student_id) ||
      new Map<string, { subject_id: string; sumWeighted: number; sumCoeff: number }>();

    // sous-matières
    const per_subject_components =
      subjectComponentsForReport.length === 0
        ? []
        : subjectComponentsForReport.map((comp) => {
            const cell = stuCompMap.get(comp.id);
            let avg20: number | null = null;
            if (cell && cell.sumCoeff > 0) {
              avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff, 4);
            }
            return {
              subject_id: comp.subject_id,
              component_id: comp.id,
              avg20,
            };
          });

    // matière: ✅ si elle a des composants, on recalcule avg depuis les sous-matières
    const per_subject = subjectsForReport.map((s) => {
      const comps = compsBySubject.get(s.subject_id) || [];

      let avg20: number | null = null;

      // ✅ priorité: calcul depuis sous-matières si au moins 1 sous-matière notée
      if (comps.length) {
        let sum = 0;
        let sumW = 0;

        for (const comp of comps) {
          const cell = stuCompMap.get(comp.id);
          if (!cell || cell.sumCoeff <= 0) continue;

          const compAvgRaw = cell.sumWeighted / cell.sumCoeff;
          if (!Number.isFinite(compAvgRaw)) continue;

          const w = comp.coeff_in_subject ?? 1;
          if (!w || w <= 0) continue;

          sum += compAvgRaw * w;
          sumW += w;
        }

        if (sumW > 0) {
          // 4 décimales => total (avg*coeff) colle à la pondération/somme
          avg20 = cleanNumber(sum / sumW, 4);
        }
      }

      // fallback: calcul direct via évaluations de la matière
      if (avg20 === null) {
        const cell = stuMap.get(s.subject_id);
        if (cell && cell.sumCoeff > 0) {
          avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff, 4);
        }
      }

      return {
        subject_id: s.subject_id,
        avg20,
      };
    });

    // moyennes par bilan (pondérées par coeff bulletin des matières)
    let per_group:
      | {
          group_id: string;
          group_avg: number | null;
        }[]
      | [] = [];

    if (hasGroupConfig) {
      const coeffBulletinBySubject = new Map<string, number>();
      subjectsForReport.forEach((s) =>
        coeffBulletinBySubject.set(s.subject_id, Number(s.coeff_bulletin ?? 1))
      );

      per_group = subjectGroups.map((g) => {
        let sum = 0;
        let sumCoeffLocal = 0;

        for (const it of g.items) {
          const sid = it.subject_id;

          // récupérer avg calculée (incluant recalcul via sous-matières)
          const ps = (per_subject as any[]).find((x) => x.subject_id === sid);
          const subAvg = ps?.avg20 ?? null;
          if (subAvg === null || subAvg === undefined) continue;

          const w =
            it.subject_coeff_override !== null && it.subject_coeff_override !== undefined
              ? Number(it.subject_coeff_override)
              : coeffBulletinBySubject.get(sid) ?? 1;

          if (!w || w <= 0) continue;

          sum += Number(subAvg) * w;
          sumCoeffLocal += w;
        }

        const groupAvg = sumCoeffLocal > 0 ? cleanNumber(sum / sumCoeffLocal, 4) : null;

        return {
          group_id: g.id,
          group_avg: groupAvg,
        };
      });
    }

    // ✅ moyenne générale: uniquement matières (pas bilans)
    let general_avg: number | null = null;
    {
      let sumGen = 0;
      let sumCoeffGen = 0;

      for (const s of subjectsForReport) {
        if (s.include_in_average === false) continue;
        const coeffSub = Number(s.coeff_bulletin ?? 0);
        if (!coeffSub || coeffSub <= 0) continue;

        const ps = (per_subject as any[]).find((x) => x.subject_id === s.subject_id);
        const subAvg = ps?.avg20 ?? null;
        if (subAvg === null || subAvg === undefined) continue;

        sumGen += Number(subAvg) * coeffSub;
        sumCoeffGen += coeffSub;
      }

      general_avg = sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;
    }

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
      per_subject,
      per_group,
      general_avg,
      per_subject_components,
    };
  });

  // Rang matière / sous-matière
  applySubjectRanks(items);
  applySubjectComponentRanks(items);

  // Professeurs par matière
  await attachTeachersToSubjects(
    supabase,
    srv,
    items,
    evals,
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
      level: classRow.level || null,
      bulletin_level: bulletinLevel,
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

// src/app/api/admin/mon-cahier-ia/insights/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_KEY = "mon_cahier_ai_pedagogique";
const MODEL_VERSION = "2026.06-v1";

type InsightAction =
  | "students_to_follow"
  | "class_decline_risk"
  | "blocking_subjects"
  | "school_summary"
  | "council_note"
  | "remediation_plan";

type Body = {
  action?: InsightAction | string;
  academic_year?: string | null;
  exam_date?: string | null;
  class_id?: string | null;
  level?: string | null;
  class_label?: string | null;
  key_subjects_coverage?: number | null;
};

type ClassRow = {
  id: string;
  label: string | null;
  code: string | null;
  level: string | null;
  academic_year: string | null;
};

type PredictionStudent = {
  student_id: string;
  full_name: string;
  matricule: string;
  class_id: string;
  class_label: string;
  class_level: string | null;
  general_avg_20: number | null;
  predicted_success: number;
  risk_level: "low" | "medium" | "high";
  risk_label: string;
  presence_rate: number | null;
  total_absent_hours: number | null;
  nb_lates: number | null;
  conduct_total_20: number | null;
  raw_core_avg_20: number | null;
  raw_all_avg_20: number | null;
};

type ClassPrediction = {
  class_id: string;
  class_label: string;
  class_level: string | null;
  class_size: number;
  predicted_success_rate: number;
  high_risk_count: number;
  medium_risk_count: number;
  average_general_avg_20: number | null;
  average_presence_rate: number | null;
  students: PredictionStudent[];
};

type SubjectStat = {
  class_id: string;
  class_label: string;
  level: string | null;
  subject_id: string;
  subject_name: string;
  evals_count: number;
  notes_count: number;
  avg_score_20: number | null;
  blocker_score: number;
};

const ALLOWED_ROLES = new Set([
  "admin",
  "super_admin",
  "founder",
  "educator",
  "principal",
  "direction",
]);

function relOne<T = any>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeSearch(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function round1(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 10) / 10;
}

function round2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

function clampPercent(value: unknown, fallback = 60): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function defaultExamDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function chunks<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function requireContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      ),
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      error: NextResponse.json(
        { ok: false, error: meErr.message },
        { status: 400 },
      ),
    };
  }

  const { data: roles, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleErr) {
    return {
      error: NextResponse.json(
        { ok: false, error: roleErr.message },
        { status: 400 },
      ),
    };
  }

  let institutionId = cleanText((me as any)?.institution_id);
  const allowedRows = ((roles || []) as any[]).filter((r) =>
    ALLOWED_ROLES.has(cleanText(r.role)),
  );

  if (!institutionId) {
    const fallbackRole = allowedRows.find((r) => r.institution_id);
    institutionId = cleanText(fallbackRole?.institution_id);
  }

  if (!institutionId) {
    return {
      error: NextResponse.json(
        {
          ok: false,
          error: "no_institution",
          message: "Aucune institution associée au compte.",
        },
        { status: 400 },
      ),
    };
  }

  const canRead = allowedRows.some((row) => {
    const role = cleanText(row.role);
    const roleInstitution = cleanText(row.institution_id);
    if (role === "super_admin") return true;
    if (!roleInstitution) return true;
    return roleInstitution === institutionId;
  });

  if (!canRead) {
    return {
      error: NextResponse.json(
        {
          ok: false,
          error: "forbidden",
          message: "Droits insuffisants pour Mon Cahier IA.",
        },
        { status: 403 },
      ),
    };
  }

  return { srv, userId: user.id, institutionId };
}

async function getCurrentAcademicYear(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
) {
  const { data: current } = await srv
    .from("academic_years")
    .select("code,label,start_date,end_date,is_current")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((current as any)?.code) return String((current as any).code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code,label,start_date,end_date,is_current")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (latest as any)?.code ? String((latest as any).code) : "";
}

async function getClasses(args: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  academicYear: string;
  classId?: string;
  level?: string;
  classLabel?: string;
}): Promise<ClassRow[]> {
  let query = args.srv
    .from("classes")
    .select("id,label,code,level,academic_year")
    .eq("institution_id", args.institutionId)
    .eq("academic_year", args.academicYear)
    .order("level", { ascending: true })
    .order("label", { ascending: true })
    .limit(500);

  if (args.classId) query = query.eq("id", args.classId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let rows = ((data || []) as any[]).map((row) => ({
    id: String(row.id),
    label: row.label ?? null,
    code: row.code ?? null,
    level: row.level ?? null,
    academic_year: row.academic_year ?? null,
  })) as ClassRow[];

  const levelSearch = normalizeSearch(args.level);
  if (levelSearch) {
    rows = rows.filter((c) => normalizeSearch(c.level).includes(levelSearch));
  }

  const classLabelSearch = normalizeSearch(args.classLabel);
  if (classLabelSearch) {
    rows = rows.filter((c) => {
      const target = normalizeSearch(
        `${c.label || ""} ${c.code || ""} ${c.level || ""}`,
      );
      return target.includes(classLabelSearch);
    });
  }

  return rows;
}

function riskLabel(riskLevel: string, pSuccess: number) {
  if (riskLevel === "low" || pSuccess >= 70) return "Suivi normal";
  if (riskLevel === "medium" || pSuccess >= 50) return "Suivi renforcé";
  return "Suivi prioritaire";
}

async function predictClass(args: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  classRow: ClassRow;
  academicYear: string;
  examDate: string;
  coverage: number;
}): Promise<ClassPrediction> {
  const { data, error } = await args.srv.rpc("predict_success_for_class", {
    p_institution_id: args.institutionId,
    p_class_id: args.classRow.id,
    p_academic_year: args.academicYear,
    p_exam_date: args.examDate,
    p_core_completion_percent: args.coverage,
  });

  if (error) throw new Error(error.message);

  const rows = ((data || []) as any[]).filter((row) => row.student_id);
  const students: PredictionStudent[] = rows.map((row) => {
    const pSuccess = Math.max(
      0,
      Math.min(100, Number(row.p_success ?? 0) * 100),
    );
    const riskLevel = String(
      row.risk_level ||
        (pSuccess >= 70 ? "low" : pSuccess >= 50 ? "medium" : "high"),
    ) as "low" | "medium" | "high";
    const fullName =
      `${cleanText(row.last_name)} ${cleanText(row.first_name)}`.trim() ||
      cleanText(row.matricule);

    return {
      student_id: String(row.student_id),
      full_name: fullName,
      matricule: cleanText(row.matricule),
      class_id: args.classRow.id,
      class_label:
        cleanText(row.class_label) ||
        cleanText(args.classRow.label) ||
        "Classe",
      class_level: cleanText(row.class_level) || args.classRow.level,
      general_avg_20: round2(Number(row.general_avg_20)),
      predicted_success: round1(pSuccess) ?? 0,
      risk_level: riskLevel,
      risk_label: riskLabel(riskLevel, pSuccess),
      presence_rate:
        row.presence_rate == null
          ? null
          : round1(Number(row.presence_rate) * 100),
      total_absent_hours:
        row.total_absent_hours == null
          ? null
          : round1(Number(row.total_absent_hours)),
      nb_lates: row.nb_lates == null ? null : Number(row.nb_lates),
      conduct_total_20:
        row.conduct_total_20 == null
          ? null
          : round2(Number(row.conduct_total_20)),
      raw_core_avg_20:
        row.raw_core_avg_20 == null
          ? null
          : round2(Number(row.raw_core_avg_20)),
      raw_all_avg_20:
        row.raw_all_avg_20 == null ? null : round2(Number(row.raw_all_avg_20)),
    };
  });

  const classSize = Number(rows[0]?.class_size || students.length || 0);
  const successAvg = students.length
    ? students.reduce((sum, s) => sum + s.predicted_success, 0) /
      students.length
    : 0;
  const avgGeneralValues = students
    .map((s) => s.general_avg_20)
    .filter((v): v is number => v != null);
  const avgPresenceValues = students
    .map((s) => s.presence_rate)
    .filter((v): v is number => v != null);

  return {
    class_id: args.classRow.id,
    class_label: cleanText(args.classRow.label) || "Classe",
    class_level: args.classRow.level,
    class_size: classSize,
    predicted_success_rate: round1(successAvg) ?? 0,
    high_risk_count: students.filter(
      (s) => s.risk_label === "Suivi prioritaire" || s.predicted_success < 50,
    ).length,
    medium_risk_count: students.filter(
      (s) => s.predicted_success >= 50 && s.predicted_success < 70,
    ).length,
    average_general_avg_20: avgGeneralValues.length
      ? round2(
          avgGeneralValues.reduce((sum, n) => sum + n, 0) /
            avgGeneralValues.length,
        )
      : null,
    average_presence_rate: avgPresenceValues.length
      ? round1(
          avgPresenceValues.reduce((sum, n) => sum + n, 0) /
            avgPresenceValues.length,
        )
      : null,
    students,
  };
}

async function predictManyClasses(args: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  classes: ClassRow[];
  academicYear: string;
  examDate: string;
  coverage: number;
}) {
  const out: ClassPrediction[] = [];
  for (const classRow of args.classes.slice(0, 80)) {
    try {
      out.push(
        await predictClass({
          srv: args.srv,
          institutionId: args.institutionId,
          classRow,
          academicYear: args.academicYear,
          examDate: args.examDate,
          coverage: args.coverage,
        }),
      );
    } catch (err) {
      console.warn(
        "[Mon Cahier IA] prédiction classe ignorée",
        classRow.label,
        err,
      );
    }
  }
  return out;
}

async function getSubjectStats(args: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  academicYear: string;
  classIds: string[];
}): Promise<SubjectStat[]> {
  if (!args.classIds.length) return [];

  const evalRows: any[] = [];
  for (const part of chunks(args.classIds, 80)) {
    const { data, error } = await args.srv
      .from("grade_evaluations")
      .select(
        `
        id,
        class_id,
        subject_id,
        eval_date,
        scale,
        coeff,
        is_published,
        classes!inner(
          institution_id,
          label,
          level,
          academic_year
        )
      `,
      )
      .eq("classes.institution_id", args.institutionId)
      .eq("classes.academic_year", args.academicYear)
      .eq("is_published", true)
      .in("class_id", part)
      .limit(20000);

    if (error) throw new Error(error.message);
    evalRows.push(
      ...((data || []) as any[]).filter((ev) => ev.id && ev.subject_id),
    );
  }

  if (!evalRows.length) return [];

  const evalIds = Array.from(new Set(evalRows.map((ev) => String(ev.id))));
  const subjectIds = Array.from(
    new Set(evalRows.map((ev) => String(ev.subject_id)).filter(Boolean)),
  );

  const subjectsById: Record<string, string> = {};
  if (subjectIds.length) {
    const { data: instRows } = await args.srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects(name)")
      .eq("institution_id", args.institutionId)
      .or(
        `id.in.(${subjectIds.join(",")}),subject_id.in.(${subjectIds.join(",")})`,
      );

    for (const row of (instRows || []) as any[]) {
      const base = cleanText(relOne<any>(row.subjects)?.name) || "Matière";
      const name = cleanText(row.custom_name) || base;
      if (row.id) subjectsById[String(row.id)] = name;
      if (row.subject_id) subjectsById[String(row.subject_id)] = name;
    }

    const missing = subjectIds.filter((id) => !subjectsById[id]);
    if (missing.length) {
      const { data: subRows } = await args.srv
        .from("subjects")
        .select("id,name,code,subject_key")
        .in("id", missing);
      for (const row of (subRows || []) as any[]) {
        subjectsById[String(row.id)] =
          cleanText(row.name) ||
          cleanText(row.code) ||
          cleanText(row.subject_key) ||
          "Matière";
      }
    }
  }

  const marks: any[] = [];
  for (const part of chunks(evalIds, 500)) {
    const { data, error } = await args.srv
      .from("grade_flat_marks")
      .select("evaluation_id,raw_score,mark_20")
      .in("evaluation_id", part);

    if (error) throw new Error(error.message);
    marks.push(...((data || []) as any[]));
  }

  const evalById = new Map(evalRows.map((ev) => [String(ev.id), ev]));
  type Acc = {
    class_id: string;
    class_label: string;
    level: string | null;
    subject_id: string;
    subject_name: string;
    evalIds: Set<string>;
    notes_count: number;
    weighted_sum: number;
    weight_total: number;
  };

  const accByKey = new Map<string, Acc>();
  function ensureAcc(ev: any): Acc {
    const cls = relOne<any>(ev.classes);
    const subjectId = String(ev.subject_id);
    const key = `${String(ev.class_id)}::${subjectId}`;
    let acc = accByKey.get(key);
    if (!acc) {
      acc = {
        class_id: String(ev.class_id),
        class_label: cleanText(cls?.label) || "Classe",
        level: cls?.level ? cleanText(cls.level) : null,
        subject_id: subjectId,
        subject_name: subjectsById[subjectId] || "Matière",
        evalIds: new Set<string>(),
        notes_count: 0,
        weighted_sum: 0,
        weight_total: 0,
      };
      accByKey.set(key, acc);
    }
    acc.evalIds.add(String(ev.id));
    return acc;
  }

  for (const ev of evalRows) ensureAcc(ev);

  for (const mark of marks) {
    const ev = evalById.get(String(mark.evaluation_id));
    if (!ev) continue;
    const scale = Number(ev.scale || 20);
    const coeff = Number(ev.coeff || 1);
    if (
      !Number.isFinite(scale) ||
      scale <= 0 ||
      !Number.isFinite(coeff) ||
      coeff <= 0
    )
      continue;

    let mark20: number | null = null;
    if (mark.mark_20 !== null && mark.mark_20 !== undefined)
      mark20 = Number(mark.mark_20);
    else if (mark.raw_score !== null && mark.raw_score !== undefined)
      mark20 = (Number(mark.raw_score) / scale) * 20;
    if (mark20 == null || !Number.isFinite(mark20)) continue;

    const acc = ensureAcc(ev);
    acc.notes_count += 1;
    acc.weighted_sum += mark20 * coeff;
    acc.weight_total += coeff;
  }

  return Array.from(accByKey.values())
    .map((acc) => {
      const avg =
        acc.weight_total > 0 ? acc.weighted_sum / acc.weight_total : null;
      const evalWeakness = acc.evalIds.size < 2 ? 1 : 0;
      const avgWeakness = avg == null ? 2 : Math.max(0, 10 - avg);
      return {
        class_id: acc.class_id,
        class_label: acc.class_label,
        level: acc.level,
        subject_id: acc.subject_id,
        subject_name: acc.subject_name,
        evals_count: acc.evalIds.size,
        notes_count: acc.notes_count,
        avg_score_20: round2(avg),
        blocker_score: round2(avgWeakness * 10 + evalWeakness * 8) || 0,
      };
    })
    .sort(
      (a, b) =>
        b.blocker_score - a.blocker_score ||
        (a.avg_score_20 ?? 99) - (b.avg_score_20 ?? 99),
    );
}

function makeStudentReasons(s: PredictionStudent): string[] {
  const reasons: string[] = [];
  if (s.general_avg_20 != null && s.general_avg_20 < 10)
    reasons.push(`moyenne générale ${s.general_avg_20}/20`);
  if (s.raw_core_avg_20 != null && s.raw_core_avg_20 < 10)
    reasons.push(`matières clés ${s.raw_core_avg_20}/20`);
  if (s.presence_rate != null && s.presence_rate < 85)
    reasons.push(`assiduité ${s.presence_rate}%`);
  if (s.total_absent_hours != null && s.total_absent_hours >= 8)
    reasons.push(`${s.total_absent_hours} h d’absence`);
  if (s.nb_lates != null && s.nb_lates >= 3)
    reasons.push(`${s.nb_lates} retards`);
  if (s.conduct_total_20 != null && s.conduct_total_20 < 12)
    reasons.push(`conduite ${s.conduct_total_20}/20`);
  if (!reasons.length)
    reasons.push(`indice de réussite ${s.predicted_success}%`);
  return reasons.slice(0, 4);
}

function buildSummary(predictions: ClassPrediction[], blockers: SubjectStat[]) {
  const classesCount = predictions.length;
  const studentsCount = predictions.reduce((sum, c) => sum + c.class_size, 0);
  const highRisk = predictions.reduce((sum, c) => sum + c.high_risk_count, 0);
  const avgSuccess = predictions.length
    ? predictions.reduce((sum, c) => sum + c.predicted_success_rate, 0) /
      predictions.length
    : 0;
  const worstClass =
    [...predictions].sort(
      (a, b) => a.predicted_success_rate - b.predicted_success_rate,
    )[0] || null;
  const weakestSubjects = blockers.slice(0, 5);

  return {
    classes_analyzed: classesCount,
    students_analyzed: studentsCount,
    high_risk_students: highRisk,
    average_predicted_success_rate: round1(avgSuccess) ?? 0,
    most_sensitive_class: worstClass
      ? {
          class_id: worstClass.class_id,
          class_label: worstClass.class_label,
          class_level: worstClass.class_level,
          predicted_success_rate: worstClass.predicted_success_rate,
          high_risk_count: worstClass.high_risk_count,
        }
      : null,
    weakest_subjects: weakestSubjects,
  };
}

function buildCouncilNote(
  classPrediction: ClassPrediction,
  blockers: SubjectStat[],
) {
  const risky = [...classPrediction.students]
    .sort((a, b) => a.predicted_success - b.predicted_success)
    .slice(0, 8);
  const weakSubjects = blockers
    .filter((b) => b.class_id === classPrediction.class_id)
    .slice(0, 5);
  const studentLine = risky.length
    ? risky
        .map(
          (s) =>
            `${s.full_name || s.matricule} (${s.risk_label}, ${s.predicted_success}%)`,
        )
        .join(" ; ")
    : "aucun élève prioritaire détecté avec les données disponibles";
  const subjectLine = weakSubjects.length
    ? weakSubjects
        .map(
          (s) =>
            `${s.subject_name}${s.avg_score_20 == null ? "" : ` (${s.avg_score_20}/20)`}`,
        )
        .join(" ; ")
    : "aucune matière bloquante clairement détectée";

  return `Note préparatoire au conseil de classe – ${classPrediction.class_label}\n\nMon Cahier IA estime l’indice de préparation de la classe à ${classPrediction.predicted_success_rate}%. La classe compte ${classPrediction.class_size} élève(s), dont ${classPrediction.high_risk_count} en suivi prioritaire et ${classPrediction.medium_risk_count} en suivi renforcé.\n\nPoints d’attention : ${subjectLine}.\n\nÉlèves à suivre avant la prochaine échéance : ${studentLine}.\n\nProposition : mettre en place une remédiation ciblée dans les matières faibles, suivre l’assiduité, informer le professeur principal, associer l’éducateur de niveau et contacter les parents des élèves en suivi prioritaire. Cette analyse reste une aide à la décision et ne remplace pas l’appréciation de l’équipe pédagogique.`;
}

function buildRemediationPlan(
  classPrediction: ClassPrediction,
  blockers: SubjectStat[],
) {
  const weakSubjects = blockers
    .filter((b) => b.class_id === classPrediction.class_id)
    .slice(0, 4);
  const risky = [...classPrediction.students]
    .sort((a, b) => a.predicted_success - b.predicted_success)
    .slice(0, 10);

  return [
    {
      title: "Cibler les matières bloquantes",
      actions: weakSubjects.length
        ? weakSubjects.map(
            (s) =>
              `Organiser une séance de remédiation en ${s.subject_name} avec exercices types et correction dirigée.`,
          )
        : [
            "Identifier avec les enseignants les chapitres non maîtrisés et programmer une séance courte par matière clé.",
          ],
    },
    {
      title: "Suivre les élèves prioritaires",
      actions: risky.length
        ? risky
            .slice(0, 6)
            .map(
              (s) =>
                `${s.full_name || s.matricule} : ${makeStudentReasons(s).join(", ")}.`,
            )
        : [
            "Aucun élève prioritaire détecté avec les données actuellement disponibles.",
          ],
    },
    {
      title: "Associer l’équipe éducative",
      actions: [
        "Confier le suivi hebdomadaire au professeur principal et à l’éducateur de niveau.",
        "Informer les parents lorsque l’assiduité, les retards ou les résultats deviennent préoccupants.",
        "Contrôler la publication régulière des notes pour éviter les décisions basées sur des données incomplètes.",
      ],
    },
    {
      title: "Mesurer l’effet après deux semaines",
      actions: [
        "Relancer l’analyse Mon Cahier IA après les nouvelles évaluations.",
        "Comparer les élèves prioritaires avant/après remédiation.",
        "Adapter le plan si les matières bloquantes persistent.",
      ],
    },
  ];
}

async function saveInsightRun(args: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  userId: string;
  action: InsightAction;
  input: any;
  output: any;
}) {
  try {
    const { error } = await args.srv.from("ai_insight_runs").insert({
      institution_id: args.institutionId,
      action: args.action,
      model_key: MODEL_KEY,
      model_version: MODEL_VERSION,
      input_json: args.input,
      output_json: args.output,
      created_by: args.userId,
    });
    if (error)
      console.warn("[Mon Cahier IA] analyse non historisée", error.message);
  } catch (err) {
    console.warn("[Mon Cahier IA] historique analyse ignoré", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext();
    if ("error" in ctx) return ctx.error;

    const body = (await req.json().catch(() => ({}))) as Body;
    const action = cleanText(body.action) as InsightAction;
    const supported: InsightAction[] = [
      "students_to_follow",
      "class_decline_risk",
      "blocking_subjects",
      "school_summary",
      "council_note",
      "remediation_plan",
    ];

    if (!supported.includes(action)) {
      return NextResponse.json(
        {
          ok: false,
          error: "unsupported_action",
          message: "Question IA non prise en charge.",
        },
        { status: 400 },
      );
    }

    const academicYear =
      cleanText(body.academic_year) ||
      (await getCurrentAcademicYear(ctx.srv, ctx.institutionId));
    if (!academicYear) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_academic_year",
          message: "Aucune année scolaire active trouvée.",
        },
        { status: 400 },
      );
    }

    const level = cleanText(body.level);
    const classId = cleanText(body.class_id);
    const classLabel = cleanText(body.class_label);
    const examDate = cleanText(body.exam_date) || defaultExamDate();
    const coverage = clampPercent(body.key_subjects_coverage, 60);

    let classes = await getClasses({
      srv: ctx.srv,
      institutionId: ctx.institutionId,
      academicYear,
      classId,
      level,
      classLabel,
    });

    if (
      !classes.length &&
      action === "students_to_follow" &&
      !level &&
      !classId &&
      !classLabel
    ) {
      classes = await getClasses({
        srv: ctx.srv,
        institutionId: ctx.institutionId,
        academicYear,
        level: "3",
      });
    }

    if (!classes.length) {
      return NextResponse.json({
        ok: true,
        model: {
          key: MODEL_KEY,
          version: MODEL_VERSION,
          mode: "aide_decision_explicable",
        },
        input: {
          action,
          academic_year: academicYear,
          level,
          class_id: classId,
          class_label: classLabel,
          exam_date: examDate,
          coverage,
        },
        answer_title: "Aucune classe trouvée",
        answer:
          "Mon Cahier IA n’a trouvé aucune classe correspondant aux critères demandés.",
        items: [],
      });
    }

    const predictions = await predictManyClasses({
      srv: ctx.srv,
      institutionId: ctx.institutionId,
      classes,
      academicYear,
      examDate,
      coverage,
    });

    const subjectStats = await getSubjectStats({
      srv: ctx.srv,
      institutionId: ctx.institutionId,
      academicYear,
      classIds: classes.map((c) => c.id),
    }).catch((err) => {
      console.warn("[Mon Cahier IA] stats matières indisponibles", err);
      return [] as SubjectStat[];
    });

    let output: any;

    if (action === "students_to_follow") {
      const students = predictions
        .flatMap((c) => c.students)
        .sort((a, b) => a.predicted_success - b.predicted_success)
        .slice(0, 30)
        .map((s) => ({ ...s, reasons: makeStudentReasons(s) }));

      output = {
        answer_title: level
          ? `Élèves à suivre – niveau ${level}`
          : "Élèves à suivre avant l’échéance",
        answer:
          students.length > 0
            ? `Mon Cahier IA recommande un suivi prioritaire ou renforcé pour ${students.length} élève(s), en ciblant d’abord les plus faibles indices de préparation.`
            : "Aucun élève prioritaire n’a été détecté avec les données actuellement disponibles.",
        items: students,
        class_ranking: predictions
          .sort((a, b) => a.predicted_success_rate - b.predicted_success_rate)
          .slice(0, 10),
      };
    }

    if (action === "class_decline_risk") {
      const ranking = predictions
        .map((c) => ({
          ...c,
          decline_risk_score: round1(
            (100 - c.predicted_success_rate) * 0.7 +
              c.high_risk_count * 3 +
              (c.average_presence_rate != null
                ? Math.max(0, 90 - c.average_presence_rate)
                : 5),
          ),
        }))
        .sort(
          (a, b) =>
            Number(b.decline_risk_score || 0) -
            Number(a.decline_risk_score || 0),
        )
        .slice(0, 15);

      const top = ranking[0] || null;
      output = {
        answer_title: "Classe avec plus fort risque de baisse",
        answer: top
          ? `${top.class_label} ressort comme la classe la plus sensible, avec un indice de préparation de ${top.predicted_success_rate}% et ${top.high_risk_count} élève(s) en suivi prioritaire.`
          : "Aucune classe exploitable avec les données disponibles.",
        items: ranking,
      };
    }

    if (action === "blocking_subjects") {
      const blockers = subjectStats
        .filter(
          (s) =>
            s.avg_score_20 == null || s.avg_score_20 < 10 || s.evals_count < 2,
        )
        .slice(0, 20);
      output = {
        answer_title:
          classLabel || classId
            ? "Matières qui bloquent la classe"
            : "Matières bloquantes détectées",
        answer: blockers.length
          ? `Mon Cahier IA détecte ${blockers.length} matière(s) à surveiller, principalement à cause de moyennes faibles ou d’un volume d’évaluations insuffisant.`
          : "Aucune matière bloquante majeure n’a été détectée avec les notes publiées.",
        items: blockers,
      };
    }

    if (action === "school_summary") {
      const summary = buildSummary(predictions, subjectStats);
      output = {
        answer_title: "Résumé pédagogique de l’établissement",
        answer: `Mon Cahier IA a analysé ${summary.classes_analyzed} classe(s) et ${summary.students_analyzed} élève(s). L’indice moyen de préparation est de ${summary.average_predicted_success_rate}%. ${summary.high_risk_students} élève(s) ressortent en suivi prioritaire.`,
        summary,
        class_ranking: predictions
          .sort((a, b) => a.predicted_success_rate - b.predicted_success_rate)
          .slice(0, 10),
        weakest_subjects: subjectStats.slice(0, 10),
      };
    }

    if (action === "council_note") {
      const target = classId
        ? predictions.find((p) => p.class_id === classId) || predictions[0]
        : [...predictions].sort(
            (a, b) => a.predicted_success_rate - b.predicted_success_rate,
          )[0];
      output = {
        answer_title: target
          ? `Note conseil de classe – ${target.class_label}`
          : "Note conseil de classe",
        answer: target
          ? buildCouncilNote(target, subjectStats)
          : "Aucune classe exploitable avec les données disponibles.",
        target_class: target || null,
      };
    }

    if (action === "remediation_plan") {
      const target = classId
        ? predictions.find((p) => p.class_id === classId) || predictions[0]
        : [...predictions].sort(
            (a, b) => a.predicted_success_rate - b.predicted_success_rate,
          )[0];
      output = {
        answer_title: target
          ? `Plan de remédiation – ${target.class_label}`
          : "Plan de remédiation",
        answer: target
          ? `Plan proposé pour ${target.class_label}, en priorité sur les matières faibles, les élèves à risque et le suivi de l’assiduité.`
          : "Aucune classe exploitable avec les données disponibles.",
        target_class: target || null,
        plan: target ? buildRemediationPlan(target, subjectStats) : [],
      };
    }

    const payload = {
      ok: true,
      model: {
        key: MODEL_KEY,
        version: MODEL_VERSION,
        mode: "aide_decision_explicable",
        notice:
          "Mon Cahier IA aide à décider et à accompagner. Il ne sanctionne pas automatiquement un élève et ne remplace pas l’équipe pédagogique.",
      },
      input: {
        action,
        academic_year: academicYear,
        level,
        class_id: classId,
        class_label: classLabel,
        exam_date: examDate,
        coverage,
      },
      data_quality: {
        classes_found: classes.length,
        classes_analyzed: predictions.length,
        subject_stats_available: subjectStats.length,
      },
      ...output,
    };

    await saveInsightRun({
      srv: ctx.srv,
      institutionId: ctx.institutionId,
      userId: ctx.userId,
      action,
      input: payload.input,
      output: payload,
    });

    return NextResponse.json(payload);
  } catch (e: any) {
    console.error("[Mon Cahier IA] insights failed", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "mon_cahier_ai_failed" },
      { status: 400 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  buildAiAnswer,
  buildStudentReasons,
  cleanText,
  clamp,
  computePriorityScore,
  getRiskLevel,
  extractLevelHint,
  levelMatches,
  round2,
  summarizeClassReasons,
  type AiClassSignal,
  type AiDataQuality,
  type AiDataQualityItem,
  type AiStudentSignal,
  type AiSubjectSignal,
  type MonCahierAiContext,
} from "@/lib/mon-cahier-ai/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | string;

type Body = {
  question?: string;
  academic_year?: string;
  exam_date?: string;
  class_id?: string | null;
  level?: string | null;
  core_completion_percent?: number | string | null;
};

type PredictionRow = {
  student_id: string;
  last_name?: string | null;
  first_name?: string | null;
  matricule?: string | null;
  academic_year?: string | null;
  class_id: string;
  class_label?: string | null;
  class_level?: string | null;
  general_avg_20?: number | null;
  raw_all_avg_20?: number | null;
  raw_core_avg_20?: number | null;
  presence_rate?: number | null;
  total_absent_hours?: number | null;
  nb_lates?: number | null;
  conduct_total_20?: number | null;
  conduct_norm?: number | null;
  p_success?: number | null;
  risk_level?: string | null;
};

type ClassRow = {
  id: string;
  label: string | null;
  level: string | null;
  academic_year?: string | null;
  institution_id?: string | null;
};

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  eval_date?: string | null;
  eval_kind?: string | null;
  scale?: number | null;
  coeff?: number | null;
  is_published?: boolean | null;
};

type MarkRow = {
  evaluation_id: string;
  student_id?: string | null;
  raw_score?: number | null;
  mark_20?: number | null;
};

type GradePeriodRow = {
  id: string;
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
  academic_year?: string | null;
  start_date: string;
  end_date: string;
  coeff?: number | null;
};

type OfficialBulletinAverage = {
  student_id: string;
  general_avg_20: number | null;
  annual_avg_20: number | null;
  rank: number | null;
  annual_rank: number | null;
  status: string | null;
  source_period: {
    from: string;
    to: string;
    label: string | null;
    code: string | null;
  };
};

type SubjectAvailabilityStats = {
  published_evaluations_count: number;
  notes_count: number;
  evaluated_subjects_count: number;
};

const MODEL_KEY = "mon_cahier_ai_pedagogy";
const MODEL_VERSION = "2.0.0";
const AI_SERVICE_URL =
  process.env.MON_CAHIER_AI_SERVICE_URL || process.env.ML_PREDICT_URL || "";

function chunks<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fullName(row: PredictionRow): string {
  return `${row.last_name || ""} ${row.first_name || ""}`.replace(/\s+/g, " ").trim() || row.matricule || "Élève";
}

function normalizeRisk(raw: unknown, pSuccess: number | null | undefined) {
  const value = String(raw || "").toLowerCase();
  if (["low", "medium", "high"].includes(value)) return value as "low" | "medium" | "high";
  return getRiskLevel(pSuccess);
}

function cleanNumberOrNull(value: unknown, precision = 2): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(precision));
}

function inferLevelFromClassLabel(label: unknown, fallbackLevel: unknown) {
  const labelText = cleanText(label);
  const fallbackText = String(fallbackLevel || "").trim();

  // La classe sélectionnée est la source métier la plus forte. Si une classe
  // s'appelle "Tle D1" mais que son champ niveau est resté à "1ère", Mon Cahier IA
  // doit raisonner Terminale/BAC et signaler le périmètre réel de la classe.
  if (/\b(tle|terminale|terminal)\b/.test(labelText)) return "Terminale";
  if (/\b(3e|3eme|troisieme)\b/.test(labelText)) return "3e";
  if (/\b(2nde|2de|seconde)\b/.test(labelText)) return "2nde";
  if (/\b(1ere|1re|premiere)\b/.test(labelText)) return "1ère";
  if (/\b(6e|6eme|sixieme)\b/.test(labelText)) return "6e";
  if (/\b(5e|5eme|cinquieme)\b/.test(labelText)) return "5e";
  if (/\b(4e|4eme|quatrieme)\b/.test(labelText)) return "4e";

  return fallbackText || null;
}

function normalizeClassRow(cls: ClassRow): ClassRow {
  return {
    ...cls,
    level: inferLevelFromClassLabel(cls.label, cls.level),
  };
}

function chooseOfficialAverage(avg: OfficialBulletinAverage | undefined): number | null {
  if (!avg) return null;
  return avg.annual_avg_20 ?? avg.general_avg_20 ?? null;
}

function computeOfficialBaselineSuccess(args: {
  official_avg_20: number;
  core_avg_20?: number | null;
  presence_rate?: number | null;
  conduct_total_20?: number | null;
  total_absent_hours?: number | null;
  nb_lates?: number | null;
  core_completion_percent: number;
}): number {
  const avg = clamp(Number(args.official_avg_20), 0, 20);
  const core = args.core_avg_20 == null ? avg : clamp(Number(args.core_avg_20), 0, 20);
  const presence = args.presence_rate == null ? 0.92 : clamp(Number(args.presence_rate), 0, 1);
  const conduct = args.conduct_total_20 == null ? 14 : clamp(Number(args.conduct_total_20), 0, 20);
  const abs = args.total_absent_hours == null ? 0 : Math.max(0, Number(args.total_absent_hours));
  const lates = args.nb_lates == null ? 0 : Math.max(0, Number(args.nb_lates));
  const completion = clamp(Number(args.core_completion_percent), 0, 100);

  const avgComponent = (avg - 6) / 12;
  const coreAdjustment = (core - avg) / 60;
  const presenceAdjustment = (presence - 0.9) * 0.18;
  const conductAdjustment = (conduct - 12) / 120;
  const behaviorPenalty = Math.min(0.12, abs / 220 + lates / 180);
  const completionAdjustment = (completion - 60) / 500;

  return clamp(
    avgComponent + coreAdjustment + presenceAdjustment + conductAdjustment + completionAdjustment - behaviorPenalty,
    0.03,
    0.97,
  );
}

function pickTargetPeriod(periods: GradePeriodRow[], examDate: string): GradePeriodRow | null {
  if (!periods.length) return null;
  const target = String(examDate || "").slice(0, 10);

  const containing = periods.find((period) => {
    const start = String(period.start_date || "").slice(0, 10);
    const end = String(period.end_date || "").slice(0, 10);
    return start && end && start <= target && target <= end;
  });
  if (containing) return containing;

  const beforeOrEqual = periods
    .filter((period) => String(period.end_date || "").slice(0, 10) <= target)
    .sort((a, b) => String(a.end_date || "").localeCompare(String(b.end_date || "")));
  if (beforeOrEqual.length) return beforeOrEqual[beforeOrEqual.length - 1];

  return periods[periods.length - 1];
}

async function getAdminContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return { error: "unauthorized" as const, status: 401 as const };

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return { error: meErr.message, status: 400 as const };

  const institution_id = (me?.institution_id as string) || null;
  if (!institution_id) return { error: "no_institution", status: 400 as const };

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  const role = ((roleRow?.role as Role | undefined) || "") as Role;
  if (!["admin", "super_admin", "educator"].includes(role)) {
    return { error: "forbidden", status: 403 as const };
  }

  return { supa, srv, user, institution_id, role };
}

async function callMlService(args: {
  institution_id: string;
  academic_year: string;
  exam_date: string;
  core_completion_percent: number;
  rows: PredictionRow[];
}): Promise<{ source: "rules_baseline" | "ml_service" | "hybrid"; version: string; byId: Map<string, { p_success: number; risk_level?: string }> }> {
  const empty = new Map<string, { p_success: number; risk_level?: string }>();
  if (!AI_SERVICE_URL || !args.rows.length) {
    return { source: "rules_baseline", version: MODEL_VERSION, byId: empty };
  }

  try {
    const endpoint = AI_SERVICE_URL.endsWith("/predict") ? AI_SERVICE_URL : `${AI_SERVICE_URL.replace(/\/$/, "")}/predict`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        institution_id: args.institution_id,
        academic_year: args.academic_year,
        exam_date: args.exam_date,
        core_completion_percent: args.core_completion_percent,
        students: args.rows.map((row) => ({
          student_id: row.student_id,
          features: {
            general_avg_20: row.general_avg_20,
            raw_all_avg_20: row.raw_all_avg_20,
            raw_core_avg_20: row.raw_core_avg_20,
            presence_rate: row.presence_rate,
            total_absent_hours: row.total_absent_hours,
            nb_lates: row.nb_lates,
            conduct_total_20: row.conduct_total_20,
            conduct_norm: row.conduct_norm,
            core_completion_percent: args.core_completion_percent,
          },
        })),
      }),
    });

    if (!res.ok) return { source: "rules_baseline", version: MODEL_VERSION, byId: empty };

    const json = (await res.json().catch(() => null)) as any;
    if (!json || !Array.isArray(json.students)) {
      return { source: "rules_baseline", version: MODEL_VERSION, byId: empty };
    }

    const modelSource = String(json.model_source || "").toLowerCase();
    const modelVersion = String(json.model_version || json.version || MODEL_VERSION);

    // Très important : quand le service Python n'a pas encore de modèle entraîné,
    // il renvoie un fallback de règles. On ne doit pas présenter ce fallback comme
    // un vrai modèle ML ni écraser les moyennes officielles du bulletin avec lui.
    if (modelSource !== "ml_service" || modelVersion.includes("rules-fallback")) {
      return { source: "rules_baseline", version: modelVersion, byId: empty };
    }

    const byId = new Map<string, { p_success: number; risk_level?: string }>();
    for (const item of json.students) {
      const studentId = String(item?.student_id || "").trim();
      const p = Number(item?.p_success);
      if (!studentId || !Number.isFinite(p)) continue;
      byId.set(studentId, {
        p_success: clamp(p, 0, 1),
        risk_level: item?.risk_level ? String(item.risk_level) : undefined,
      });
    }

    return {
      source: byId.size ? "ml_service" : "rules_baseline",
      version: modelVersion,
      byId,
    };
  } catch {
    return { source: "rules_baseline", version: MODEL_VERSION, byId: empty };
  }
}


function buildScopeMismatchAnswer(args: {
  selectedScope: string;
  questionScope: string;
  academic_year: string;
}) {
  return {
    intent: "general_analysis",
    title: "Question incompatible avec les filtres choisis",
    summary: `Les filtres ciblent ${args.selectedScope}, mais la question vise ${args.questionScope}. Pour éviter une analyse confuse, Mon Cahier IA ne mélange pas deux niveaux ou deux classes différents.`,
    confidence: 95,
    recommendations: [
      "Choisir le niveau ou la classe correspondant à la question posée.",
      "Ou remettre la classe et le niveau sur “Tous” si la question doit laisser Mon Cahier IA sélectionner le bon périmètre.",
      "Exemple : pour le BEPC, choisir un niveau de 3e ou toutes les classes, puis relancer l’analyse.",
    ],
    students_to_follow: [],
    classes_at_risk: [],
    blocking_subjects: [],
    model: { key: MODEL_KEY, version: MODEL_VERSION, source: "rules_baseline" as const },
    ethics_notice:
      "Mon Cahier IA refuse de mélanger un filtre et une question contradictoires afin de produire une aide à la décision fiable.",
  };
}

function normalizeScopeLabel(value: string | null | undefined) {
  const text = String(value || "").trim();
  return text || "le périmètre choisi";
}

function buildMlRowsWithOfficialAverages(rows: PredictionRow[], officialAverages: Map<string, OfficialBulletinAverage>): PredictionRow[] {
  return rows.map((row) => {
    const official = chooseOfficialAverage(officialAverages.get(row.student_id));
    if (official == null) return row;
    return {
      ...row,
      general_avg_20: round2(official),
      raw_all_avg_20: round2(official),
    };
  });
}

async function loadClasses(args: {
  srv: any;
  institution_id: string;
  academic_year: string;
  class_id: string | null;
  levelHint: string | null;
}) {
  let query = args.srv
    .from("classes")
    .select("id,label,level,academic_year,institution_id")
    .eq("institution_id", args.institution_id)
    .order("level", { ascending: true })
    .order("label", { ascending: true });

  if (args.academic_year) query = query.eq("academic_year", args.academic_year);
  if (args.class_id) query = query.eq("id", args.class_id);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let classes = ((data || []) as ClassRow[]).filter((cls) => cls.id).map(normalizeClassRow);
  if (args.levelHint) {
    const filtered = classes.filter((cls) => levelMatches(cls.level, args.levelHint));
    if (filtered.length) classes = filtered;
  }

  return classes.slice(0, 80);
}

async function loadOfficialBulletinAverages(args: {
  req: NextRequest;
  srv: any;
  institution_id: string;
  classes: ClassRow[];
  academic_year: string;
  exam_date: string;
  warnings: string[];
}): Promise<Map<string, OfficialBulletinAverage>> {
  const out = new Map<string, OfficialBulletinAverage>();
  if (!args.classes.length) return out;

  const { data: periodsData, error: periodsError } = await args.srv
    .from("grade_periods")
    .select("id,code,label,short_label,academic_year,start_date,end_date,coeff")
    .eq("institution_id", args.institution_id)
    .eq("academic_year", args.academic_year)
    .order("start_date", { ascending: true });

  if (periodsError) {
    args.warnings.push(`Moyennes bulletin indisponibles : ${periodsError.message}`);
    return out;
  }

  const periods = ((periodsData || []) as GradePeriodRow[]).filter((period) => period.start_date && period.end_date);
  const targetPeriod = pickTargetPeriod(periods, args.exam_date);

  if (!targetPeriod) {
    args.warnings.push("Moyennes bulletin indisponibles : aucune période de bulletin trouvée pour l'année scolaire.");
    return out;
  }

  const origin = args.req.nextUrl.origin;
  const cookie = args.req.headers.get("cookie") || "";
  const authorization = args.req.headers.get("authorization") || "";

  for (const cls of args.classes) {
    try {
      const url = new URL("/api/admin/grades/bulletin", origin);
      url.searchParams.set("class_id", cls.id);
      url.searchParams.set("from", String(targetPeriod.start_date).slice(0, 10));
      url.searchParams.set("to", String(targetPeriod.end_date).slice(0, 10));
      url.searchParams.set("export_light", "1");

      const res = await fetch(url.toString(), {
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(authorization ? { authorization } : {}),
        },
        cache: "no-store",
      });

      if (!res.ok) {
        args.warnings.push(`Moyenne bulletin non chargée pour ${cls.label || "une classe"} : HTTP ${res.status}`);
        continue;
      }

      const json = (await res.json().catch(() => null)) as any;
      const items = Array.isArray(json?.items) ? json.items : [];

      for (const item of items) {
        const studentId = String(item?.student_id || "").trim();
        if (!studentId) continue;

        const annualAvg = cleanNumberOrNull(item?.annual_avg, 4);
        const periodAvg = cleanNumberOrNull(item?.general_avg, 4);
        out.set(studentId, {
          student_id: studentId,
          general_avg_20: periodAvg,
          annual_avg_20: annualAvg,
          rank: item?.rank == null ? null : Number(item.rank),
          annual_rank: item?.annual_rank == null ? null : Number(item.annual_rank),
          status: String(item?.annual_avg_status || item?.general_avg_status || "").trim() || null,
          source_period: {
            from: String(targetPeriod.start_date).slice(0, 10),
            to: String(targetPeriod.end_date).slice(0, 10),
            label: targetPeriod.label || targetPeriod.short_label || null,
            code: targetPeriod.code || null,
          },
        });
      }
    } catch (err: any) {
      args.warnings.push(`Moyenne bulletin non chargée pour ${cls.label || "une classe"} : ${err?.message || "erreur"}`);
    }
  }

  return out;
}

async function loadPredictionRows(args: {
  srv: any;
  institution_id: string;
  classes: ClassRow[];
  academic_year: string;
  exam_date: string;
  core_completion_percent: number;
}) {
  const rows: PredictionRow[] = [];
  const warnings: string[] = [];

  for (const cls of args.classes) {
    const { data, error } = await args.srv.rpc("predict_success_for_class", {
      p_institution_id: args.institution_id,
      p_class_id: cls.id,
      p_academic_year: args.academic_year,
      p_exam_date: args.exam_date,
      p_core_completion_percent: args.core_completion_percent,
    });

    if (error) {
      warnings.push(`Prédiction indisponible pour ${cls.label || "une classe"} : ${error.message}`);
      continue;
    }

    for (const row of (data || []) as PredictionRow[]) {
      rows.push({
        ...row,
        class_id: String(row.class_id || cls.id),
        class_label: row.class_label || cls.label || "Classe",
        class_level: row.class_level || cls.level || null,
      });
    }
  }

  return { rows, warnings };
}

function buildClassSignals(classes: ClassRow[], students: AiStudentSignal[]): AiClassSignal[] {
  const byClass = new Map<string, AiStudentSignal[]>();
  for (const st of students) {
    const bucket = byClass.get(st.class_id) || [];
    bucket.push(st);
    byClass.set(st.class_id, bucket);
  }

  return classes.map((cls) => {
    const bucket = byClass.get(cls.id) || [];

    if (!bucket.length) {
      return {
        class_id: cls.id,
        class_label: cls.label || "Classe",
        class_level: cls.level || null,
        students_count: 0,
        avg_success_probability: null,
        avg_general_20: null,
        high_risk_count: 0,
        medium_risk_count: 0,
        low_risk_count: 0,
        risk_index: 0,
        main_reasons: ["données insuffisantes"],
      };
    }

    const high = bucket.filter((s) => s.risk_level === "high").length;
    const medium = bucket.filter((s) => s.risk_level === "medium").length;
    const low = bucket.filter((s) => s.risk_level === "low").length;
    const avgSuccess = bucket.length
      ? bucket.reduce((acc, s) => acc + (s.p_success ?? 0), 0) / bucket.length
      : null;
    const avgGeneral = bucket.filter((s) => s.general_avg_20 != null).length
      ? bucket.reduce((acc, s) => acc + (s.general_avg_20 ?? 0), 0) /
        bucket.filter((s) => s.general_avg_20 != null).length
      : null;
    const riskIndex = Math.round(
      clamp(
        (avgSuccess == null ? 0 : (1 - avgSuccess) * 55) +
          (high / bucket.length) * 25 +
          (medium / bucket.length) * 12 +
          (avgGeneral == null ? 0 : Math.max(0, (12 - avgGeneral) / 12) * 20),
        0,
        100,
      ),
    );

    const signal: AiClassSignal = {
      class_id: cls.id,
      class_label: cls.label || "Classe",
      class_level: cls.level || null,
      students_count: bucket.length,
      avg_success_probability: avgSuccess == null ? null : round2(avgSuccess),
      avg_general_20: avgGeneral == null ? null : round2(avgGeneral),
      high_risk_count: high,
      medium_risk_count: medium,
      low_risk_count: low,
      risk_index: riskIndex,
      main_reasons: [],
    };

    signal.main_reasons = summarizeClassReasons(signal);
    return signal;
  });
}

async function loadSubjectSignals(args: {
  srv: any;
  classSignals: AiClassSignal[];
  academic_year: string;
}): Promise<{ subjects: AiSubjectSignal[]; stats: SubjectAvailabilityStats }> {
  const empty = {
    subjects: [] as AiSubjectSignal[],
    stats: { published_evaluations_count: 0, notes_count: 0, evaluated_subjects_count: 0 },
  };
  const classIds = args.classSignals.map((c) => c.class_id).filter(Boolean);
  if (!classIds.length) return empty;

  const evalRows: EvalRow[] = [];
  for (const part of chunks(classIds, 80)) {
    const { data, error } = await args.srv
      .from("grade_evaluations")
      .select("id,class_id,subject_id,eval_date,eval_kind,scale,coeff,is_published")
      .in("class_id", part)
      .eq("academic_year", args.academic_year)
      .eq("is_published", true);

    if (error) throw new Error(error.message);
    evalRows.push(...((data || []) as EvalRow[]));
  }

  const evalIds = evalRows.map((e) => e.id).filter(Boolean);
  const markRows: MarkRow[] = [];
  for (const part of chunks(evalIds, 500)) {
    const { data, error } = await args.srv
      .from("grade_flat_marks")
      .select("evaluation_id,student_id,raw_score,mark_20")
      .in("evaluation_id", part);

    if (error) throw new Error(error.message);
    markRows.push(...((data || []) as MarkRow[]));
  }

  const subjectIds = Array.from(new Set(evalRows.map((e) => e.subject_id).filter(Boolean) as string[]));
  const subjectsById = new Map<string, string>();

  for (const part of chunks(subjectIds, 500)) {
    const { data } = await args.srv.from("subjects").select("id,name,code").in("id", part);
    for (const row of data || []) {
      subjectsById.set(String((row as any).id), String((row as any).name || (row as any).code || "Matière"));
    }
  }

  const evalById = new Map<string, EvalRow>();
  for (const ev of evalRows) evalById.set(ev.id, ev);

  type Acc = {
    class_id: string;
    subject_id: string;
    evaluations: Set<string>;
    notes_count: number;
    weighted_sum: number;
    weight_total: number;
    weak_students: Set<string>;
  };

  const accByKey = new Map<string, Acc>();

  function ensure(ev: EvalRow) {
    const subjectId = String(ev.subject_id || "").trim();
    if (!subjectId) return null;
    const key = `${ev.class_id}::${subjectId}`;
    let acc = accByKey.get(key);
    if (!acc) {
      acc = {
        class_id: ev.class_id,
        subject_id: subjectId,
        evaluations: new Set<string>(),
        notes_count: 0,
        weighted_sum: 0,
        weight_total: 0,
        weak_students: new Set<string>(),
      };
      accByKey.set(key, acc);
    }
    acc.evaluations.add(ev.id);
    return acc;
  }

  for (const ev of evalRows) ensure(ev);

  for (const mark of markRows) {
    const ev = evalById.get(mark.evaluation_id);
    if (!ev) continue;
    const acc = ensure(ev);
    if (!acc) continue;

    const scale = Number(ev.scale || 20);
    const coeff = Number(ev.coeff || 1);
    const raw = mark.mark_20 != null ? Number(mark.mark_20) : mark.raw_score != null && scale > 0 ? (Number(mark.raw_score) / scale) * 20 : NaN;
    if (!Number.isFinite(raw)) continue;

    acc.notes_count += 1;
    acc.weighted_sum += raw * (Number.isFinite(coeff) && coeff > 0 ? coeff : 1);
    acc.weight_total += Number.isFinite(coeff) && coeff > 0 ? coeff : 1;
    if (raw < 10 && mark.student_id) acc.weak_students.add(String(mark.student_id));
  }

  const classMeta = new Map(args.classSignals.map((cls) => [cls.class_id, cls]));
  const out: AiSubjectSignal[] = [];

  for (const acc of accByKey.values()) {
    const cls = classMeta.get(acc.class_id);
    const avg = acc.weight_total > 0 ? acc.weighted_sum / acc.weight_total : null;
    const weakRatio = acc.notes_count ? acc.weak_students.size / Math.max(1, cls?.students_count || acc.notes_count) : 0;
    const blockerScore = Math.round(
      clamp(
        (avg == null ? 25 : Math.max(0, (12 - avg) / 12) * 65) +
          weakRatio * 25 +
          (acc.evaluations.size < 2 ? 10 : 0),
        0,
        100,
      ),
    );

    out.push({
      class_id: acc.class_id,
      class_label: cls?.class_label || "Classe",
      class_level: cls?.class_level || null,
      subject_id: acc.subject_id,
      subject_name: subjectsById.get(acc.subject_id) || "Matière",
      evaluations_count: acc.evaluations.size,
      notes_count: acc.notes_count,
      avg_score_20: avg == null ? null : round2(avg),
      weak_students_count: acc.weak_students.size,
      blocker_score: blockerScore,
    });
  }

  const stats: SubjectAvailabilityStats = {
    published_evaluations_count: evalRows.length,
    notes_count: markRows.length,
    evaluated_subjects_count: subjectIds.length,
  };

  return {
    subjects: out.filter((s) => s.blocker_score >= 35).sort((a, b) => b.blocker_score - a.blocker_score),
    stats,
  };
}


function qualityStatus(ratio: number): AiDataQualityItem["status"] {
  if (ratio >= 0.8) return "ok";
  if (ratio >= 0.45) return "partial";
  return "missing";
}

function qualityItem(args: {
  key: string;
  label: string;
  ratio: number;
  weight: number;
  details: string;
}): AiDataQualityItem & { weighted: number } {
  const ratio = clamp(args.ratio, 0, 1);
  return {
    key: args.key,
    label: args.label,
    status: qualityStatus(ratio),
    score: Math.round(ratio * 100),
    details: args.details,
    weighted: ratio * args.weight,
  };
}

function buildDataQuality(args: {
  classes: ClassRow[];
  predictionRows: PredictionRow[];
  students: AiStudentSignal[];
  officialAverages: Map<string, OfficialBulletinAverage>;
  subjectStats: SubjectAvailabilityStats;
  core_completion_percent: number;
  model_source: MonCahierAiContext["model_source"];
  warnings: string[];
}): AiDataQuality {
  const totalStudents = args.students.length;
  const totalRows = args.predictionRows.length;
  const safeStudents = Math.max(1, totalStudents);

  const officialAvgCount = args.students.filter((s) => s.general_avg_20 != null).length;
  const predictionCount = args.students.filter((s) => s.p_success != null).length;
  const assiduityCount = args.students.filter(
    (s) => s.presence_rate != null || s.total_absent_hours != null || s.nb_lates != null,
  ).length;
  const conductCount = args.students.filter((s) => s.conduct_total_20 != null).length;

  const itemsWithWeight = [
    qualityItem({
      key: "classes",
      label: "Périmètre analysé",
      ratio: args.classes.length > 0 ? 1 : 0,
      weight: 10,
      details: `${args.classes.length} classe${args.classes.length > 1 ? "s" : ""} dans le périmètre choisi.`,
    }),
    qualityItem({
      key: "students",
      label: "Élèves analysés",
      ratio: totalStudents > 0 ? 1 : 0,
      weight: 15,
      details: `${totalStudents} élève${totalStudents > 1 ? "s" : ""} analysé${totalStudents > 1 ? "s" : ""}.`,
    }),
    qualityItem({
      key: "bulletin_averages",
      label: "Moyennes bulletin",
      ratio: totalStudents > 0 ? officialAvgCount / safeStudents : 0,
      weight: 25,
      details: `${officialAvgCount}/${totalStudents} moyenne${officialAvgCount > 1 ? "s" : ""} officielle${officialAvgCount > 1 ? "s" : ""} retrouvée${officialAvgCount > 1 ? "s" : ""}.`,
    }),
    qualityItem({
      key: "prediction_engine",
      label: "Moteur prédictif",
      ratio: totalRows > 0 ? predictionCount / Math.max(1, totalRows) : 0,
      weight: 12,
      details: `${predictionCount}/${Math.max(totalRows, totalStudents)} indice${predictionCount > 1 ? "s" : ""} de préparation exploitable${predictionCount > 1 ? "s" : ""}.`,
    }),
    qualityItem({
      key: "marks_subjects",
      label: "Notes et matières",
      ratio: args.subjectStats.published_evaluations_count > 0 && args.subjectStats.notes_count > 0 ? 1 : 0,
      weight: 12,
      details: `${args.subjectStats.published_evaluations_count} évaluation${args.subjectStats.published_evaluations_count > 1 ? "s" : ""} publiée${args.subjectStats.published_evaluations_count > 1 ? "s" : ""}, ${args.subjectStats.notes_count} note${args.subjectStats.notes_count > 1 ? "s" : ""}, ${args.subjectStats.evaluated_subjects_count} matière${args.subjectStats.evaluated_subjects_count > 1 ? "s" : ""}.`,
    }),
    qualityItem({
      key: "assiduity",
      label: "Assiduité",
      ratio: totalStudents > 0 ? assiduityCount / safeStudents : 0,
      weight: 10,
      details: `${assiduityCount}/${totalStudents} élève${assiduityCount > 1 ? "s" : ""} avec signaux d’absence/retard exploitables.`,
    }),
    qualityItem({
      key: "conduct",
      label: "Conduite",
      ratio: totalStudents > 0 ? conductCount / safeStudents : 0,
      weight: 8,
      details: `${conductCount}/${totalStudents} élève${conductCount > 1 ? "s" : ""} avec conduite exploitable.`,
    }),
    qualityItem({
      key: "progression",
      label: "Progression programme",
      ratio: clamp(args.core_completion_percent / 100, 0, 1),
      weight: 8,
      details: `Progression déclarée : ${Math.round(args.core_completion_percent)}%.`,
    }),
  ];

  const weightedScore = Math.round(
    clamp(
      itemsWithWeight.reduce((acc, item) => acc + item.weighted, 0),
      0,
      100,
    ),
  );

  const status: AiDataQuality["status"] = weightedScore >= 75 ? "ok" : weightedScore >= 50 ? "partial" : "missing";

  if (totalStudents === 0) args.warnings.push("Qualité des données : aucun élève analysé dans le périmètre choisi.");
  if (totalStudents > 0 && officialAvgCount / safeStudents < 0.5) {
    args.warnings.push("Qualité des données : moins de la moitié des moyennes bulletin officielles ont été retrouvées.");
  }
  if (args.subjectStats.published_evaluations_count === 0) {
    args.warnings.push("Qualité des données : aucune évaluation publiée trouvée pour les matières du périmètre.");
  }
  if (args.model_source !== "ml_service") {
    args.warnings.push("Modèle ML non entraîné : analyse basée sur le socle explicable intégré.");
  }

  const summary =
    status === "ok"
      ? "Les données sont suffisamment complètes pour une analyse pédagogique fiable."
      : status === "partial"
        ? "Les données permettent une analyse utile, mais certaines sources doivent être complétées avant une décision forte."
        : "Les données sont insuffisantes : Mon Cahier IA peut orienter les vérifications, mais ne doit pas être utilisé pour conclure.";

  return {
    score: weightedScore,
    status,
    summary,
    items: itemsWithWeight.map(({ weighted, ...item }) => item),
  };
}


async function saveRunAndStudents(args: {
  srv: any;
  institution_id: string;
  user_id: string;
  class_id: string | null;
  academic_year: string;
  exam_date: string;
  core_completion_percent: number;
  question: string;
  answer: any;
  context: MonCahierAiContext;
}) {
  try {
    const { data: run, error: runErr } = await args.srv
      .from("ai_prediction_runs")
      .insert({
        institution_id: args.institution_id,
        academic_year: args.academic_year,
        class_id: args.class_id || null,
        requested_by: args.user_id,
        model_key: args.context.model_key,
        model_version: args.context.model_version,
        model_source: args.context.model_source,
        question: args.question,
        intent: args.answer?.intent || null,
        exam_date: args.exam_date,
        core_completion_percent: args.core_completion_percent,
        classes_count: args.context.classes.length,
        students_count: args.context.students.length,
        warnings_json: args.context.warnings,
      })
      .select("id")
      .maybeSingle();

    if (runErr || !run?.id) return;

    const rows = args.context.students.slice(0, 2000).map((student) => ({
      run_id: run.id,
      institution_id: args.institution_id,
      academic_year: args.academic_year,
      class_id: student.class_id,
      student_id: student.student_id,
      predicted_success: student.p_success,
      risk_level: student.risk_level,
      priority_score: student.priority_score,
      features_json: {
        general_avg_20: student.general_avg_20,
        core_avg_20: student.core_avg_20,
        presence_rate: student.presence_rate,
        total_absent_hours: student.total_absent_hours,
        nb_lates: student.nb_lates,
        conduct_total_20: student.conduct_total_20,
        core_completion_percent: args.core_completion_percent,
        average_source: "bulletin_official_or_prediction_fallback",
      },
      reasons_json: student.reasons,
    }));

    for (const part of chunks(rows, 500)) {
      if (part.length) await args.srv.from("ai_prediction_students").insert(part);
    }
  } catch {
    // Tables SQL non installées ou droits manquants : ne bloque pas l'assistant.
  }
}

async function saveInteraction(args: {
  srv: any;
  institution_id: string;
  user_id: string;
  academic_year: string;
  question: string;
  answer: any;
  context: MonCahierAiContext;
}) {
  try {
    await args.srv.from("ai_assistant_interactions").insert({
      institution_id: args.institution_id,
      user_id: args.user_id,
      academic_year: args.academic_year,
      question: args.question,
      intent: args.answer?.intent || null,
      model_key: args.context.model_key,
      model_version: args.context.model_version,
      model_source: args.context.model_source,
      confidence: args.answer?.confidence ?? null,
      answer_json: args.answer,
      context_summary_json: {
        classes_count: args.context.classes.length,
        students_count: args.context.students.length,
        subjects_count: args.context.subjects.length,
        warnings: args.context.warnings,
        data_quality: args.context.data_quality || null,
      },
    });
  } catch {
    // Tables SQL non encore installées : l'assistant reste utilisable.
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAdminContext();
    if ("error" in ctx) {
      return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
    }

    const raw = (await req.json().catch(() => ({}))) as Body;
    const question = String(raw.question || "").trim() || "Résume-moi la situation pédagogique de cette école.";
    const academic_year = String(raw.academic_year || "").trim();
    const exam_date = String(raw.exam_date || "").slice(0, 10);
    const class_id = raw.class_id ? String(raw.class_id).trim() : null;
    const levelHint = raw.level ? String(raw.level).trim() : null;
    const core_completion_percent = clamp(Number(raw.core_completion_percent ?? 60), 0, 100);

    if (!academic_year) {
      return NextResponse.json(
        { ok: false, error: "academic_year_required", message: "L’année scolaire est obligatoire." },
        { status: 400 },
      );
    }

    if (!exam_date || Number.isNaN(new Date(exam_date).getTime())) {
      return NextResponse.json(
        { ok: false, error: "exam_date_required", message: "La date de référence/examen est obligatoire." },
        { status: 400 },
      );
    }

    const questionLevelHint = extractLevelHint(question);

    const selectedClasses = class_id
      ? await loadClasses({
          srv: ctx.srv,
          institution_id: ctx.institution_id,
          academic_year,
          class_id,
          levelHint: null,
        })
      : [];

    const selectedClass = selectedClasses[0] || null;
    const selectedScopeLevel = selectedClass?.level || levelHint || null;

    if (questionLevelHint && selectedScopeLevel && !levelMatches(selectedScopeLevel, questionLevelHint)) {
      const answer = buildScopeMismatchAnswer({
        selectedScope: selectedClass
          ? `${selectedClass.label || "la classe sélectionnée"}${selectedClass.level ? ` (${selectedClass.level})` : ""}`
          : `le niveau ${normalizeScopeLabel(selectedScopeLevel)}`,
        questionScope: questionLevelHint.toLowerCase() === "3e"
          ? "la 3e / le BEPC"
          : questionLevelHint.toLowerCase().includes("tle") || questionLevelHint.toLowerCase().includes("terminale")
            ? "la Terminale / le BAC"
            : `le niveau ${questionLevelHint}`,
        academic_year,
      });

      return NextResponse.json({
        ok: true,
        answer,
        context_meta: {
          classes_count: 0,
          students_count: 0,
          subjects_count: 0,
          warnings: [answer.summary],
          model_source: "rules_baseline",
          model_version: MODEL_VERSION,
        },
      });
    }

    const scopeLevelHint = class_id ? null : levelHint || questionLevelHint;

    const classes = class_id
      ? selectedClasses
      : await loadClasses({
          srv: ctx.srv,
          institution_id: ctx.institution_id,
          academic_year,
          class_id,
          levelHint: scopeLevelHint,
        });

    if (!classes.length) {
      return NextResponse.json({
        ok: true,
        answer: {
          intent: "general_analysis",
          title: "Aucune classe trouvée",
          summary: "Aucune classe ne correspond aux filtres choisis pour cette année scolaire.",
          confidence: 20,
          recommendations: ["Vérifier l’année scolaire, la classe ou le niveau sélectionné."],
          students_to_follow: [],
          classes_at_risk: [],
          blocking_subjects: [],
          model: { key: MODEL_KEY, version: MODEL_VERSION, source: "rules_baseline" },
          ethics_notice: "Mon Cahier IA est une aide à la décision pédagogique.",
        },
      });
    }

    const predictionResult = await loadPredictionRows({
      srv: ctx.srv,
      institution_id: ctx.institution_id,
      classes,
      academic_year,
      exam_date,
      core_completion_percent,
    });

    const officialAverages = await loadOfficialBulletinAverages({
      req,
      srv: ctx.srv,
      institution_id: ctx.institution_id,
      classes,
      academic_year,
      exam_date,
      warnings: predictionResult.warnings,
    });

    const mlRows = buildMlRowsWithOfficialAverages(predictionResult.rows, officialAverages);

    const ml = await callMlService({
      institution_id: ctx.institution_id,
      academic_year,
      exam_date,
      core_completion_percent,
      rows: mlRows,
    });

    const students: AiStudentSignal[] = predictionResult.rows.map((row) => {
      const mlRow = ml.byId.get(row.student_id);
      const officialAverage = officialAverages.get(row.student_id);
      const officialGeneralAvg = chooseOfficialAverage(officialAverage);
      const general_avg_20 = officialGeneralAvg == null
        ? row.general_avg_20 == null
          ? null
          : round2(Number(row.general_avg_20))
        : round2(officialGeneralAvg);
      const core_avg_20 = row.raw_core_avg_20 == null ? null : round2(Number(row.raw_core_avg_20));
      const conduct_total_20 =
        row.conduct_total_20 == null
          ? row.conduct_norm == null
            ? null
            : round2(Number(row.conduct_norm) * 20)
          : round2(Number(row.conduct_total_20));
      const presence_rate = row.presence_rate == null ? null : round2(Number(row.presence_rate));
      const total_absent_hours = row.total_absent_hours == null ? null : round2(Number(row.total_absent_hours));
      const nb_lates = row.nb_lates == null ? null : Number(row.nb_lates);
      const officialBaselineSuccess = general_avg_20 == null
        ? null
        : computeOfficialBaselineSuccess({
            official_avg_20: general_avg_20,
            core_avg_20,
            presence_rate,
            conduct_total_20,
            total_absent_hours,
            nb_lates,
            core_completion_percent,
          });
      const p_success = mlRow
        ? mlRow.p_success
        : officialBaselineSuccess != null
          ? officialBaselineSuccess
          : row.p_success == null
            ? null
            : clamp(Number(row.p_success), 0, 1);
      const risk_level = normalizeRisk(mlRow?.risk_level, p_success);

      const priority_score = computePriorityScore({
        p_success,
        general_avg_20,
        core_avg_20,
        presence_rate,
        conduct_total_20,
        total_absent_hours,
        nb_lates,
      });

      const reasons = buildStudentReasons({
        p_success,
        general_avg_20,
        core_avg_20,
        presence_rate,
        conduct_total_20,
        total_absent_hours,
        nb_lates,
      });

      return {
        student_id: String(row.student_id),
        full_name: fullName(row),
        matricule: row.matricule || null,
        class_id: String(row.class_id),
        class_label: row.class_label || "Classe",
        class_level: row.class_level || null,
        general_avg_20,
        core_avg_20,
        presence_rate,
        total_absent_hours,
        nb_lates,
        conduct_total_20,
        p_success,
        risk_level,
        priority_score,
        reasons,
      };
    });

    const classSignals = buildClassSignals(classes, students);
    const subjectResult = await loadSubjectSignals({
      srv: ctx.srv,
      classSignals,
      academic_year,
    }).catch((err: any) => {
      predictionResult.warnings.push(`Analyse des matières indisponible : ${err?.message || "erreur"}`);
      return {
        subjects: [] as AiSubjectSignal[],
        stats: { published_evaluations_count: 0, notes_count: 0, evaluated_subjects_count: 0 },
      };
    });

    const dataQuality = buildDataQuality({
      classes,
      predictionRows: predictionResult.rows,
      students,
      officialAverages,
      subjectStats: subjectResult.stats,
      core_completion_percent,
      model_source: ml.source,
      warnings: predictionResult.warnings,
    });

    const aiContext: MonCahierAiContext = {
      institution_id: ctx.institution_id,
      academic_year,
      exam_date,
      model_key: MODEL_KEY,
      model_version: ml.version || MODEL_VERSION,
      model_source: ml.source,
      classes: classSignals,
      students,
      subjects: subjectResult.subjects,
      warnings: predictionResult.warnings,
      data_quality: dataQuality,
    };

    const answer = buildAiAnswer(aiContext, question);
    await saveRunAndStudents({
      srv: ctx.srv,
      institution_id: ctx.institution_id,
      user_id: ctx.user.id,
      class_id,
      academic_year,
      exam_date,
      core_completion_percent,
      question,
      answer,
      context: aiContext,
    });

    await saveInteraction({
      srv: ctx.srv,
      institution_id: ctx.institution_id,
      user_id: ctx.user.id,
      academic_year,
      question,
      answer,
      context: aiContext,
    });

    return NextResponse.json({
      ok: true,
      answer,
      context_meta: {
        classes_count: aiContext.classes.length,
        students_count: aiContext.students.length,
        subjects_count: aiContext.subjects.length,
        warnings: aiContext.warnings,
        model_source: aiContext.model_source,
        model_version: aiContext.model_version,
        data_quality: aiContext.data_quality,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "mon_cahier_ai_assistant_failed" },
      { status: 500 },
    );
  }
}

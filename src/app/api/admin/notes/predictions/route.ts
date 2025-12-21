// src/app/api/admin/notes/predictions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type PredictionBody = {
  class_id?: string;
  academic_year?: string;
  exam_date?: string; // "YYYY-MM-DD"
  key_subjects_coverage?: number; // 0..100
  key_subjects?: Array<{
    subject_id: string;
    name?: string;
    subject_name?: string;
    coeff: number;
    coverage: number;
  }>;
};

type HistRow = {
  institution_id: string;
  student_id: string;
  class_id: string;
  academic_year: string;
  level: string | null;
  period_label: string | null;
  snapshot_date: string;
  general_avg_20: number | null;
  core_avg_20: number | null;
  presence_rate: number | null;
  total_absent_hours: number | null;
  nb_lates: number | null;
  conduct_total_20: number | null;
  bonus_points_total: number | null;
  draft_ratio: number | null;
  class_size: number | null;
  class_level: string | null;
};

type AggregatedFeatures = {
  student_id: string;
  level: string | null;
  current_general_avg_20: number | null;
  current_core_avg_20: number | null;
  current_presence_rate: number | null;
  current_conduct_total_20: number | null;
  current_bonus_points_total: number | null;
  current_draft_ratio: number | null;
  current_class_size: number | null;

  hist_general_avg_mean: number | null;
  hist_general_avg_min: number | null;
  hist_general_avg_max: number | null;

  hist_core_avg_mean: number | null;

  hist_presence_mean: number | null;
  hist_presence_min: number | null;
  hist_presence_max: number | null;

  hist_conduct_mean: number | null;
  hist_bonus_mean: number | null;
  hist_draft_mean: number | null;

  hist_nb_snapshots: number;
};

type RawStudentInfo = {
  student_id: string;
  last_name: string | null;
  first_name: string | null;
  matricule: string | null;
};

type StudentResult = {
  student_id: string;
  full_name: string;
  matricule: string;
  general_avg_20: number | null;

  academic_score: number;
  attendance_score: number;
  conduct_score: number;
  bonus_total: number;
  bonus_score: number;
  draft_ratio: number;
  draft_score: number;

  predicted_success: number;
  risk_label: string;
};

type KeySubjectScore = {
  subject_id: string;
  subject_name: string;
  coeff: number;
  coverage_percent: number;
  coverage_norm: number;
  expected_coverage_norm: number;
  eval_devoir_ratio_norm: number;
  eval_interro_ratio_norm: number;
  eval_volume_norm: number;
  status: string;
};

type PredictionMetrics = {
  class_size: number;
  predicted_success_rate: number;
  average_attendance_score: number;
  bonus_ratio: number;
  average_draft_ratio: number;
  env_size_score: number;
  coverage_score: number;
  env_score: number;
  class_general_avg_20: number | null;
  expected_coverage_percent?: number;
  coverage_gap_percent?: number;
};

type PredictionResponse = {
  ok: boolean;
  class: {
    id: string;
    label?: string | null;
    level?: string | null;
    academic_year?: string | null;
  };
  input: {
    academic_year: string;
    exam_date: string;
    key_subjects_coverage: number;
  };
  metrics: PredictionMetrics;
  recommendations: string[];
  students: StudentResult[];
  key_subjects?: KeySubjectScore[];
};

type SuccessModelRow = {
  model_key: string;
  feature_names: string[];
  weights: number[];
};

const FEATURE_NAMES = [
  "current_general_avg_20_norm",
  "hist_general_avg_mean_norm",
  "current_presence_rate",
  "hist_presence_mean",
  "current_conduct_20_norm",
  "hist_conduct_mean_norm",
  "current_bonus_norm",
  "hist_bonus_mean_norm",
  "current_draft_ratio",
  "hist_draft_mean",
] as const;

function clamp(x: number, min = 0, max = 100) {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function safeNum(v: number | null): number {
  if (v === null || Number.isNaN(v)) return 0;
  return Number(v);
}

function sigmoid(z: number): number {
  if (z < -30) return 0;
  if (z > 30) return 1;
  return 1 / (1 + Math.exp(-z));
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  const s = values.reduce((a, b) => a + b, 0);
  return s / values.length;
}

// même logique de features que dans le script de training
function buildFeatureVectorFromAgg(a: AggregatedFeatures): number[] {
  const curGen = safeNum(a.current_general_avg_20);
  const histGen = safeNum(a.hist_general_avg_mean);
  const curPresence = safeNum(a.current_presence_rate);
  const histPresence = safeNum(a.hist_presence_mean);
  const curConduct = safeNum(a.current_conduct_total_20);
  const histConduct = safeNum(a.hist_conduct_mean);
  const curBonus = safeNum(a.current_bonus_points_total);
  const histBonus = safeNum(a.hist_bonus_mean);
  const curDraft = safeNum(a.current_draft_ratio);
  const histDraft = safeNum(a.hist_draft_mean);

  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

  return [
    clamp01(curGen / 20),
    clamp01(histGen / 20),
    clamp01(curPresence),
    clamp01(histPresence),
    clamp01(curConduct / 20),
    clamp01(histConduct / 20),
    Math.min(1.5, Math.max(0, curBonus / 4)),
    Math.min(1.5, Math.max(0, histBonus / 4)),
    clamp01(curDraft),
    clamp01(histDraft),
  ];
}

function aggregateHistory(rows: HistRow[]): AggregatedFeatures[] {
  const byStudent = new Map<string, HistRow[]>();

  for (const r of rows) {
    const arr = byStudent.get(r.student_id) ?? [];
    arr.push(r);
    byStudent.set(r.student_id, arr);
  }

  const out: AggregatedFeatures[] = [];

  for (const [student_id, arr] of byStudent.entries()) {
    // trier par snapshot_date pour trouver le "current"
    arr.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const last = arr[arr.length - 1];

    const nums = <K extends keyof HistRow>(key: K) =>
      arr
        .map((x) => x[key] as number | null)
        .filter((v): v is number => v !== null && !Number.isNaN(v));

    const genVals = nums("general_avg_20");
    const coreVals = nums("core_avg_20");
    const presVals = nums("presence_rate");
    const condVals = nums("conduct_total_20");
    const bonusVals = nums("bonus_points_total");
    const draftVals = nums("draft_ratio");

    const mean = (xs: number[]) => (xs.length ? avg(xs) : null);
    const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
    const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);

    out.push({
      student_id,
      level: last.level ?? last.class_level,

      current_general_avg_20: last.general_avg_20,
      current_core_avg_20: last.core_avg_20,
      current_presence_rate: last.presence_rate,
      current_conduct_total_20: last.conduct_total_20,
      current_bonus_points_total: last.bonus_points_total,
      current_draft_ratio: last.draft_ratio,
      current_class_size: last.class_size,

      hist_general_avg_mean: mean(genVals),
      hist_general_avg_min: min(genVals),
      hist_general_avg_max: max(genVals),

      hist_core_avg_mean: mean(coreVals),

      hist_presence_mean: mean(presVals),
      hist_presence_min: min(presVals),
      hist_presence_max: max(presVals),

      hist_conduct_mean: mean(condVals),
      hist_bonus_mean: mean(bonusVals),
      hist_draft_mean: mean(draftVals),

      hist_nb_snapshots: arr.length,
    });
  }

  return out;
}

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    // 1) Auth
    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    // 2) Institution
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("id,institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr) {
      return NextResponse.json(
        { ok: false, error: meErr.message },
        { status: 400 }
      );
    }

    const institution_id = (me?.institution_id as string) || null;
    if (!institution_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_institution",
          message: "Aucune institution associée à ce compte.",
        },
        { status: 400 }
      );
    }

    // 3) Rôle
    const { data: roleRow } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id)
      .maybeSingle();

    const role = (roleRow?.role as Role | undefined) || "";
    if (!["admin", "super_admin"].includes(role)) {
      return NextResponse.json(
        {
          ok: false,
          error: "forbidden",
          message: "Droits insuffisants pour lancer une prédiction.",
        },
        { status: 403 }
      );
    }

    // 4) Body
    const body = (await req.json().catch(() => ({}))) as PredictionBody;

    const class_id = String(body.class_id || "").trim();
    let academic_year = String(body.academic_year || "").trim();
    const exam_date = String(body.exam_date || "").trim();
    const key_subjects_coverage_raw = Number(body.key_subjects_coverage ?? NaN);

    if (!class_id) {
      return NextResponse.json(
        { ok: false, error: "class_id_required", message: "class_id est obligatoire." },
        { status: 400 }
      );
    }
    if (!exam_date) {
      return NextResponse.json(
        {
          ok: false,
          error: "exam_date_required",
          message: "exam_date est obligatoire (YYYY-MM-DD).",
        },
        { status: 400 }
      );
    }

    const coverageScore = clamp(key_subjects_coverage_raw, 0, 100);

    // 5) Classe
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,label,level,academic_year,institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json(
        { ok: false, error: clsErr.message },
        { status: 400 }
      );
    }
    if (!cls) {
      return NextResponse.json(
        { ok: false, error: "class_not_found", message: "Classe introuvable." },
        { status: 404 }
      );
    }
    if (cls.institution_id !== institution_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_class",
          message: "Cette classe n'appartient pas à votre établissement.",
        },
        { status: 400 }
      );
    }

    if (!academic_year) {
      academic_year = String(cls.academic_year || "").trim();
    }
    if (!academic_year) {
      return NextResponse.json(
        {
          ok: false,
          error: "academic_year_required",
          message:
            "Année scolaire inconnue pour cette classe. Vérifiez la configuration des classes.",
        },
        { status: 400 }
      );
    }

    // 6) Année scolaire pour couverture attendue
    const { data: yearRow } = await srv
      .from("academic_years")
      .select("code,start_date,end_date")
      .eq("institution_id", institution_id)
      .eq("code", academic_year)
      .maybeSingle();

    let expectedCoveragePercent: number | undefined = undefined;
    if (yearRow?.start_date && yearRow?.end_date) {
      const start = new Date(yearRow.start_date);
      const end = new Date(yearRow.end_date);
      const exam = new Date(exam_date);

      const totalDays = Math.max(
        0,
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      );
      const elapsedDays = Math.max(
        0,
        (exam.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (totalDays > 0) {
        expectedCoveragePercent = clamp((elapsedDays / totalDays) * 100);
      }
    }
    const envSizeScoreFallback = 70;
    const expectedCoverageNorm =
      expectedCoveragePercent != null ? expectedCoveragePercent / 100 : coverageScore / 100;

    // 7) Modèle ML
    const { data: modelRow, error: modelErr } = await srv
      .from("ml_success_models")
      .select("model_key,feature_names,weights")
      .eq("model_key", "global_v1")
      .maybeSingle();

    if (modelErr) {
      return NextResponse.json(
        { ok: false, error: modelErr.message },
        { status: 400 }
      );
    }
    if (!modelRow) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_model",
          message:
            "Aucun modèle ML enregistré (ml_success_models). Lance d'abord le script de training.",
        },
        { status: 500 }
      );
    }

    const model = modelRow as SuccessModelRow;
    if (!model.weights || model.weights.length !== FEATURE_NAMES.length + 1) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_model",
          message:
            "Le modèle ML enregistré n'est pas cohérent avec la configuration des features.",
        },
        { status: 500 }
      );
    }

    // 8) Historique des features pour la classe
    const { data: histRowsRaw, error: histErr } = await srv
      .from("ml_student_features_history")
      .select(
        "institution_id,student_id,class_id,academic_year,level,period_label,snapshot_date,general_avg_20,core_avg_20,presence_rate,total_absent_hours,nb_lates,conduct_total_20,bonus_points_total,draft_ratio,class_size,class_level"
      )
      .eq("institution_id", institution_id)
      .eq("class_id", class_id)
      .eq("academic_year", academic_year)
      .lte("snapshot_date", exam_date);

    if (histErr) {
      return NextResponse.json(
        { ok: false, error: histErr.message },
        { status: 400 }
      );
    }

    const histRows = (histRowsRaw || []) as HistRow[];

    if (!histRows.length) {
      return NextResponse.json({
        ok: true,
        class: {
          id: class_id,
          label: (cls as any).label ?? null,
          level: (cls as any).level ?? null,
          academic_year,
        },
        input: {
          academic_year,
          exam_date,
          key_subjects_coverage: coverageScore,
        },
        metrics: {
          class_size: 0,
          predicted_success_rate: 0,
          average_attendance_score: 0,
          bonus_ratio: 0,
          average_draft_ratio: 0,
          env_size_score: envSizeScoreFallback,
          coverage_score: coverageScore,
          env_score: coverageScore, // à défaut
          class_general_avg_20: null,
          expected_coverage_percent: expectedCoveragePercent,
          coverage_gap_percent:
            expectedCoveragePercent != null
              ? coverageScore - expectedCoveragePercent
              : undefined,
        },
        recommendations: [
          "Aucun historique de notes/assiduité trouvé pour cette classe. Enregistrez d'abord des évaluations et des relevés d'absence."
        ],
        students: [],
        key_subjects: [],
      });
    }

    const agg = aggregateHistory(histRows);

    // 9) Infos identité élèves (noms, matricule)
    const studentIds = agg.map((a) => a.student_id);
    const { data: identityRows, error: idErr } = await srv
      .from("students")
      .select("id,last_name,first_name,matricule")
      .in("id", studentIds);

    if (idErr) {
      return NextResponse.json(
        { ok: false, error: idErr.message },
        { status: 400 }
      );
    }

    const idMap = new Map<string, RawStudentInfo>();
    for (const r of identityRows || []) {
      idMap.set(r.id as string, {
        student_id: r.id as string,
        last_name: r.last_name as string | null,
        first_name: r.first_name as string | null,
        matricule: r.matricule as string | null,
      });
    }

    // 10) Application du modèle ML à chaque élève
    const weights = model.weights; // w[0] = biais, w[1..] = poids

    const students: StudentResult[] = agg.map((a) => {
      const fv = buildFeatureVectorFromAgg(a);
      let z = weights[0];
      for (let j = 0; j < fv.length; j++) {
        z += weights[j + 1] * fv[j];
      }
      const p = sigmoid(z); // 0..1
      const predicted_success = clamp(p * 100);

      const general = safeNum(a.current_general_avg_20);
      const presence = safeNum(a.current_presence_rate);
      const conduct = safeNum(a.current_conduct_total_20);
      const bonus = safeNum(a.current_bonus_points_total);
      const draft = safeNum(a.current_draft_ratio);

      const academicScore = clamp((general / 20) * 100);
      const attendanceScore = clamp(presence * 100);
      const conductScore = clamp((conduct / 20) * 100);
      const bonusScore = clamp((bonus / 4) * 100);
      const draftScore = clamp((1 - draft) * 100);

      let risk_label = "Risque élevé";
      if (predicted_success >= 70) risk_label = "Faible risque";
      else if (predicted_success >= 50) risk_label = "Risque moyen";

      const ident = idMap.get(a.student_id);
      const fullName = ident
        ? [ident.last_name, ident.first_name].filter(Boolean).join(" ")
        : a.student_id;

      return {
        student_id: a.student_id,
        full_name: fullName || (ident?.matricule ?? a.student_id),
        matricule: ident?.matricule ?? "",
        general_avg_20: a.current_general_avg_20,

        academic_score: academicScore,
        attendance_score: attendanceScore,
        conduct_score: conductScore,
        bonus_total: bonus,
        bonus_score: bonusScore,
        draft_ratio: draft,
        draft_score: draftScore,

        predicted_success,
        risk_label,
      };
    });

    // 11) KPIs de synthèse
    const classSize = agg.length
      ? (safeNum(agg[0].current_class_size) || agg.length)
      : 0;

    const predictedSuccessRate = students.length
      ? avg(students.map((s) => s.predicted_success))
      : 0;

    const averageAttendanceScore = students.length
      ? avg(students.map((s) => s.attendance_score))
      : 0;

    const averageDraftRatio = students.length
      ? avg(students.map((s) => s.draft_ratio))
      : 0;

    const bonusRatio = students.length
      ? avg(students.map((s) => s.bonus_total))
      : 0;

    const classGeneralAvg = agg.length
      ? avg(
          agg
            .map((a) => safeNum(a.current_general_avg_20))
            .filter((x) => Number.isFinite(x))
        )
      : null;

    const env_size_score = agg.length
      ? clamp((safeNum(agg[0].current_class_size) || classSize) <= 30
          ? 100
          : (safeNum(agg[0].current_class_size) || classSize) <= 40
          ? 90
          : (safeNum(agg[0].current_class_size) || classSize) <= 50
          ? 80
          : 70)
      : envSizeScoreFallback;

    const env_score = 0.6 * coverageScore + 0.4 * env_size_score;

    const coverage_gap =
      expectedCoveragePercent != null
        ? coverageScore - expectedCoveragePercent
        : undefined;

    const metrics: PredictionMetrics = {
      class_size: classSize,
      predicted_success_rate: clamp(predictedSuccessRate),
      average_attendance_score: clamp(averageAttendanceScore),
      bonus_ratio: bonusRatio,
      average_draft_ratio: averageDraftRatio,
      env_size_score,
      coverage_score: coverageScore,
      env_score: clamp(env_score),
      class_general_avg_20: classGeneralAvg,
      expected_coverage_percent: expectedCoveragePercent,
      coverage_gap_percent: coverage_gap,
    };

    // 12) Matières clés depuis le body
    const keySubjectsInput = body.key_subjects || [];
    const keySubjects: KeySubjectScore[] = keySubjectsInput.map((s) => {
      const cov = clamp(s.coverage, 0, 100);
      const covNorm = cov / 100;
      let status: "en_retard" | "au_niveau" | "en_bonne_voie" = "au_niveau";

      if (
        expectedCoveragePercent != null &&
        cov < expectedCoveragePercent - 5
      ) {
        status = "en_retard";
      } else if (
        expectedCoveragePercent != null &&
        cov > expectedCoveragePercent + 5
      ) {
        status = "en_bonne_voie";
      }

      return {
        subject_id: s.subject_id,
        subject_name: s.subject_name || s.name || "Discipline",
        coeff: s.coeff,
        coverage_percent: cov,
        coverage_norm: covNorm,
        expected_coverage_norm: expectedCoverageNorm,
        eval_devoir_ratio_norm: 1,
        eval_interro_ratio_norm: 1,
        eval_volume_norm: 1,
        status,
      };
    });

    // 13) Recommandations
    const recommendations: string[] = [];

    if (metrics.predicted_success_rate < 50) {
      recommendations.push(
        "Risque global élevé : mettre en place un plan de soutien intensif (soutien ciblé, devoirs surveillés, remédiation en petits groupes)."
      );
    } else if (metrics.predicted_success_rate < 70) {
      recommendations.push(
        "Niveau global fragile : renforcer le suivi des élèves en risque moyen et multiplier les évaluations formatives."
      );
    } else {
      recommendations.push(
        "Niveau global satisfaisant. Maintenir le rythme et cibler les quelques élèves en risque moyen ou élevé."
      );
    }

    if (metrics.average_attendance_score < 80) {
      recommendations.push(
        "L’assiduité moyenne est insuffisante. Intensifier le contrôle des absences/retards et impliquer les parents."
      );
    }

    if (expectedCoveragePercent != null && coverage_gap != null) {
      if (coverage_gap < -10) {
        recommendations.push(
          "Le programme dans les matières clés est en retard. Réorganiser la progression et prévoir des séances de rattrapage."
        );
      } else if (coverage_gap > 10) {
        recommendations.push(
          "Le programme est en avance. Consolider les acquis par des révisions et des sujets type examen."
        );
      }
    }

    if (metrics.average_draft_ratio > 0.3) {
      recommendations.push(
        "Une part importante des notes est inférieure à la moyenne. Travailler la méthodologie (apprentissage, rédaction, gestion du temps)."
      );
    }

    const resp: PredictionResponse = {
      ok: true,
      class: {
        id: class_id,
        label: (cls as any).label ?? null,
        level: (cls as any).level ?? null,
        academic_year,
      },
      input: {
        academic_year,
        exam_date,
        key_subjects_coverage: coverageScore,
      },
      metrics,
      recommendations,
      students: students.sort(
        (a, b) => b.predicted_success - a.predicted_success
      ),
      key_subjects: keySubjects,
    };

    return NextResponse.json(resp);
  } catch (e: any) {
    console.error("notes/predictions error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "predict_failed" },
      { status: 500 }
    );
  }
}

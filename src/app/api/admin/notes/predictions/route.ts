// src/app/api/admin/notes/predictions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KeySubjectPayload = {
  subject_id: string;
  name?: string;
  coeff?: number;
  coverage?: number;
};

type Body = {
  class_id: string;
  academic_year: string; // ex: "2025-2026"
  exam_date: string; // "YYYY-MM-DD"
  key_subjects_coverage: number; // 0..100 (global matières clés / couverture pondérée)
  key_subject_ids?: string[]; // optionnel
  key_subjects?: KeySubjectPayload[]; // 4 matières clés affichées dans l’UI
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

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function buildRecommendations(args: {
  predictedClass: number;
  coverage: number;
  expectedCoverage: number;
  avgAttendance: number;
  ratioBonus: number;
  avgDraftRatio: number;
  classGeneralAvg20: number | null;
  evalsDevoirRatio: number;
  evalsInterroRatio: number;
  evalsDevoirDone: number;
  evalsInterroDone: number;
  daysToExam: number;
  worstStudents: string[];
}): string[] {
  const recs: string[] = [];
  const {
    predictedClass,
    coverage,
    expectedCoverage,
    avgAttendance,
    ratioBonus,
    avgDraftRatio,
    classGeneralAvg20,
    evalsDevoirRatio,
    evalsInterroRatio,
    evalsDevoirDone,
    evalsInterroDone,
    daysToExam,
    worstStudents,
  } = args;

  // 1) Bilan global : moyenne générale de classe + taux de réussite prédit
  if (classGeneralAvg20 != null) {
    if (classGeneralAvg20 >= 12) {
      recs.push(
        `La moyenne générale de la classe est de ${classGeneralAvg20
          .toFixed(2)
          .replace(
            ".",
            ","
          )}/20 (au-dessus du seuil 12/20). L'objectif est désormais de consolider ce niveau et de réduire l'écart entre les élèves moyens et en difficulté.`
      );
    } else {
      recs.push(
        `La moyenne générale de la classe est de ${classGeneralAvg20
          .toFixed(2)
          .replace(
            ".",
            ","
          )}/20, en dessous du seuil 12/20. Il est nécessaire de mettre en place un plan de remédiation (soutien ciblé, devoirs surveillés, études dirigées).`
      );
    }
  }

  if (predictedClass >= 80) {
    recs.push(
      "La classe présente un bon niveau global. Maintenir le rythme de travail et les évaluations régulières, en particulier pour les élèves moyens afin d’éviter les décrochages de fin d’année."
    );
  } else if (predictedClass >= 60) {
    recs.push(
      "Le niveau global est correct mais fragile. Renforcer le suivi des élèves moyens et organiser des séances de remédiation ciblées avant l’examen."
    );
  } else {
    recs.push(
      "Risque important d'échec pour la classe. Mettre en place un plan d'accompagnement intensif (soutien, devoirs surveillés, études dirigées, suivi individualisé des cas les plus préoccupants)."
    );
  }

  // 2) Couverture du programme vs calendrier (100 % à J–30)
  const coverageGap = coverage - expectedCoverage;

  if (daysToExam <= 30) {
    if (coverage < 100) {
      recs.push(
        `Nous sommes à moins d'un mois de la date d'examen et la couverture du programme dans les matières clés est de ${coverage.toFixed(
          0
        )}%. Elle devrait être à 100% à ce stade : terminer au plus vite les chapitres manquants et privilégier les révisions actives (sujets types, annales, corrections dirigées).`
      );
    } else {
      recs.push(
        `La couverture du programme dans les matières clés est de ${coverage.toFixed(
          0
        )}% à moins d'un mois de l'examen. Concentrer les efforts sur les révisions, la gestion du temps et la préparation aux sujets d’examen.`
      );
    }
  } else {
    if (coverageGap <= -10) {
      recs.push(
        `L'exécution du programme accuse un retard d'environ ${Math.abs(
          coverageGap
        ).toFixed(
          0
        )} points par rapport au planning normal. Revoir la programmation hebdomadaire et augmenter légèrement le rythme dans les matières clés.`
      );
    } else if (coverageGap >= 5) {
      recs.push(
        `L'exécution du programme est en avance par rapport au planning normal (environ +${coverageGap
          .toFixed(0)
          .replace(
            ".",
            ","
          )} points). Profiter de cette marge pour renforcer les révisions et accompagner les élèves les plus fragiles.`
      );
    }
  }

  // 3) Assiduité
  if (avgAttendance < 85) {
    recs.push(
      "Le taux d'assiduité moyen est faible. Renforcer le contrôle des appels, alerter rapidement les parents et envisager des mesures de rappel ou de sanction pédagogique."
    );
  } else if (avgAttendance < 90) {
    recs.push(
      "L'assiduité moyenne est juste. Sensibiliser les élèves et les parents à l’importance de la présence régulière, en ciblant les classes ou matières les plus touchées."
    );
  }

  // 4) Volumes d’évaluations (norme 4 devoirs + 4 interrogations par matière)
  if (evalsDevoirRatio < 0.9 || evalsInterroRatio < 0.9) {
    recs.push(
      `Le volume d'évaluations reste en dessous du rythme conseillé dans les matières clés : environ ${evalsDevoirDone} devoir(s) et ${evalsInterroDone} interrogation(s) réalisés, alors que la norme cible est de 4 devoirs et 4 interrogations par matière. Planifier des évaluations supplémentaires (interrogations courtes, devoirs surveillés) pour mieux étaler la préparation des élèves.`
    );
  } else if (evalsDevoirRatio > 1.2 || evalsInterroRatio > 1.2) {
    recs.push(
      "Le nombre d'évaluations dépasse largement la norme (4 devoirs et 4 interrogations par matière). Veiller à ce que la charge de travail reste supportable et à équilibrer les évaluations sommatives et formatives."
    );
  }

  // 5) Bonus
  if (ratioBonus > 0.3) {
    recs.push(
      "Limiter les ajustements de notes et les bonus : privilégier des évaluations régulières, transparentes et bien réparties dans l’année."
    );
  }

  // 6) Brouillons
  if (avgDraftRatio > 0.2) {
    recs.push(
      "Réduire le nombre de notes conservées au brouillon : publier davantage d'évaluations pour refléter la réalité du travail des élèves et donner de la visibilité aux parents."
    );
  }

  // 7) Élèves les plus à risque
  if (worstStudents.length) {
    recs.push(
      `Surveiller en priorité les élèves suivants : ${worstStudents.join(
        ", "
      )} (risque élevé). Mettre en place un suivi individualisé avec le professeur principal et, si possible, un échange avec les parents.`
    );
  }

  return recs.slice(0, 8);
}

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    const raw = (await req.json().catch(() => ({}))) as Partial<Body>;

    const class_id = String(raw.class_id || "").trim();
    const academic_year = String(raw.academic_year || "").trim();
    const exam_date_raw = String(raw.exam_date || "").slice(0, 10);
    let coverage = Number(raw.key_subjects_coverage);
    if (!Number.isFinite(coverage)) coverage = 60;
    if (coverage < 0) coverage = 0;
    if (coverage > 100) coverage = 100;

    if (!class_id || !academic_year || !exam_date_raw) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_params",
          message: "class_id, academic_year et exam_date sont requis.",
        },
        { status: 400 }
      );
    }

    const examDate = new Date(exam_date_raw);
    if (Number.isNaN(examDate.getTime())) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_exam_date",
          message: "Date d'examen invalide.",
        },
        { status: 400 }
      );
    }

    // Institution de l'utilisateur
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

    // Vérifier rôle admin / super_admin
    const { data: roleRow } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id)
      .maybeSingle();

    const role = (roleRow?.role as string | undefined) || "";
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

    // Vérifier la classe
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
    if (!cls || cls.institution_id !== institution_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_class",
          message: "Classe introuvable pour cette institution.",
        },
        { status: 400 }
      );
    }

    // Année scolaire
    const { data: yearRow, error: yearErr } = await srv
      .from("academic_years")
      .select("id,code,label,start_date,end_date")
      .eq("institution_id", institution_id)
      .eq("code", academic_year)
      .maybeSingle();

    if (yearErr) {
      return NextResponse.json(
        { ok: false, error: yearErr.message },
        { status: 400 }
      );
    }
    if (!yearRow) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_year",
          message: "Année scolaire introuvable pour cette institution.",
        },
        { status: 400 }
      );
    }

    // ─────────────────────────────────────
    //  Calendrier : couverture attendue à la date de la requête
    //  (100% à J–30 par rapport à la date d’examen)
    // ─────────────────────────────────────
    const today = new Date();
    const yearStart = new Date(yearRow.start_date);
    const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
    let finalPrepDate = new Date(examDate.getTime() - oneMonthMs);
    if (Number.isNaN(finalPrepDate.getTime()) || finalPrepDate <= yearStart) {
      finalPrepDate = new Date(examDate.getTime());
    }

    let timelineFactor = 0;
    if (today <= yearStart) {
      timelineFactor = 0;
    } else if (today >= finalPrepDate) {
      timelineFactor = 1;
    } else {
      timelineFactor =
        (today.getTime() - yearStart.getTime()) /
        (finalPrepDate.getTime() - yearStart.getTime());
    }
    if (!Number.isFinite(timelineFactor) || timelineFactor < 0) timelineFactor = 0;
    if (timelineFactor > 1) timelineFactor = 1;

    const expectedCoverage = Math.round(timelineFactor * 100);
    const daysToExam = Math.round(
      (examDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
    );

    // ─────────────────────────────────────
    //  Statistiques d’évaluations dans les matières clés
    //  (norme 4 devoirs + 4 interrogations par matière)
    // ─────────────────────────────────────
    const key_subject_ids_from_ids = Array.isArray(raw.key_subject_ids)
      ? raw.key_subject_ids
      : [];
    const key_subjects_raw = Array.isArray(raw.key_subjects)
      ? raw.key_subjects
      : [];

    let key_subject_ids: string[] = [];

    if (key_subjects_raw.length) {
      key_subject_ids = key_subjects_raw
        .map((s: any) => String((s && s.subject_id) || "").trim())
        .filter((x) => !!x);
    } else if (key_subject_ids_from_ids.length) {
      key_subject_ids = key_subject_ids_from_ids
        .map((x) => String(x || "").trim())
        .filter((x) => !!x);
    }

    const coreSubjectsCount =
      key_subject_ids.length > 0 ? key_subject_ids.length : 4; // fallback 4

    let evalsDevoir = 0;
    let evalsInterro = 0;
    let evalsTotal = 0;

    if (key_subject_ids.length) {
      const { data: evalRows, error: evalErr } = await srv
        .from("grade_evaluations")
        .select("id, eval_kind, subject_id, is_published, eval_date")
        // pas de filtre institution_id : la table ne possède pas cette colonne,
        // et la classe est déjà contrôlée sur l'institution.
        .eq("class_id", class_id)
        .eq("academic_year", academic_year)
        .lte("eval_date", exam_date_raw)
        .in("subject_id", key_subject_ids);

      if (evalErr) {
        return NextResponse.json(
          { ok: false, error: evalErr.message },
          { status: 400 }
        );
      }

      for (const ev of evalRows || []) {
        evalsTotal += 1;
        const kind = String((ev as any).eval_kind || "").toLowerCase();
        if (kind.startsWith("devoir")) evalsDevoir += 1;
        if (kind.startsWith("interro")) evalsInterro += 1;
      }
    }

    const idealDevoirTotal = coreSubjectsCount * 4; // 4 devoirs / matière
    const idealInterroTotal = coreSubjectsCount * 4; // 4 interros / matière

    const expectedDevoirNow = Math.round(idealDevoirTotal * timelineFactor);
    const expectedInterroNow = Math.round(idealInterroTotal * timelineFactor);

    const evalsDevoirRatio =
      expectedDevoirNow > 0 ? evalsDevoir / expectedDevoirNow : 0;
    const evalsInterroRatio =
      expectedInterroNow > 0 ? evalsInterro / expectedInterroNow : 0;

    // ─────────────────────────────────────
    //  Appel du modèle SQL
    // ─────────────────────────────────────
    const { data: rows, error: predErr } = await srv.rpc(
      "predict_success_for_class",
      {
        p_institution_id: institution_id,
        p_class_id: class_id,
        p_academic_year: academic_year,
        p_exam_date: exam_date_raw,
        p_core_completion_percent: coverage, // 0..100
      }
    );

    if (predErr) {
      return NextResponse.json(
        { ok: false, error: predErr.message },
        { status: 400 }
      );
    }

    const preds = (rows || []) as any[];

    // Aucun élève avec suffisamment de données
    if (!preds.length) {
      return NextResponse.json({
        ok: true,
        class: {
          id: cls.id,
          label: cls.label,
          level: cls.level,
          academic_year: cls.academic_year,
        },
        input: {
          academic_year,
          exam_date: exam_date_raw,
          key_subjects_coverage: coverage,
        },
        metrics: {
          class_size: 0,
          predicted_success_rate: 0,
          average_attendance_score: 0,
          bonus_ratio: 0,
          average_draft_ratio: 0,
          env_size_score: 0,
          coverage_score: coverage,
          env_score: 0,
          class_general_avg_20: null,
          expected_coverage_percent: expectedCoverage,
          coverage_gap_percent: coverage - expectedCoverage,
          evals_devoir_done: evalsDevoir,
          evals_interro_done: evalsInterro,
          evals_total_done: evalsTotal,
          evals_devoir_expected: expectedDevoirNow,
          evals_interro_expected: expectedInterroNow,
          evals_devoir_ratio: evalsDevoirRatio,
          evals_interro_ratio: evalsInterroRatio,
          days_to_exam: daysToExam,
        },
        recommendations: [
          "Aucune donnée suffisante (moyennes, assiduité, conduite) pour calculer une prédiction sur cette classe.",
        ],
        students: [],
      });
    }

    // Taille de la classe renvoyée par la vue (même valeur pour chaque ligne)
    const classSize = Number(preds[0].class_size || preds.length);

    // Ratio d'élèves ayant au moins un bonus explicite
    const bonusStudentsCount = preds.filter(
      (r) => Number(r.bonus_points_total || 0) > 0
    ).length;
    const bonusRatio = classSize ? bonusStudentsCount / classSize : 0;

    // Score lié à la taille de la classe
    let envSizeScore = 100;
    if (classSize <= 30) envSizeScore = 100;
    else if (classSize <= 40) envSizeScore = 90;
    else if (classSize <= 50) envSizeScore = 80;
    else if (classSize <= 60) envSizeScore = 70;
    else envSizeScore = 60;

    const coverageScore = coverage; // 0..100
    const envScore = envSizeScore * 0.4 + coverageScore * 0.6;

    const students: StudentResult[] = [];
    let sumPredicted = 0;
    let sumAttendance = 0;
    let sumDraftRatio = 0;
    let countDrafts = 0;
    let sumClassGeneralAvg = 0;
    let countClassGeneralAvg = 0;

    for (const row of preds) {
      // Base académique : priorité matières clés -> toutes matières -> moyenne générale
      const rawAll = row.raw_all_avg_20 as number | null;
      const rawCore = row.raw_core_avg_20 as number | null;
      const generalAvg = row.general_avg_20 as number | null;

      let academicBase20: number;
      if (rawCore != null) academicBase20 = rawCore;
      else if (rawAll != null) academicBase20 = rawAll;
      else if (generalAvg != null) academicBase20 = generalAvg;
      else academicBase20 = 10;

      academicBase20 = Math.max(0, Math.min(20, academicBase20));
      const academic_score = clamp01(academicBase20 / 20) * 100;

      if (generalAvg != null) {
        sumClassGeneralAvg += Number(generalAvg);
        countClassGeneralAvg += 1;
      }

      // Présence (presence_rate 0..1)
      const presenceRate = Number(row.presence_rate ?? 0);
      const attendance_score = clamp01(presenceRate) * 100;

      // Conduite
      const conductNorm =
        typeof row.conduct_norm === "number"
          ? Number(row.conduct_norm)
          : typeof row.conduct_total_20 === "number"
          ? Number(row.conduct_total_20) / 20
          : 0.75; // base plutôt positive si rien
      const conduct_score = clamp01(conductNorm) * 100;

      // Bonus explicites
      const bonus_total = Number(row.bonus_points_total ?? 0);
      const personalPenalty = Math.min(bonus_total * 5, 40);
      const classPenalty = bonusRatio * 40;
      const bonus_score = Math.max(0, 100 - (personalPenalty + classPenalty));

      // Notes au brouillon
      const draft_ratio =
        typeof row.draft_ratio === "number" ? Number(row.draft_ratio) : 0;
      const draft_score = Math.max(0, 100 - draft_ratio * 100);

      // Prédiction finale (p_success 0..1 venant du modèle logistique)
      const p_success = clamp01(Number(row.p_success ?? 0));
      const predicted_success = p_success * 100;

      // Label de risque (on traduit low/medium/high)
      let risk_label = "Risque élevé";
      if (row.risk_level === "low") risk_label = "Faible risque";
      else if (row.risk_level === "medium") risk_label = "Risque moyen";

      const full_name =
        `${(row.last_name as string) || ""} ${
          (row.first_name as string) || ""
        }`.trim() || (row.matricule as string) || "";

      sumPredicted += predicted_success;
      sumAttendance += attendance_score;
      if (draft_ratio > 0) {
        sumDraftRatio += draft_ratio;
        countDrafts += 1;
      }

      students.push({
        student_id: String(row.student_id),
        full_name,
        matricule: (row.matricule as string) || "",
        general_avg_20: generalAvg,

        academic_score,
        attendance_score,
        conduct_score,
        bonus_total,
        bonus_score,
        draft_ratio,
        draft_score,

        predicted_success,
        risk_label,
      });
    }

    const predictedClass = classSize ? sumPredicted / classSize : 0;
    const avgAttendance = classSize ? sumAttendance / classSize : 0;
    const avgDraftRatio = countDrafts ? sumDraftRatio / countDrafts : 0;
    const classGeneralAvg =
      countClassGeneralAvg > 0
        ? sumClassGeneralAvg / countClassGeneralAvg
        : null;

    const worstStudents = [...students]
      .sort((a, b) => a.predicted_success - b.predicted_success)
      .slice(0, 5)
      .map((s) => s.full_name || s.matricule || s.student_id);

    const recommendations = buildRecommendations({
      predictedClass,
      coverage: coverageScore,
      expectedCoverage,
      avgAttendance,
      ratioBonus: bonusRatio,
      avgDraftRatio,
      classGeneralAvg20: classGeneralAvg,
      evalsDevoirRatio,
      evalsInterroRatio,
      evalsDevoirDone: evalsDevoir,
      evalsInterroDone: evalsInterro,
      daysToExam,
      worstStudents,
    });

    return NextResponse.json({
      ok: true,
      class: {
        id: cls.id,
        label: cls.label,
        level: cls.level,
        academic_year: cls.academic_year,
      },
      input: {
        academic_year,
        exam_date: exam_date_raw,
        key_subjects_coverage: coverage,
      },
      metrics: {
        class_size: classSize,
        predicted_success_rate: Math.round(predictedClass * 10) / 10,
        average_attendance_score: Math.round(avgAttendance * 10) / 10,
        bonus_ratio: bonusRatio,
        average_draft_ratio: avgDraftRatio,
        env_size_score: envSizeScore,
        coverage_score: coverageScore,
        env_score: Math.round(envScore * 10) / 10,

        class_general_avg_20: classGeneralAvg,
        expected_coverage_percent: expectedCoverage,
        coverage_gap_percent: coverageScore - expectedCoverage,

        evals_devoir_done: evalsDevoir,
        evals_interro_done: evalsInterro,
        evals_total_done: evalsTotal,
        evals_devoir_expected: expectedDevoirNow,
        evals_interro_expected: expectedInterroNow,
        evals_devoir_ratio: evalsDevoirRatio,
        evals_interro_ratio: evalsInterroRatio,

        days_to_exam: daysToExam,
      },
      recommendations,
      students,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "prediction_failed" },
      { status: 400 }
    );
  }
}

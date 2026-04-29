// src/app/api/teacher/grades/averages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { computeAcademicYear } from "@/lib/academicYear";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_PREFIX = "[TeacherGradesAverages]";

function bad(error: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function clamp(n: number, a = 0, b = 20) {
  return Math.max(a, Math.min(b, n));
}

function roundTo(value: number, step: number) {
  if (!isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function denseRanks(values: number[]) {
  const ranks: number[] = [];
  let rank = 0;
  let prev: number | null = null;

  for (const v of values) {
    if (prev === null || Math.abs(v - prev) > 1e-9) {
      rank += 1;
      prev = v;
    }
    ranks.push(rank);
  }

  return ranks;
}

function isLyceeLevel(level?: string | null): boolean {
  if (!level) return false;

  let lvl = level.toLowerCase();

  try {
    lvl = lvl.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    // on garde lvl tel quel
  }

  return lvl === "seconde" || lvl === "premiere" || lvl === "terminale";
}

function normalizeUuidLike(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v : null;
}

type EvaluationRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  subject_component_id?: string | null;
  grading_period_id?: string | null;
  is_published: boolean;
  scale: number;
  coeff: number;
};

type GradeRow = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
};

type BonusRow = {
  student_id: string;
  bonus: number;
  subject_id: string | null;
  grading_period_id?: string | null;
};

type GradePeriodRow = {
  id: string;
  institution_id: string;
  academic_year: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean | null;
  order_index: number | null;
};

type Row = {
  student_id: string;

  // count_evals = nombre de notes réellement prises en compte.
  // total_evals = nombre d’évaluations concernées.
  count_evals: number;
  total_evals: number;

  // 0 = vraie moyenne calculée à partir d’une vraie note 0.
  // absence de ligne pour un élève = aucune moyenne calculable / NC côté front.
  average_raw: number;
  bonus: number;
  average: number;
  average_rounded: number;
  rank: number;

  // Champs explicites pour éviter toute confusion côté front.
  has_average: boolean;
  is_complete: boolean;
  status: "complete" | "partial";
};

async function getGradePeriodById(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  gradingPeriodId: string
): Promise<GradePeriodRow | null> {
  const { data, error } = await srv
    .from("grade_periods")
    .select(
      "id,institution_id,academic_year,start_date,end_date,is_active,order_index"
    )
    .eq("id", gradingPeriodId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) {
    console.error(LOG_PREFIX, "getGradePeriodById error", {
      gradingPeriodId,
      institutionId,
      error,
    });
    return null;
  }

  return (data as GradePeriodRow | null) ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const svc = getSupabaseServiceClient();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return bad("UNAUTHENTICATED", 401);

    const { searchParams } = new URL(req.url);

    const class_id = String(searchParams.get("class_id") || "").trim();
    const rawSubject = searchParams.get("subject_id");
    const subject_id = rawSubject ? String(rawSubject).trim() || null : null;

    const grading_period_id =
      normalizeUuidLike(searchParams.get("grading_period_id")) ??
      normalizeUuidLike(searchParams.get("gradingPeriodId"));

    const academic_year_param = String(
      searchParams.get("academic_year") || ""
    ).trim();

    // Compatibilité : on conserve le défaut historique à 0.
    // Les écrans officiels peuvent forcer published_only=1.
    const published_only = (searchParams.get("published_only") ?? "0") === "1";

    // ignore = absence de note ignorée.
    // zero = absence de note comptée comme 0 seulement si explicitement demandé.
    const missing = (searchParams.get("missing") ?? "ignore") as
      | "ignore"
      | "zero";

    const round_to_raw = String(searchParams.get("round_to") || "none");

    const rank_by = (searchParams.get("rank_by") ?? "average") as
      | "average"
      | "rounded";

    if (!class_id) return bad("class_id requis");

    if (!["ignore", "zero"].includes(missing)) {
      return bad("missing invalide (attendu: ignore|zero)", 400);
    }

    if (!["average", "rounded"].includes(rank_by)) {
      return bad("rank_by invalide (attendu: average|rounded)", 400);
    }

    let round_to: number | null = null;

    if (round_to_raw !== "none") {
      const n = Number(round_to_raw);
      if (!isFinite(n) || n <= 0) {
        return bad("round_to invalide (attendu: none|0.5|1)", 400);
      }
      round_to = n;
    }

    console.log(LOG_PREFIX, "incoming params", {
      class_id,
      rawSubject,
      subject_id,
      grading_period_id,
      academic_year_param,
      published_only,
      missing,
      round_to_raw,
      rank_by,
    });

    // 0) Infos de la classe : niveau + institution
    const { data: cls, error: clsErr } = await supabase
      .from("classes")
      .select("id, level, institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      console.error(LOG_PREFIX, "classes error", clsErr);
    }

    const classLevel = (cls as any)?.level as string | null | undefined;
    const institution_id = (cls as any)?.institution_id as
      | string
      | null
      | undefined;

    const lycee = isLyceeLevel(classLevel ?? null);

    console.log(LOG_PREFIX, "class info", cls);

    let academic_year = academic_year_param || computeAcademicYear(new Date());

    if (grading_period_id) {
      if (!institution_id) {
        return bad("CLASS_OR_INSTITUTION_NOT_FOUND", 400);
      }

      const period = await getGradePeriodById(
        svc,
        institution_id,
        grading_period_id
      );

      if (!period) {
        return bad("INVALID_GRADING_PERIOD", 400);
      }

      if (period.is_active === false) {
        return bad("GRADING_PERIOD_INACTIVE", 400);
      }

      academic_year = period.academic_year;
    }

    // 1) Évaluations concernées
    let qEvals = supabase
      .from("grade_evaluations")
      .select(
        "id, scale, coeff, class_id, subject_id, subject_component_id, grading_period_id, is_published"
      )
      .eq("class_id", class_id)
      .eq("academic_year", academic_year);

    if (subject_id) qEvals = qEvals.eq("subject_id", subject_id);

    if (grading_period_id) {
      qEvals = qEvals.eq("grading_period_id", grading_period_id);
    }

    if (published_only) qEvals = qEvals.eq("is_published", true);

    const { data: evals, error: eErr } = await qEvals;
    if (eErr) return bad(eErr.message || "EVALS_FETCH_FAILED", 400);

    const evaluations = (evals ?? []) as unknown as EvaluationRow[];
    const evaluationIds = evaluations.map((e) => e.id);

    console.log(LOG_PREFIX, "evals loaded", {
      count: evaluations.length,
      evaluationIds,
      grading_period_id,
      academic_year,
      published_only,
    });

    if (evaluationIds.length === 0) {
      return NextResponse.json({
        ok: true,
        params: {
          class_id,
          subject_id,
          grading_period_id,
          academic_year,
          published_only,
          missing,
          round_to: round_to ?? "none",
          rank_by,
        },
        items: [],
        meta: {
          evaluations: 0,
          note: "Aucune évaluation concernée. Aucun élève ne doit être affiché avec 0 par défaut.",
        },
      });
    }

    const hasAnyComponentEval = evaluations.some(
      (e) => !!(e as any).subject_component_id
    );

    // 1bis) Chargement des rubriques / sous-matières si nécessaire
    const componentCoeffMap = new Map<string, number>();

    if (!lycee && subject_id && institution_id && hasAnyComponentEval) {
      const { data: comps, error: cErr } = await supabase
        .from("grade_subject_components")
        .select("id, coeff_in_subject")
        .eq("institution_id", institution_id)
        .eq("subject_id", subject_id)
        .eq("is_active", true);

      if (cErr) {
        console.error(LOG_PREFIX, "grade_subject_components error", cErr);
      } else {
        for (const c of comps ?? []) {
          const id = (c as any).id as string;
          const rawW = (c as any).coeff_in_subject;
          const w =
            typeof rawW === "number" && isFinite(rawW) && rawW > 0 ? rawW : 1;

          componentCoeffMap.set(id, w);
        }
      }
    }

    const useComponentModel =
      !lycee &&
      !!subject_id &&
      hasAnyComponentEval &&
      componentCoeffMap.size > 0;

    console.log(LOG_PREFIX, "component model", {
      lycee,
      subject_id,
      hasAnyComponentEval,
      componentCoeffMapSize: componentCoeffMap.size,
      useComponentModel,
    });

    // Pré-calcul : total des coeffs par rubrique
    const evalCoeffsByComponent = new Map<string, number>();

    const totalCoeff = evaluations.reduce((acc: number, e: EvaluationRow) => {
      const coeff = Number(e.coeff || 0);
      const key = (e as any).subject_component_id || "__none__";

      if (isFinite(coeff) && coeff > 0) {
        evalCoeffsByComponent.set(
          key,
          (evalCoeffsByComponent.get(key) || 0) + coeff
        );
        return acc + coeff;
      }

      return acc;
    }, 0);

    console.log(LOG_PREFIX, "coeff info", {
      totalCoeff,
      evalCoeffsByComponent: Array.from(evalCoeffsByComponent.entries()),
    });

    /*
     * 2) Notes associées
     *
     * ✅ Changement contrôlé :
     * - published_only=false : moyenne de travail depuis student_grades.
     * - published_only=true  : moyenne officielle depuis v_grade_scores_official_for_reports.
     *
     * La vue officielle lit d’abord grade_published_scores, puis garde un fallback
     * sur student_grades pour les anciennes évaluations publiées sans snapshot.
     */
    const gradesSource = published_only
      ? "v_grade_scores_official_for_reports"
      : "student_grades";

    const gradesClient = published_only ? svc : supabase;

    const { data: grades, error: gErr } = await gradesClient
      .from(gradesSource)
      .select("evaluation_id, student_id, score")
      .in("evaluation_id", evaluationIds);

    if (gErr) return bad(gErr.message || "GRADES_FETCH_FAILED", 400);

    const gradesRows = (grades ?? []) as unknown as GradeRow[];

    console.log(LOG_PREFIX, "grades loaded", {
      count: gradesRows.length,
      source: gradesSource,
      published_only,
      sample: gradesRows.slice(0, 3),
    });

    // 3) Bonus filtrés aussi par période
    let qBonuses = svc
      .from("grade_adjustments")
      .select(
        "student_id, bonus, subject_id, class_id, academic_year, grading_period_id"
      )
      .eq("class_id", class_id)
      .eq("academic_year", academic_year);

    if (grading_period_id) {
      qBonuses = qBonuses.eq("grading_period_id", grading_period_id);
    } else {
      qBonuses = qBonuses.is("grading_period_id", null);
    }

    const { data: bonuses, error: bErr } = await qBonuses;

    if (bErr) {
      console.error(LOG_PREFIX, "bonus fetch error (svc)", bErr);
      return bad(bErr.message || "BONUS_FETCH_FAILED", 400);
    }

    console.log(LOG_PREFIX, "raw bonuses (svc)", {
      count: (bonuses ?? []).length,
      sample: (bonuses ?? []).slice(0, 10),
      subject_id_in_query: subject_id,
      grading_period_id,
    });

    const bonusMap = new Map<string, number>();

    for (const r of (bonuses ?? []) as unknown as BonusRow[]) {
      const sid = r.student_id;
      const b = Number((r as any).bonus ?? 0);
      const rowSubj = r.subject_id;

      if (!sid || !Number.isFinite(b)) continue;

      if (!subject_id) {
        if (rowSubj === null) {
          bonusMap.set(sid, b);
        }
        continue;
      }

      if (rowSubj === subject_id) {
        bonusMap.set(sid, b);
        continue;
      }

      if (rowSubj === null && !bonusMap.has(sid)) {
        bonusMap.set(sid, b);
      }
    }

    console.log(LOG_PREFIX, "bonusMap built", {
      entries: Array.from(bonusMap.entries()).slice(0, 20),
    });

    // 4) Calcul des moyennes
    const evalById = new Map<string, EvaluationRow>();
    for (const e of evaluations) evalById.set(e.id, e);

    const gradesByStudent = new Map<
      string,
      {
        sum: number;
        denom: number;
        counted: number;
        present: number;
      }
    >();

    type PerComponentAgg = { num: number; denPresent: number };
    const perStudentComponent = new Map<string, Record<string, PerComponentAgg>>();

    for (const g of gradesRows) {
      const e = evalById.get(g.evaluation_id);
      if (!e) continue;

      const scale = Number(e.scale || 20);
      const coeff = Number(e.coeff || 1);
      const s =
        g.score === null || g.score === undefined ? null : Number(g.score);

      // Important :
      // - null / vide = aucune note, ignorée
      // - 0 = vraie note zéro, prise en compte
      if (s === null || !isFinite(s) || s < 0) continue;
      if (!isFinite(scale) || scale <= 0) continue;
      if (!isFinite(coeff) || coeff <= 0) continue;

      const score = Math.max(0, Math.min(scale, s));
      const normalized = (score / scale) * 20;
      const contrib = normalized * coeff;

      const cur =
        gradesByStudent.get(g.student_id) || {
          sum: 0,
          denom: 0,
          counted: 0,
          present: 0,
        };

      cur.sum += contrib;
      cur.denom += coeff;
      cur.counted += 1;
      cur.present += 1;
      gradesByStudent.set(g.student_id, cur);

      if (useComponentModel) {
        const compKey = (e as any).subject_component_id || "__none__";
        const per = perStudentComponent.get(g.student_id) || {};
        const agg = per[compKey] || { num: 0, denPresent: 0 };

        agg.num += contrib;
        agg.denPresent += coeff;
        per[compKey] = agg;
        perStudentComponent.set(g.student_id, per);
      }
    }

    if (missing === "zero") {
      for (const [sid, agg] of gradesByStudent) {
        agg.denom = totalCoeff;
        gradesByStudent.set(sid, agg);
      }
    }

    console.log(LOG_PREFIX, "gradesByStudent (raw)", {
      count: gradesByStudent.size,
      sample: Array.from(gradesByStudent.entries()).slice(0, 3),
    });

    const rows: Row[] = [];
    const totalEvals = evaluations.length;

    for (const [sid, agg] of gradesByStudent) {
      let avg20: number | null = null;

      if (useComponentModel) {
        const per = perStudentComponent.get(sid) || {};
        let numSubject = 0;
        let denSubject = 0;

        for (const [compKey, compAgg] of Object.entries(per)) {
          const totalCoeffForComp =
            evalCoeffsByComponent.get(compKey) ?? compAgg.denPresent;

          const denomComp =
            missing === "zero" ? totalCoeffForComp : compAgg.denPresent;

          if (!denomComp || denomComp <= 0) continue;

          const moyComp = compAgg.num / denomComp;

          const wComp =
            compKey === "__none__"
              ? 1
              : componentCoeffMap.get(compKey) ?? 1;

          numSubject += moyComp * wComp;
          denSubject += wComp;
        }

        avg20 = denSubject > 0 ? numSubject / denSubject : null;
      } else {
        const denom = agg.denom || 0;
        avg20 = denom > 0 ? agg.sum / denom : null;
      }

      // Aucun calcul possible = pas de ligne renvoyée.
      // Le front affichera NC pour cet élève en complétant avec le roster.
      if (avg20 === null || !Number.isFinite(avg20)) continue;

      const b = bonusMap.get(sid) ?? 0;
      const afterBonus = clamp(avg20 + b, 0, 20);
      const rounded = round_to ? roundTo(afterBonus, round_to) : afterBonus;

      const isComplete =
        missing === "zero"
          ? totalEvals > 0
          : agg.counted >= totalEvals && totalEvals > 0;

      rows.push({
        student_id: sid,
        count_evals: agg.counted,
        total_evals: totalEvals,
        average_raw: Number(avg20.toFixed(4)),
        bonus: Number(b.toFixed(2)),
        average: Number(afterBonus.toFixed(4)),
        average_rounded: Number(rounded.toFixed(2)),
        rank: 0,
        has_average: true,
        is_complete: isComplete,
        status: isComplete ? "complete" : "partial",
      });
    }

    const sortKey = (r: Row) =>
      rank_by === "rounded" ? r.average_rounded : r.average;

    // On conserve le classement sur les moyennes calculables.
    // Le front peut choisir d’afficher NC si is_complete=false.
    rows.sort((a, b) => sortKey(b) - sortKey(a));

    const ranks = denseRanks(rows.map(sortKey));

    rows.forEach((r, i) => {
      r.rank = ranks[i];
    });

    console.log(LOG_PREFIX, "final rows", {
      count: rows.length,
      sample: rows.slice(0, 3),
    });

    return NextResponse.json({
      ok: true,
      params: {
        class_id,
        subject_id,
        grading_period_id,
        academic_year,
        published_only,
        missing,
        round_to: round_to ?? "none",
        rank_by,
      },
      items: rows,
      meta: {
        evaluations: totalEvals,
        notes_count: gradesRows.length,
        returned_students: rows.length,
        grades_source: gradesSource,
        official_scores_used: published_only,
        rule:
          "0 est une vraie note. null/vide est ignoré. Un élève sans moyenne calculable n’est pas renvoyé et doit être affiché NC côté front.",
      },
    });
  } catch (e: any) {
    console.error(LOG_PREFIX, "unexpected error", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}
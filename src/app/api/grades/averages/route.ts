// src/app/api/grades/averages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { computeAcademicYear } from "@/lib/academicYear";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_PREFIX = "[grades/averages]";

function logInfo(...args: any[]) {
  console.log(LOG_PREFIX, ...args);
}

function logError(...args: any[]) {
  console.error(LOG_PREFIX, ...args);
}

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
  // Valeurs déjà triées DESC ; renvoie le rang dense : 1, 1, 2, 3…
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
    // ignore
  }

  return lvl === "seconde" || lvl === "premiere" || lvl === "terminale";
}

type EvaluationRow = {
  id: string;
  class_id: string;
  subject_id: string | null; // ✅ subjects.id canonique
  subject_component_id?: string | null;
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
};

type Row = {
  student_id: string;

  // count_evals = nombre d’évaluations avec une vraie note.
  // total_evals = nombre total d’évaluations considérées.
  count_evals: number;
  total_evals: number;

  // 0 = vraie moyenne calculée avec une vraie note 0.
  // absence de ligne pour un élève = aucune moyenne calculable / NC côté front.
  average_raw: number;
  bonus: number;
  average: number;
  average_rounded: number;
  rank: number;

  // Champs explicites pour les interfaces.
  has_average: boolean;
  is_complete: boolean;
  status: "complete" | "partial";
};

/**
 * Normalise le subject_id venant du front :
 * - si c'est déjà un subjects.id → on le garde ;
 * - sinon on essaie de le résoudre via institution_subjects.subject_id ;
 * - si rien ne matche → null.
 *
 * IMPORTANT :
 * - grade_evaluations.subject_id et grade_adjustments.subject_id utilisent subjects.id ;
 * - grade_subject_components.subject_id reste l’ID local institution_subjects.id.
 */
async function resolveSubjectIdToGlobal(
  supa: any,
  institutionId: string | null | undefined,
  rawSubjectId?: string | null
): Promise<string | null> {
  if (!rawSubjectId) return null;

  const sid = rawSubjectId.trim();
  if (!sid) return null;

  // 0) Déjà un subjects.id ?
  try {
    const { data: subj } = await supa
      .from("subjects")
      .select("id")
      .eq("id", sid)
      .maybeSingle();

    if (subj?.id) {
      logInfo("resolveSubjectIdToGlobal: direct subjects.id", {
        rawSubjectId: sid,
      });

      return subj.id as string;
    }
  } catch (err) {
    logError("resolveSubjectIdToGlobal subjects error", err, { sid });
  }

  // 1) Sinon on tente via institution_subjects
  if (institutionId) {
    try {
      const { data: instSub } = await supa
        .from("institution_subjects")
        .select("id,subject_id")
        .eq("id", sid)
        .eq("institution_id", institutionId)
        .maybeSingle();

      if (instSub?.subject_id) {
        logInfo("resolveSubjectIdToGlobal: via institution_subjects", {
          institutionId,
          rawSubjectId: sid,
          resolved: instSub.subject_id,
        });

        return instSub.subject_id as string;
      }
    } catch (err) {
      logError("resolveSubjectIdToGlobal instSub error", err, {
        institutionId,
        sid,
      });
    }
  }

  logError("resolveSubjectIdToGlobal: no match", {
    institutionId,
    rawSubjectId: sid,
  });

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();

    if (!auth?.user) return bad("UNAUTHENTICATED", 401);

    // 🔹 Récupérer le profil + établissement de l’utilisateur
    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("id,institution_id")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (pErr || !profile?.institution_id) {
      logError("profile error", pErr);
      return bad("UNAUTHORIZED_PROFILE", 401);
    }

    const svc = getSupabaseServiceClient();
    const { searchParams } = new URL(req.url);

    const class_id = String(searchParams.get("class_id") || "").trim();
    const subjectIdRaw = searchParams.get("subject_id");
    const subject_id = subjectIdRaw ? String(subjectIdRaw).trim() || null : null;

    const academic_year =
      String(searchParams.get("academic_year") || "").trim() ||
      computeAcademicYear(new Date());

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

    logInfo("incoming params", {
      class_id,
      rawSubject: subject_id,
      academic_year,
      published_only,
      missing,
      round_to_raw,
      rank_by,
    });

    // 0) Infos de la classe via SERVICE CLIENT + check établissement
    const { data: cls, error: clsErr } = await svc
      .from("classes")
      .select("id, level, institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      logError("classes error", clsErr);
      return bad("CLASS_FETCH_FAILED", 400);
    }

    if (!cls || cls.institution_id !== profile.institution_id) {
      logError("class access denied", {
        class_id,
        profile_institution_id: profile.institution_id,
        class_institution_id: cls?.institution_id ?? null,
      });

      return bad("FORBIDDEN", 403);
    }

    const classLevel = (cls as any)?.level as string | null | undefined;
    const institution_id = (cls as any)?.institution_id as
      | string
      | null
      | undefined;

    const lycee = isLyceeLevel(classLevel ?? null);

    logInfo("class info", {
      id: cls.id,
      level: classLevel,
      institution_id,
    });

    // 🧠 subject_id GLOBAL pour grade_evaluations & grade_adjustments
    const effectiveSubjectId = await resolveSubjectIdToGlobal(
      svc,
      institution_id ?? null,
      subject_id
    );

    // 1) Évaluations concernées
    let qEvals = svc
      .from("grade_evaluations")
      .select(
        "id, scale, coeff, class_id, subject_id, subject_component_id, is_published"
      )
      .eq("class_id", class_id)
      .eq("academic_year", academic_year);

    // ⚠️ On filtre grade_evaluations sur le subjects.id global.
    if (effectiveSubjectId) {
      qEvals = qEvals.eq("subject_id", effectiveSubjectId);
    }

    if (published_only) qEvals = qEvals.eq("is_published", true);

    const { data: evals, error: eErr } = await qEvals;

    if (eErr) return bad(eErr.message || "EVALS_FETCH_FAILED", 400);

    const evaluations = (evals ?? []) as unknown as EvaluationRow[];
    const evaluationIds = evaluations.map((e) => e.id);

    logInfo("evals loaded", {
      count: evaluations.length,
      evaluationIds,
      published_only,
    });

    if (evaluationIds.length === 0) {
      logInfo("no evaluations for", {
        class_id,
        subjectIdRaw: subject_id,
        effectiveSubjectId,
        academic_year,
      });

      return NextResponse.json({
        ok: true,
        params: {
          class_id,
          subject_id,
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

    // Détection : au moins une évaluation attachée à une sous-matière ?
    const hasAnyComponentEval = evaluations.some(
      (e) => !!(e as any).subject_component_id
    );

    // 1bis) Rubriques / sous-matières si nécessaire
    const componentCoeffMap = new Map<string, number>();

    if (!lycee && subject_id && institution_id && hasAnyComponentEval) {
      // ⚠️ grade_subject_components.subject_id est l’ID local institution_subjects.id
      const { data: comps, error: cErr } = await svc
        .from("grade_subject_components")
        .select("id, coeff_in_subject")
        .eq("institution_id", institution_id)
        .eq("subject_id", subject_id)
        .eq("is_active", true);

      if (cErr) {
        logError("grade_subject_components error", cErr);
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

    // Pré-calcul : total des coeffs par rubrique pour missing="zero"
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

    logInfo("component model", {
      lycee,
      subject_id,
      hasAnyComponentEval,
      componentCoeffMapSize: componentCoeffMap.size,
      useComponentModel,
    });

    logInfo("coeff info", {
      totalCoeff,
      evalCoeffsByComponent: Array.from(evalCoeffsByComponent.entries()),
    });

    // 2) Notes associées
    const { data: grades, error: gErr } = await svc
      .from("student_grades")
      .select("evaluation_id, student_id, score")
      .in("evaluation_id", evaluationIds);

    if (gErr) return bad(gErr.message || "GRADES_FETCH_FAILED", 400);

    const gradesRows = (grades ?? []) as unknown as GradeRow[];

    logInfo("grades loaded", {
      count: gradesRows.length,
      sample: gradesRows.slice(0, 3),
    });

    // 3) Bonus — subject_id = subjects.id canonique
    let bonusRows: BonusRow[] = [];

    if (subject_id && !effectiveSubjectId) {
      // Impossible de résoudre la matière → aucun bonus possible
      bonusRows = [];
      logError("no effectiveSubjectId while subject_id provided", {
        subject_id,
      });
    } else {
      let qBonus = svc
        .from("grade_adjustments")
        .select("student_id, bonus")
        .eq("class_id", class_id)
        .eq("academic_year", academic_year);

      if (subject_id) {
        // Matière précise → filtre sur subjects.id canonique
        qBonus = qBonus.eq("subject_id", effectiveSubjectId as string);
      } else {
        // Moyenne générale → bonus avec subject_id NULL
        qBonus = qBonus.is("subject_id", null);
      }

      const { data: bonuses, error: bErr } = await qBonus;

      if (bErr) return bad(bErr.message || "BONUS_FETCH_FAILED", 400);

      bonusRows = (bonuses ?? []) as unknown as BonusRow[];

      logInfo("raw bonuses", {
        count: bonusRows.length,
        sample: bonusRows.slice(0, 3),
        subject_id_in_query: subject_id,
        effectiveSubjectId,
      });
    }

    const bonusMap = new Map<string, number>();

    for (const r of bonusRows) {
      const b = Number(r.bonus || 0);
      if (!r.student_id || !Number.isFinite(b)) continue;
      bonusMap.set(r.student_id, b);
    }

    logInfo("bonusMap built", {
      entries: Array.from(bonusMap.entries()).slice(0, 5),
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

    // Pour le modèle 2 étages : par élève + par rubrique
    type PerComponentAgg = { num: number; denPresent: number };
    const perStudentComponent = new Map<string, Record<string, PerComponentAgg>>();

    // Pass 1 : accumuler les contributions des notes existantes
    for (const g of gradesRows) {
      const e = evalById.get(g.evaluation_id);
      if (!e) continue;

      const scale = Number(e.scale || 20);
      const coeff = Number(e.coeff || 1);
      const s =
        g.score === null || g.score === undefined ? null : Number(g.score);

      // RÈGLE :
      // - null/vide = aucune note, donc ignorée ;
      // - 0 = vraie note zéro, donc prise en compte.
      if (s === null || !isFinite(s) || s < 0) continue;
      if (!isFinite(scale) || scale <= 0) continue;
      if (!isFinite(coeff) || coeff <= 0) continue;

      const score = Math.max(0, Math.min(scale, s));
      const normalized = (score / scale) * 20;
      const contrib = normalized * coeff;

      // Accumulateur simple
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

      // Accumulateur par rubrique si modèle composants activé
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
      // Pour tous les élèves qui ont au moins UNE note → denom = totalCoeff.
      for (const [sid, agg] of gradesByStudent) {
        agg.denom = totalCoeff;
        gradesByStudent.set(sid, agg);
      }
    }

    logInfo("gradesByStudent (raw)", {
      count: gradesByStudent.size,
      sample: Array.from(gradesByStudent.entries()).slice(0, 3),
    });

    // Construire le tableau final
    const rows: Row[] = [];
    const totalEvals = evaluations.length;

    for (const [sid, agg] of gradesByStudent) {
      let avg20: number | null = null;

      if (useComponentModel) {
        // Modèle à 2 étages : rubriques -> matière
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

      // Aucun calcul possible = pas de ligne.
      // Le front complète avec le roster et affiche NC.
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

    // Tri + rangs.
    // On conserve le rang calculé sur les moyennes disponibles.
    // Le front peut afficher NC si is_complete=false.
    const sortKey = (r: Row) =>
      rank_by === "rounded" ? r.average_rounded : r.average;

    rows.sort((a, b) => sortKey(b) - sortKey(a));
    const ranks = denseRanks(rows.map(sortKey));
    rows.forEach((r, i) => {
      r.rank = ranks[i];
    });

    logInfo("final rows", {
      count: rows.length,
      sample: rows.slice(0, 3),
    });

    return NextResponse.json({
      ok: true,
      params: {
        class_id,
        subject_id,
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
        rule:
          "0 est une vraie note. null/vide est ignoré. Un élève sans moyenne calculable n’est pas renvoyé et doit être affiché NC côté front.",
      },
    });
  } catch (e: any) {
    logError("unexpected error", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}

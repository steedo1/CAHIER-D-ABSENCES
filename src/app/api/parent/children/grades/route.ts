// src/app/api/parent/children/grades/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type GradeRow = {
  id: string;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  title: string | null;
  score: number | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const studentId = url.searchParams.get("student_id");
  const limitParam = url.searchParams.get("limit") || "20";

  const limitRaw = Number(limitParam);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, limitRaw), 100)
    : 20;

  if (!studentId) {
    return NextResponse.json(
      { ok: false, error: "Paramètre student_id manquant." },
      { status: 400 }
    );
  }

  const supabase = await getSupabaseServerClient();

  // Auth parent
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: "Non authentifié." },
      { status: 401 }
    );
  }

  try {
    // ⚠️ Hypothèse : RLS gère déjà le fait qu'un parent
    // ne peut voir que les notes des élèves qui lui sont rattachés.
    // Ici on lit directement student_grades + grade_evaluations.
    const { data, error } = await supabase
      .from("student_grades")
      .select(
        `
        evaluation_id,
        score,
        grade_evaluations!inner (
          id,
          eval_date,
          eval_kind,
          scale,
          coeff,
          is_published,
          title
        )
      `
      )
      .eq("student_id", studentId)
      .eq("grade_evaluations.is_published", true);

    if (error) {
      console.error("[parent.grades] supabase error", error);
      return NextResponse.json(
        { ok: false, error: "Erreur de récupération des notes." },
        { status: 500 }
      );
    }

    // Typage conforme à ce que remonte Supabase : grade_evaluations est un tableau
    const rows = (data || []) as Array<{
      evaluation_id: string;
      score: number | null;
      grade_evaluations:
        | {
            id: string;
            eval_date: string;
            eval_kind: EvalKind;
            scale: number;
            coeff: number;
            is_published: boolean;
            title: string | null;
          }[]
        | null;
    }>;

    // On mappe vers un format compact pour le front parent
    // On a potentiellement plusieurs grade_evaluations par ligne, donc on aplatit.
    const items: GradeRow[] = rows
      .flatMap((row) => {
        const evals = row.grade_evaluations ?? [];
        return evals
          .filter((ev) => ev.is_published)
          .map<GradeRow>((ev) => ({
            id: ev.id, // id de l’évaluation (unique par évaluation)
            eval_date: ev.eval_date,
            eval_kind: ev.eval_kind,
            scale: ev.scale,
            coeff: ev.coeff,
            title: ev.title ?? null,
            score: row.score,
          }));
      })
      // tri du plus récent au plus ancien
      .sort((a, b) => b.eval_date.localeCompare(a.eval_date))
      .slice(0, limit);

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    console.error("[parent.grades] unexpected error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}

// src/app/api/admin/notes/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  eval_date: string;
  scale: number | null;
  coeff: number | null;
  is_published: boolean | null;
  classes?: any;
};

type MarkRow = {
  evaluation_id: string;
  raw_score: number | null;
  mark_20: number | null;
};

type ClassSubjectStat = {
  class_id: string;
  class_label: string;
  level: string | null;
  subject_id: string | null;
  subject_name: string | null;
  evals_count: number;
  notes_count: number;
  avg_score_20: number | null;
};

function relOne<T = any>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function round2(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Number(v.toFixed(2));
}

function chunks<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }

    const { data: roleRow, error: roleErr } = await supabase
      .from("user_roles")
      .select("institution_id, role")
      .eq("profile_id", user.id)
      .maybeSingle();

    if (roleErr || !roleRow || !["super_admin", "admin"].includes(roleRow.role)) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const institutionId = roleRow.institution_id as string | null;
    if (!institutionId) {
      return NextResponse.json(
        { ok: false, error: "NO_INSTITUTION" },
        { status: 400 }
      );
    }

    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const published = searchParams.get("published"); // "true" | "false" | null

    let evalQuery = supabase
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
          level
        )
      `
      )
      .eq("classes.institution_id", institutionId)
      .order("eval_date", { ascending: true })
      .limit(10000);

    if (from) evalQuery = evalQuery.gte("eval_date", from);
    if (to) evalQuery = evalQuery.lte("eval_date", to);
    if (published === "true") evalQuery = evalQuery.eq("is_published", true);
    if (published === "false") evalQuery = evalQuery.eq("is_published", false);

    const { data: evalsData, error: evalErr } = await evalQuery;

    if (evalErr) {
      console.error("[admin.notes.stats] grade_evaluations error", evalErr);
      return NextResponse.json(
        { ok: false, error: "EVALS_ERROR" },
        { status: 500 }
      );
    }

    const evalRows = ((evalsData || []) as any as EvalRow[]).filter(
      (ev) => ev.id && ev.class_id && ev.subject_id
    );

    if (!evalRows.length) {
      return NextResponse.json({
        ok: true,
        meta: {
          from,
          to,
          published,
          total_evaluations: 0,
          total_subject_classes: 0,
        },
        by_class_subject: [] as ClassSubjectStat[],
      });
    }

    const evalIds = Array.from(new Set(evalRows.map((ev) => ev.id)));
    const subjectIds = Array.from(
      new Set(evalRows.map((ev) => String(ev.subject_id || "")).filter(Boolean))
    );

    /* ───────── Noms des matières : institution_subjects puis fallback subjects ───────── */
    const subjectsById: Record<string, { name: string }> = {};

    if (subjectIds.length) {
      const { data: instById, error: instByIdErr } = await supabase
        .from("institution_subjects")
        .select("id, subject_id, custom_name, subjects(name)")
        .in("id", subjectIds)
        .eq("institution_id", institutionId);

      if (instByIdErr) {
        console.error("[admin.notes.stats] institution_subjects by id error", instByIdErr);
        return NextResponse.json(
          { ok: false, error: "SUBJECTS_ERROR" },
          { status: 500 }
        );
      }

      const { data: instBySubject, error: instBySubjectErr } = await supabase
        .from("institution_subjects")
        .select("id, subject_id, custom_name, subjects(name)")
        .in("subject_id", subjectIds)
        .eq("institution_id", institutionId);

      if (instBySubjectErr) {
        console.error(
          "[admin.notes.stats] institution_subjects by subject_id error",
          instBySubjectErr
        );
        return NextResponse.json(
          { ok: false, error: "SUBJECTS_ERROR" },
          { status: 500 }
        );
      }

      const instRows = [...((instById || []) as any[]), ...((instBySubject || []) as any[])];
      const resolved = new Set<string>();

      for (const row of instRows) {
        const subj = relOne<any>(row.subjects);
        const base = String(subj?.name || "Matière").trim();
        const finalName = String(row.custom_name || base || "Matière").trim();

        if (row.id) {
          subjectsById[String(row.id)] = { name: finalName };
          resolved.add(String(row.id));
        }
        if (row.subject_id) {
          subjectsById[String(row.subject_id)] = { name: finalName };
          resolved.add(String(row.subject_id));
        }
      }

      const leftover = subjectIds.filter((id) => !resolved.has(id));
      if (leftover.length) {
        const { data: subjectsData, error: subjectsErr } = await supabase
          .from("subjects")
          .select("id, name")
          .in("id", leftover);

        if (subjectsErr) {
          console.error("[admin.notes.stats] subjects error", subjectsErr);
          return NextResponse.json(
            { ok: false, error: "SUBJECTS_ERROR" },
            { status: 500 }
          );
        }

        for (const s of (subjectsData || []) as any[]) {
          subjectsById[String(s.id)] = {
            name: String(s.name || "Matière").trim(),
          };
        }
      }
    }

    /* ───────── Notes ───────── */
    const markRows: MarkRow[] = [];

    for (const part of chunks(evalIds, 500)) {
      const { data: marksData, error: marksErr } = await supabase
        .from("grade_flat_marks")
        .select("evaluation_id, raw_score, mark_20")
        .in("evaluation_id", part);

      if (marksErr) {
        console.error("[admin.notes.stats] grade_flat_marks error", marksErr);
        return NextResponse.json(
          { ok: false, error: "MARKS_ERROR" },
          { status: 500 }
        );
      }

      markRows.push(...((marksData || []) as any as MarkRow[]));
    }

    const evalById = new Map<string, EvalRow>();
    for (const ev of evalRows) evalById.set(ev.id, ev);

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

    function ensureAcc(ev: EvalRow): Acc {
      const cls = relOne<any>(ev.classes);
      const classLabel = String(cls?.label || "Classe").trim();
      const level = cls?.level ? String(cls.level).trim() : null;
      const subjectId = String(ev.subject_id);
      const subjectName = subjectsById[subjectId]?.name || "Matière";
      const key = `${ev.class_id}::${subjectId}`;

      let acc = accByKey.get(key);
      if (!acc) {
        acc = {
          class_id: ev.class_id,
          class_label: classLabel,
          level,
          subject_id: subjectId,
          subject_name: subjectName,
          evalIds: new Set<string>(),
          notes_count: 0,
          weighted_sum: 0,
          weight_total: 0,
        };
        accByKey.set(key, acc);
      }

      acc.evalIds.add(ev.id);
      return acc;
    }

    // Créer les groupes même pour les évaluations sans note
    for (const ev of evalRows) {
      ensureAcc(ev);
    }

    for (const mark of markRows) {
      const ev = evalById.get(mark.evaluation_id);
      if (!ev || !ev.subject_id) continue;

      const scale = Number(ev.scale || 20);
      const coeff = Number(ev.coeff || 1);

      if (!Number.isFinite(scale) || scale <= 0) continue;
      if (!Number.isFinite(coeff) || coeff <= 0) continue;

      let mark20: number | null = null;

      if (mark.mark_20 !== null && mark.mark_20 !== undefined) {
        mark20 = Number(mark.mark_20);
      } else if (mark.raw_score !== null && mark.raw_score !== undefined) {
        mark20 = (Number(mark.raw_score) / scale) * 20;
      }

      if (mark20 === null || !Number.isFinite(mark20)) continue;

      const acc = ensureAcc(ev);
      acc.notes_count += 1;
      acc.weighted_sum += mark20 * coeff;
      acc.weight_total += coeff;
    }

    const by_class_subject: ClassSubjectStat[] = Array.from(accByKey.values())
      .map((acc) => ({
        class_id: acc.class_id,
        class_label: acc.class_label,
        level: acc.level,
        subject_id: acc.subject_id,
        subject_name: acc.subject_name,
        evals_count: acc.evalIds.size,
        notes_count: acc.notes_count,
        avg_score_20: acc.weight_total > 0 ? round2(acc.weighted_sum / acc.weight_total) : null,
      }))
      .sort((a, b) => {
        const c = a.class_label.localeCompare(b.class_label, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (c !== 0) return c;
        return (a.subject_name || "").localeCompare(b.subject_name || "", undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

    return NextResponse.json({
      ok: true,
      meta: {
        from,
        to,
        published,
        total_evaluations: evalRows.length,
        total_subject_classes: by_class_subject.length,
      },
      by_class_subject,
    });
  } catch (e: any) {
    console.error("[admin.notes.stats] fatal error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
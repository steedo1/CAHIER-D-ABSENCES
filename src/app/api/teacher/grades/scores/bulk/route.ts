// src/app/api/teacher/grades/scores/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = {
  student_id: string;
  score: number | null; // null ⇒ suppression si delete_if_null = true
  comment?: string | null;
};

type Violation = { student_id: string; reason: string };
type UpsertRow = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
  comment: string | null;
  updated_by: string;
};

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();

    // Auth
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return bad("UNAUTHENTICATED", 401);

    // Payload
    const body = (await req.json().catch(() => ({}))) as {
      evaluation_id?: string;
      items?: Item[];
      delete_if_null?: boolean;
      strict?: boolean;
    };

    const evaluation_id = String(body.evaluation_id || "").trim();
    const items: Item[] = Array.isArray(body.items) ? body.items : [];
    const delete_if_null = body.delete_if_null ?? true; // défaut: on supprime si score=null
    const strict = body.strict ?? true; // si true, on bloque sur 1 erreur

    if (!evaluation_id) return bad("evaluation_id requis");
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({
        ok: true,
        evaluation_id,
        upserted: 0,
        deleted: 0,
        warnings: [],
      });
    }

    // Lire l'évaluation (et sa scale) — RLS protège l'accès
    const { data: ge, error: geErr } = await supabase
      .from("grade_evaluations")
      .select("id, scale, class_id, subject_id, is_published")
      .eq("id", evaluation_id)
      .single();

    if (geErr) {
      // 404 si inexistante ou 403 si RLS bloque (non affecté)
      return bad(
        geErr.message || "EVALUATION_NOT_FOUND_OR_FORBIDDEN",
        (geErr as any).code === "PGRST116" ? 404 : 403
      );
    }

    // ✅ CHECK LOCK (verrou global compte classe + compte prof)
    // Si l'évaluation est verrouillée (grade_evaluation_locks.is_locked = true),
    // on bloque toute écriture et on renvoie 423.
    const { data: lock, error: lockErr } = await supabase
      .from("grade_evaluation_locks")
      .select("evaluation_id, is_locked, locked_at, locked_by")
      .eq("evaluation_id", evaluation_id)
      .maybeSingle();

    if (lockErr) {
      return bad(lockErr.message || "LOCK_CHECK_FAILED", 500);
    }

    if (lock?.is_locked) {
      return bad("EVALUATION_LOCKED", 423, {
        evaluation_id,
        locked_at: lock.locked_at ?? null,
        locked_by: lock.locked_by ?? null,
      });
    }

    const scale = Number(ge?.scale || 20);
    const violations: Violation[] = [];

    // Valider & préparer
    const upserts: UpsertRow[] = [];
    const toDelete: string[] = [];

    for (const it of items) {
      const student_id = String(it?.student_id || "").trim();
      const hasScore = it?.score !== null && it?.score !== undefined;

      const comment =
        it?.comment === null || it?.comment === undefined
          ? null
          : String(it.comment);

      if (!student_id) {
        violations.push({ student_id: "", reason: "student_id manquant" });
        continue;
      }

      if (!hasScore) {
        if (delete_if_null) toDelete.push(student_id);
        continue;
      }

      const n = Number(it.score);
      if (!Number.isFinite(n) || n < 0 || n > scale) {
        violations.push({ student_id, reason: `score invalide (0..${scale})` });
        continue;
      }

      upserts.push({
        evaluation_id,
        student_id,
        score: round2(n),
        comment,
        updated_by: auth.user.id,
      });
    }

    if (strict && violations.length > 0) {
      return bad("VALIDATION_FAILED", 422, { violations });
    }

    let upserted = 0;
    let deleted = 0;
    const warnings: string[] = [];

    // Upsert
    if (upserts.length > 0) {
      const { data: upData, error: upErr } = await supabase
        .from("student_grades")
        .upsert(upserts, { onConflict: "evaluation_id,student_id" })
        .select("evaluation_id, student_id");

      if (upErr) return bad(upErr.message || "UPSERT_FAILED", 400);
      upserted = upData?.length ?? 0;
    }

    // Delete
    if (toDelete.length > 0) {
      const { count, error: delErr } = await supabase
        .from("student_grades")
        .delete({ count: "exact" })
        .eq("evaluation_id", evaluation_id)
        .in("student_id", toDelete);

      if (delErr) return bad(delErr.message || "DELETE_FAILED", 400);
      deleted = count ?? 0;
    }

    if (!strict && violations.length > 0) {
      warnings.push(`${violations.length} ligne(s) ignorée(s) (validation)`);
    }

    return NextResponse.json({
      ok: true,
      evaluation_id,
      upserted,
      deleted,
      warnings,
    });
  } catch (e: any) {
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}

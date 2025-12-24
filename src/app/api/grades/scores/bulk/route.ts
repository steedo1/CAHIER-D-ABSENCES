// src/app/api/grades/scores/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

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

/* -------- Contexte (user + profil + service client) -------- */
async function getContext() {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    console.warn("[grades/scores/bulk] no user in context");
    return { supa, user: null as any, profile: null as any, srv: null as any };
  }

  const { data: profile, error } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile?.institution_id) {
    console.error("[grades/scores/bulk] profile error", error);
    return { supa, user, profile: null as any, srv: null as any };
  }

  const srv = getSupabaseServiceClient();
  return { supa, user, profile, srv };
}

/**
 * Vérifie que la classe appartient bien à l'établissement de l'utilisateur.
 * (Même logique que sur /api/grades/evaluations)
 */
async function ensureClassAccess(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  institutionId: string
): Promise<boolean> {
  if (!classId || !institutionId) return false;

  const { data: cls, error } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", classId)
    .maybeSingle();

  if (error) {
    console.error("[grades/scores/bulk] class check error", error);
    return false;
  }

  return !!cls && cls.institution_id === institutionId;
}

/* ==========================================
   POST : upsert des notes pour une évaluation
   (compte classe / admin, aligné sur la route prof)
========================================== */
export async function POST(req: NextRequest) {
  try {
    const { user, profile, srv } = await getContext();
    if (!user || !profile || !srv) {
      return bad("UNAUTHENTICATED", 401);
    }

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

    console.log("[grades/scores/bulk] POST body", {
      evaluation_id,
      items_count: items.length,
      delete_if_null,
      strict,
      profile_id: profile?.id,
      institution_id: profile?.institution_id,
    });

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

    // Lire l'évaluation (via service) pour récupérer scale + class_id
    const { data: ge, error: geErr } = await srv
      .from("grade_evaluations")
      .select("id, scale, class_id, subject_id, is_published")
      .eq("id", evaluation_id)
      .maybeSingle();

    if (geErr || !ge) {
      console.error("[grades/scores/bulk] grade_evaluations error", geErr, {
        evaluation_id,
      });
      return bad(geErr?.message || "EVALUATION_NOT_FOUND_OR_FORBIDDEN", 404);
    }

    // Vérifier que la classe de cette évaluation appartient bien à l'établissement
    const allowed = await ensureClassAccess(
      srv,
      ge.class_id,
      profile.institution_id
    );
    if (!allowed) {
      console.warn("[grades/scores/bulk] forbidden for class", {
        evaluation_id,
        class_id: ge.class_id,
        institution_id: profile.institution_id,
      });
      return bad("FORBIDDEN", 403);
    }

    // ✅ Bloquer l'écriture si l'évaluation est verrouillée (PIN)
    try {
      const { data: lockRow, error: lockErr } = await srv
        .from("grade_evaluation_locks")
        .select("is_locked, locked_at, teacher_id")
        .eq("evaluation_id", evaluation_id)
        .maybeSingle();

      // Si la table n'existe pas encore (migration pas faite), on ne casse rien
      if (lockErr) {
        const msg = String(lockErr.message || "");
        const looksLikeMissingTable =
          msg.includes('relation "grade_evaluation_locks" does not exist') ||
          msg.includes("42P01");
        if (!looksLikeMissingTable) {
          console.error("[grades/scores/bulk] lock check error", lockErr);
          return bad("LOCK_CHECK_FAILED", 500);
        }
      }

      if (lockRow?.is_locked) {
        return bad("EVALUATION_LOCKED", 423, {
          locked: true,
          locked_at: lockRow.locked_at,
          teacher_id: lockRow.teacher_id,
        });
      }
    } catch (e) {
      console.error("[grades/scores/bulk] lock check unexpected", e);
      return bad("LOCK_CHECK_FAILED", 500);
    }

    const scale = Number(ge.scale || 20);
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
        updated_by: user.id,
      });
    }

    if (strict && violations.length > 0) {
      console.warn("[grades/scores/bulk] validation failed", {
        evaluation_id,
        violations,
      });
      return bad("VALIDATION_FAILED", 422, { violations });
    }

    let upserted = 0;
    let deleted = 0;
    const warnings: string[] = [];

    // 🔁 Upsert dans student_grades (⚠️ plus grade_scores)
    if (upserts.length > 0) {
      const { data: upData, error: upErr } = await srv
        .from("student_grades")
        .upsert(upserts, { onConflict: "evaluation_id,student_id" })
        .select("evaluation_id, student_id");

      if (upErr) {
        console.error("[grades/scores/bulk] upsert error", upErr);
        return bad(upErr.message || "UPSERT_FAILED", 400);
      }
      upserted = upData?.length ?? 0;
    }

    // 🗑 Suppression des scores null si demandé
    if (toDelete.length > 0) {
      const { count, error: delErr } = await srv
        .from("student_grades")
        .delete({ count: "exact" })
        .eq("evaluation_id", evaluation_id)
        .in("student_id", toDelete);

      if (delErr) {
        console.error("[grades/scores/bulk] delete error", delErr);
        return bad(delErr.message || "DELETE_FAILED", 400);
      }
      deleted = count ?? 0;
    }

    if (!strict && violations.length > 0) {
      warnings.push(`${violations.length} ligne(s) ignorée(s) (validation)`);
    }

    console.log("[grades/scores/bulk] done", {
      evaluation_id,
      upserted,
      deleted,
      violations: violations.length,
    });

    return NextResponse.json({
      ok: true,
      evaluation_id,
      upserted,
      deleted,
      warnings,
    });
  } catch (e: any) {
    console.error("[grades/scores/bulk] unexpected error", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}

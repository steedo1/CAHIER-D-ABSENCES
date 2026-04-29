// src/app/api/teacher/grades/scores/bulk/route.ts
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

type GradePeriodRow = {
  id: string;
  end_date: string | null;
  is_active: boolean | null;
};

type EvaluationRow = {
  id: string;
  scale: number | null;
  class_id: string;
  is_published: boolean | null;
  published_at: string | null;
  publication_status: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_comment: string | null;
  publication_version: number | null;
  grading_period_id: string | null;
};

type EvaluationLockRow = {
  evaluation_id: string;
  is_locked: boolean | null;
  locked_at: string | null;
  teacher_id: string | null;
  locked_by: string | null;
};

type PublicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "published"
  | string
  | null;

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function serverTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isClosedByEndDate(period: GradePeriodRow | null): boolean {
  if (!period?.end_date) return false;
  return serverTodayIsoDate() > period.end_date;
}

function normalizePublicationStatus(value: unknown): PublicationStatus {
  const v = String(value ?? "").trim();

  if (!v) return "draft";

  if (
    v === "draft" ||
    v === "submitted" ||
    v === "changes_requested" ||
    v === "published"
  ) {
    return v;
  }

  return v;
}

/**
 * Verrou métier publication.
 *
 * Règle :
 * - draft : saisie autorisée
 * - changes_requested : correction autorisée
 * - submitted : bloqué, l'admin doit valider ou demander correction
 * - published : bloqué, car la note officielle existe déjà
 */
function assertEvaluationEditable(ge: EvaluationRow) {
  const publicationStatus = normalizePublicationStatus(ge.publication_status);
  const isPublished = ge.is_published === true;

  if (isPublished || publicationStatus === "published") {
    return {
      ok: false as const,
      error: "EVALUATION_ALREADY_PUBLISHED",
      status: 423,
      extra: {
        editable: false,
        evaluation_id: ge.id,
        is_published: ge.is_published === true,
        publication_status: publicationStatus,
        published_at: ge.published_at ?? null,
        publication_version: ge.publication_version ?? null,
        message:
          "Cette évaluation est déjà publiée officiellement. Utiliser le workflow de correction/republication.",
      },
    };
  }

  if (publicationStatus === "submitted") {
    return {
      ok: false as const,
      error: "EVALUATION_SUBMITTED_FOR_PUBLICATION",
      status: 423,
      extra: {
        editable: false,
        evaluation_id: ge.id,
        is_published: ge.is_published === true,
        publication_status: publicationStatus,
        submitted_at: ge.submitted_at ?? null,
        submitted_by: ge.submitted_by ?? null,
        message:
          "Cette évaluation est soumise à publication. L’administration doit valider ou demander une correction avant toute modification.",
      },
    };
  }

  return {
    ok: true as const,
    publication_status: publicationStatus,
  };
}

async function isPrivilegedUser(userId: string) {
  const svc = getSupabaseServiceClient();

  const { data, error } = await svc
    .from("user_roles")
    .select("role")
    .eq("profile_id", userId);

  if (error) return false;

  const roles = Array.isArray(data)
    ? data.map((r: any) => String(r.role || ""))
    : [];

  return (
    roles.includes("super_admin") ||
    roles.includes("admin") ||
    roles.includes("educator")
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();

    const { data: auth } = await supabase.auth.getUser();

    if (!auth?.user) return bad("UNAUTHENTICATED", 401);

    const body = (await req.json().catch(() => ({}))) as {
      evaluation_id?: string;
      items?: Item[];
      delete_if_null?: boolean;
      strict?: boolean;
    };

    const evaluation_id = String(body.evaluation_id || "").trim();
    const items: Item[] = Array.isArray(body.items) ? body.items : [];
    const delete_if_null = body.delete_if_null ?? true;
    const strict = body.strict ?? true;

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

    // Lire l'évaluation via Supabase RLS : si le prof n'a pas accès, la requête échoue.
    const { data: geRaw, error: geErr } = await supabase
      .from("grade_evaluations")
      .select(
        [
          "id",
          "scale",
          "class_id",
          "is_published",
          "published_at",
          "publication_status",
          "submitted_at",
          "submitted_by",
          "reviewed_at",
          "reviewed_by",
          "review_comment",
          "publication_version",
          "grading_period_id",
        ].join(",")
      )
      .eq("id", evaluation_id)
      .single();

    if (geErr || !geRaw) {
      return bad(
        geErr?.message || "EVALUATION_NOT_FOUND_OR_FORBIDDEN",
        (geErr as any)?.code === "PGRST116" ? 404 : 403
      );
    }

    const ge = geRaw as unknown as EvaluationRow;
    const srv = getSupabaseServiceClient();

    // ✅ CHECK CLÔTURE PAR FIN DE PÉRIODE
    // On vérifie seulement pour les profils non privilégiés.
    const privileged = await isPrivilegedUser(auth.user.id);

    if (!privileged && ge.grading_period_id) {
      const { data: periodRow, error: periodErr } = await srv
        .from("grade_periods")
        .select("id, end_date, is_active")
        .eq("id", ge.grading_period_id)
        .maybeSingle();

      if (periodErr) {
        return bad(periodErr.message || "GRADE_PERIOD_FETCH_FAILED", 500);
      }

      const period = (periodRow ?? null) as unknown as GradePeriodRow | null;

      if (isClosedByEndDate(period)) {
        return bad("GRADING_PERIOD_CLOSED", 423, {
          evaluation_id,
          grading_period_id: ge.grading_period_id,
          period_end_date: period?.end_date ?? null,
          today: serverTodayIsoDate(),
        });
      }
    }

    // ✅ Verrou métier publication AVANT toute écriture.
    const editable = assertEvaluationEditable(ge);

    if (!editable.ok) {
      return bad(editable.error, editable.status, editable.extra);
    }

    // ✅ CHECK LOCK
    try {
      const { data: lockRaw, error: lockErr } = await srv
        .from("grade_evaluation_locks")
        .select("evaluation_id, is_locked, locked_at, teacher_id, locked_by")
        .eq("evaluation_id", evaluation_id)
        .maybeSingle();

      if (lockErr) {
        const msg = String(lockErr.message || "");
        const looksLikeMissingTable =
          msg.includes('relation "grade_evaluation_locks" does not exist') ||
          msg.includes("42P01");

        if (!looksLikeMissingTable) {
          return bad(lockErr.message || "LOCK_CHECK_FAILED", 500);
        }
      }

      const lockRow = (lockRaw ?? null) as unknown as EvaluationLockRow | null;

      if (lockRow?.is_locked) {
        return bad("EVALUATION_LOCKED", 423, {
          evaluation_id,
          locked: true,
          locked_at: lockRow.locked_at ?? null,
          teacher_id: lockRow.teacher_id ?? null,
          locked_by: lockRow.locked_by ?? null,
        });
      }
    } catch (e: any) {
      return bad(e?.message || "LOCK_CHECK_FAILED", 500);
    }

    const scale = Number(ge.scale || 20);
    const violations: Violation[] = [];

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
        violations.push({
          student_id,
          reason: `score invalide (0..${scale})`,
        });
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

    if (upserts.length > 0) {
      const { data: upData, error: upErr } = await supabase
        .from("student_grades")
        .upsert(upserts, { onConflict: "evaluation_id,student_id" })
        .select("evaluation_id, student_id");

      if (upErr) return bad(upErr.message || "UPSERT_FAILED", 400);

      upserted = Array.isArray(upData) ? upData.length : 0;
    }

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
      publication_status: editable.publication_status,
    });
  } catch (e: any) {
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}
// src/app/api/teacher/grades/scores/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | "teacher" | string;

type ProfileRow = {
  id: string;
  institution_id: string | null;
};

type EvaluationRow = {
  id: string;
  class_id: string;
  teacher_id: string | null;
  subject_id: string | null;
  scale: number | null;
  is_published: boolean | null;
  publication_status: string | null;
};

type ClassRow = {
  id: string;
  institution_id: string | null;
};

type StudentGradeRow = {
  evaluation_id: string;
  student_id: string;
  score: number | string | null;
  comment: string | null;
};

function json(
  payload: Record<string, unknown>,
  status = 200
) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return json({ ok: false, error, ...(extra ?? {}) }, status);
}

function scoreToNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPrivileged(roles: Set<Role>) {
  return (
    roles.has("super_admin") ||
    roles.has("admin") ||
    roles.has("educator")
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user?.id) {
      return bad("UNAUTHENTICATED", 401);
    }

    const evaluation_id = String(
      req.nextUrl.searchParams.get("evaluation_id") || ""
    ).trim();

    if (!evaluation_id) {
      return bad("evaluation_id manquant", 400);
    }

    // 1) Profil + établissement
    const { data: profileRaw, error: profileErr } = await srv
      .from("profiles")
      .select("id,institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr || !profileRaw) {
      console.error("[teacher/grades/scores] profile error", {
        user_id: user.id,
        error: profileErr,
      });

      return bad("PROFILE_NOT_FOUND", 403);
    }

    const profile = profileRaw as unknown as ProfileRow;

    if (!profile.institution_id) {
      return bad("NO_INSTITUTION", 403);
    }

    // 2) Rôles utilisateur
    const roles = new Set<Role>();

    const { data: roleRows, error: rolesErr } = await srv
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", profile.institution_id);

    if (rolesErr) {
      console.error("[teacher/grades/scores] roles error", {
        user_id: user.id,
        institution_id: profile.institution_id,
        error: rolesErr,
      });
    } else {
      for (const r of roleRows ?? []) {
        roles.add(String((r as any).role || "") as Role);
      }
    }

    const privileged = isPrivileged(roles);

    // 3) Évaluation
    const { data: evRaw, error: evErr } = await srv
      .from("grade_evaluations")
      .select(
        [
          "id",
          "class_id",
          "teacher_id",
          "subject_id",
          "scale",
          "is_published",
          "publication_status",
        ].join(",")
      )
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !evRaw) {
      console.error("[teacher/grades/scores] evaluation fetch error", {
        evaluation_id,
        error: evErr,
      });

      return bad("EVALUATION_NOT_FOUND", 404);
    }

    const ev = evRaw as unknown as EvaluationRow;

    // 4) Classe + vérification établissement
    const { data: classRaw, error: classErr } = await srv
      .from("classes")
      .select("id,institution_id")
      .eq("id", ev.class_id)
      .maybeSingle();

    if (classErr || !classRaw) {
      console.error("[teacher/grades/scores] class fetch error", {
        evaluation_id,
        class_id: ev.class_id,
        error: classErr,
      });

      return bad("CLASS_NOT_FOUND", 404);
    }

    const classRow = classRaw as unknown as ClassRow;

    if (classRow.institution_id !== profile.institution_id) {
      console.warn("[teacher/grades/scores] institution mismatch", {
        evaluation_id,
        class_id: ev.class_id,
        profile_institution_id: profile.institution_id,
        class_institution_id: classRow.institution_id,
      });

      return bad("FORBIDDEN", 403);
    }

    // 5) Vérification accès enseignant si non admin/éducateur
    if (!privileged) {
      let allowed = ev.teacher_id === user.id;

      if (!allowed) {
        const { data: ctRows, error: ctErr } = await srv
          .from("class_teachers")
          .select("id")
          .eq("institution_id", profile.institution_id)
          .eq("class_id", ev.class_id)
          .eq("teacher_id", user.id)
          .limit(1);

        if (ctErr) {
          console.error("[teacher/grades/scores] class_teachers error", {
            evaluation_id,
            class_id: ev.class_id,
            teacher_id: user.id,
            error: ctErr,
          });
        }

        allowed = Array.isArray(ctRows) && ctRows.length > 0;
      }

      if (!allowed) {
        console.warn("[teacher/grades/scores] access denied", {
          evaluation_id,
          class_id: ev.class_id,
          teacher_id: user.id,
        });

        return bad("Accès refusé à cette évaluation", 403);
      }
    }

    // 6) Lecture réelle des notes avec le client service
    const { data: rowsRaw, error: rowsErr } = await srv
      .from("student_grades")
      .select("evaluation_id,student_id,score,comment")
      .eq("evaluation_id", evaluation_id);

    if (rowsErr) {
      console.error("[teacher/grades/scores] student_grades read error", {
        evaluation_id,
        error: rowsErr,
      });

      return bad(rowsErr.message || "SCORES_READ_FAILED", 500);
    }

    const rows = (rowsRaw ?? []) as unknown as StudentGradeRow[];

    const items = rows.map((r) => ({
      evaluation_id: r.evaluation_id,
      student_id: r.student_id,
      score: scoreToNumber(r.score),
      comment: r.comment ?? null,
    }));

    console.log("[teacher/grades/scores] done", {
      evaluation_id,
      items_count: items.length,
    });

    return json({
      ok: true,
      evaluation_id,
      items,
      count: items.length,
    });
  } catch (e: any) {
    console.error("[teacher/grades/scores] unexpected error", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}
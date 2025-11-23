// src/app/api/teacher/grades/scores/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getCurrentUser() {
  const supabase = await getSupabaseServerClient(); // ✅ await
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return { user: null, error: "Non authentifié" };
  return { user: data.user, error: null as string | null };
}

async function isAdminOrSuper(userId: string) {
  const svc = getSupabaseServiceClient();
  const { data, error } = await svc
    .from("user_roles")
    .select("role")
    .eq("profile_id", userId);

  if (error) return false;
  const roles = (data ?? []).map((r) => r.role as string);
  return roles.includes("super_admin") || roles.includes("admin");
}

async function ensureTeacherHasEvaluation(userId: string, evaluationId: string) {
  const svc = getSupabaseServiceClient();
  const { data: ev } = await svc
    .from("grade_evaluations")
    .select("id, class_id, teacher_id")
    .eq("id", evaluationId)
    .maybeSingle();

  if (!ev) return { ok: false, error: "Évaluation introuvable" };

  const admin = await isAdminOrSuper(userId);
  if (admin || ev.teacher_id === userId) return { ok: true, error: null };

  const { data: ct } = await svc
    .from("class_teachers")
    .select("id")
    .eq("class_id", ev.class_id)
    .eq("teacher_id", userId)
    .maybeSingle();

  if (!ct) return { ok: false, error: "Accès refusé à cette évaluation" };
  return { ok: true, error: null };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const evaluation_id = url.searchParams.get("evaluation_id");

  if (!evaluation_id) {
    return NextResponse.json(
      { ok: false, error: "evaluation_id manquant" },
      { status: 400 }
    );
  }

  const { user, error: authErr } = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: authErr }, { status: 401 });
  }

  const svc = getSupabaseServiceClient();
  const { ok, error } = await ensureTeacherHasEvaluation(user.id, evaluation_id);
  if (!ok) {
    return NextResponse.json({ ok: false, error }, { status: 403 });
  }

  const { data, error: err } = await svc
    .from("student_grades")
    .select("student_id, score")
    .eq("evaluation_id", evaluation_id);

  if (err) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}

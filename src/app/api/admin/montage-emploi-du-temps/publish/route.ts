import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ ok: false, error: "unauthorized", message: "Utilisateur non connecté." }, { status: 401 }) };
  const { data: me, error: meErr } = await supa.from("profiles").select("id,institution_id").eq("id", user.id).maybeSingle();
  if (meErr) return { ok: false as const, response: NextResponse.json({ ok: false, error: "profile_failed", message: meErr.message }, { status: 400 }) };
  const institutionId = me?.institution_id ? String(me.institution_id) : "";
  if (!institutionId) return { ok: false as const, response: NextResponse.json({ ok: false, error: "no_institution", message: "Aucune institution associée à ce compte." }, { status: 400 }) };
  const { data: roleRow, error: roleErr } = await supa.from("user_roles").select("role").eq("profile_id", user.id).eq("institution_id", institutionId).maybeSingle();
  if (roleErr) return { ok: false as const, response: NextResponse.json({ ok: false, error: "role_failed", message: roleErr.message }, { status: 400 }) };
  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) return { ok: false as const, response: NextResponse.json({ ok: false, error: "forbidden", message: "Droits insuffisants." }, { status: 403 }) };
  return { ok: true as const, srv, userId: user.id, institutionId };
}

export async function POST(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;
    const body = (await req.json().catch(() => ({}))) as { project_id?: string };
    const projectId = String(body.project_id || "").trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "missing_project_id", message: "Identifiant du brouillon manquant." }, { status: 400 });
    const { data: project, error: projectError } = await guard.srv
      .from("montage_timetable_projects")
      .select("id,status,diagnostics,engine_result")
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId)
      .maybeSingle();

    if (projectError) {
      return NextResponse.json(
        { ok: false, error: "project_fetch_failed", message: projectError.message },
        { status: 400 },
      );
    }

    if (!project) {
      return NextResponse.json(
        { ok: false, error: "project_not_found", message: "Brouillon introuvable." },
        { status: 404 },
      );
    }

    if (String(project.status || "") !== "ready") {
      return NextResponse.json(
        {
          ok: false,
          error: "project_not_ready",
          message: "Publication bloquée : le brouillon doit être au statut prêt, sans erreur bloquante.",
        },
        { status: 409 },
      );
    }

    const diagnostics = Array.isArray(project.diagnostics) ? project.diagnostics : [];
    const blockingDiagnostics = diagnostics.filter((item: any) => {
      const level = String(item?.level || "");
      const warningType = String(item?.warning_type || item?.warningType || "");
      return (
        level === "error" ||
        warningType === "student_gap" ||
        warningType === "single_hour_return" ||
        warningType === "same_subject_same_day" ||
        warningType === "school_closed_period" ||
        warningType === "break_cut_block"
      );
    });

    const engineResult = project.engine_result && typeof project.engine_result === "object"
      ? (project.engine_result as Record<string, any>)
      : {};
    const unplaced = Array.isArray(engineResult.unplaced) ? engineResult.unplaced : [];

    if (blockingDiagnostics.length > 0 || unplaced.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "blocking_diagnostics",
          message: `Publication bloquée : ${blockingDiagnostics.length} diagnostic(s) bloquant(s) et ${unplaced.length} bloc(s) non placé(s). Corrige le brouillon avant publication.`,
        },
        { status: 409 },
      );
    }

    const { data, error } = await guard.srv.rpc("montage_publish_timetable", {
      p_project_id: projectId,
      p_institution_id: guard.institutionId,
      p_user_id: guard.userId,
    });
    if (error) return NextResponse.json({ ok: false, error: "publish_failed", message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, result: data, message: typeof data?.message === "string" ? data.message : "Emploi du temps publié officiellement." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur pendant la publication." }, { status: 500 });
  }
}

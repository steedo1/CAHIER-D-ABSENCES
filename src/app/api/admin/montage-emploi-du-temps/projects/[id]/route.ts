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

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;
    const { id } = await context.params;
    const projectId = String(id || "").trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "missing_project_id", message: "Identifiant manquant." }, { status: 400 });
    const { data, error } = await guard.srv
      .from("montage_timetable_projects")
      .select("id,institution_id,created_by,name,status,academic_year_id,source_snapshot,engine_input,engine_result,diagnostics,published_at,archived_at,created_at,updated_at")
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: "project_fetch_failed", message: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ ok: false, error: "project_not_found", message: "Brouillon introuvable." }, { status: 404 });
    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await context.params;
    const projectId = String(id || "").trim();

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "missing_project_id", message: "Identifiant manquant." }, { status: 400 });
    }

    const { data: project, error: fetchError } = await guard.srv
      .from("montage_timetable_projects")
      .select("id,status,published_at")
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId)
      .maybeSingle();

    if (fetchError) return NextResponse.json({ ok: false, error: "project_fetch_failed", message: fetchError.message }, { status: 400 });
    if (!project) return NextResponse.json({ ok: false, error: "project_not_found", message: "Brouillon introuvable." }, { status: 404 });
    if (project.status === "published" || project.published_at) {
      return NextResponse.json({ ok: false, error: "project_published", message: "Un emploi du temps publié ne peut pas être supprimé depuis les brouillons." }, { status: 409 });
    }

    const { error: deleteError } = await guard.srv
      .from("montage_timetable_projects")
      .delete()
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId);

    if (deleteError) return NextResponse.json({ ok: false, error: "project_delete_failed", message: deleteError.message }, { status: 400 });
    return NextResponse.json({ ok: true, deleted_id: projectId, message: "Brouillon supprimé." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

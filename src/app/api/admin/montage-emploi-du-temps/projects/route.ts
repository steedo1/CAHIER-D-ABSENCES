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

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function GET(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const url = new URL(req.url);
    const includeArchived = url.searchParams.get("include_archived") === "1";
    const rawLimit = Number(url.searchParams.get("limit") || "12");
    const limit = Math.min(30, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 12));

    let query = guard.srv
      .from("montage_timetable_projects")
      .select("id,institution_id,created_by,name,status,academic_year_id,source_snapshot,engine_input,engine_result,diagnostics,published_at,archived_at,created_at,updated_at")
      .eq("institution_id", guard.institutionId);

    if (!includeArchived) query = query.neq("status", "archived");

    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ ok: false, error: "projects_fetch_failed", message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, items: data || [] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const status = String(body.status || "draft");
    if (!["draft", "ready", "published", "archived"].includes(status)) return NextResponse.json({ ok: false, error: "invalid_status", message: "Statut invalide." }, { status: 400 });

    // Anti-encombrement : par défaut, un nouveau brouillon HoraClasse archive les
    // anciens brouillons/prêts non publiés de la même institution. L'écran reste
    // lisible, tout en protégeant les emplois du temps déjà publiés.
    if (body.archive_previous !== false && status !== "published") {
      const { error: archiveError } = await guard.srv
        .from("montage_timetable_projects")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("institution_id", guard.institutionId)
        .in("status", ["draft", "ready"])
        .is("published_at", null);

      if (archiveError) {
        return NextResponse.json(
          {
            ok: false,
            error: "archive_previous_failed",
            message: archiveError.message,
          },
          { status: 400 },
        );
      }
    }

    const { data, error } = await guard.srv
      .from("montage_timetable_projects")
      .insert({
        institution_id: guard.institutionId,
        created_by: guard.userId,
        name: String(body.name || "Brouillon HoraClasse").trim(),
        status,
        academic_year_id: body.academic_year_id || null,
        source_snapshot: jsonObject(body.source_snapshot),
        engine_input: jsonObject(body.engine_input),
        engine_result: jsonObject(body.engine_result),
        diagnostics: jsonArray(body.diagnostics),
      })
      .select("id,institution_id,created_by,name,status,academic_year_id,source_snapshot,engine_input,engine_result,diagnostics,published_at,archived_at,created_at,updated_at")
      .single();
    if (error) return NextResponse.json({ ok: false, error: "project_create_failed", message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, item: data, message: "Brouillon créé avec succès." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const confirm = String(body.confirm || "").trim();

    if (confirm !== "SUPPRIMER_BROUILLONS_HORACLASSE") {
      return NextResponse.json(
        {
          ok: false,
          error: "confirmation_required",
          message: "Confirmation requise pour supprimer les brouillons HoraClasse.",
        },
        { status: 400 },
      );
    }

    // Suppression volontairement limitée aux projets non publiés. Les publications
    // officielles restent protégées.
    const { data, error } = await guard.srv
      .from("montage_timetable_projects")
      .delete()
      .eq("institution_id", guard.institutionId)
      .neq("status", "published")
      .select("id");

    if (error) {
      return NextResponse.json({ ok: false, error: "projects_delete_failed", message: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, deleted_count: data?.length || 0, message: "Brouillons HoraClasse supprimés." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

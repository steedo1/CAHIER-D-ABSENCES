import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { generateDraftTimetableFromSnapshot } from "@/modules/montage-emploi-du-temps/engine/generateDraftTimetable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();

  if (userErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "auth_failed", message: userErr.message },
        { status: 401 }
      ),
    };
  }

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "unauthorized", message: "Utilisateur non connecté." },
        { status: 401 }
      ),
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "profile_failed", message: meErr.message },
        { status: 400 }
      ),
    };
  }

  const institutionId = me?.institution_id ? String(me.institution_id) : "";

  if (!institutionId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          error: "no_institution",
          message: "Aucune institution associée à ce compte.",
        },
        { status: 400 }
      ),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (roleErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "role_failed", message: roleErr.message },
        { status: 400 }
      ),
    };
  }

  const role = String(roleRow?.role || "");

  if (!["admin", "super_admin"].includes(role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          error: "forbidden",
          message: "Droits insuffisants pour générer un montage.",
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true as const,
    srv,
    userId: user.id,
    institutionId,
  };
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await context.params;
    const projectId = String(id || "").trim();

    if (!projectId) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_project_id",
          message: "Identifiant du brouillon manquant.",
        },
        { status: 400 }
      );
    }

    const { data: project, error: fetchError } = await guard.srv
      .from("montage_timetable_projects")
      .select(
        `
        id,
        institution_id,
        name,
        status,
        source_snapshot,
        engine_input,
        engine_result,
        diagnostics,
        created_at,
        updated_at
      `
      )
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        {
          ok: false,
          error: "project_fetch_failed",
          message: fetchError.message,
        },
        { status: 400 }
      );
    }

    if (!project) {
      return NextResponse.json(
        {
          ok: false,
          error: "project_not_found",
          message: "Brouillon introuvable pour cet établissement.",
        },
        { status: 404 }
      );
    }

    if (project.status === "published") {
      return NextResponse.json(
        {
          ok: false,
          error: "project_already_published",
          message: "Ce brouillon est déjà publié et ne peut plus être régénéré.",
        },
        { status: 409 }
      );
    }

    const result = generateDraftTimetableFromSnapshot(project.source_snapshot);

    const { data: updated, error: updateError } = await guard.srv
      .from("montage_timetable_projects")
      .update({
        status: "ready",
        engine_result: result,
        diagnostics: result.diagnostics,
      })
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId)
      .select(
        `
        id,
        institution_id,
        name,
        status,
        source_snapshot,
        engine_input,
        engine_result,
        diagnostics,
        created_at,
        updated_at
      `
      )
      .single();

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error: "project_update_failed",
          message: updateError.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      item: updated,
      result,
      message: "Pré-montage généré avec succès.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Erreur serveur pendant la génération du pré-montage.",
      },
      { status: 500 }
    );
  }
}
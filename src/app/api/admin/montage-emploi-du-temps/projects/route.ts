import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectBody = {
  name?: string;
  status?: "draft" | "ready" | "published" | "archived";
  academic_year_id?: string | null;
  source_snapshot?: unknown;
  engine_input?: unknown;
  engine_result?: unknown;
  diagnostics?: unknown;
};

function toJsonObject(value: unknown, fallback: Record<string, unknown> = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  return value as Record<string, unknown>;
}

function toJsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown, fallback: string) {
  const text = String(value || "").trim();
  return text || fallback;
}

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
          message: "Droits insuffisants pour gérer les brouillons de montage.",
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

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const { data, error } = await guard.srv
      .from("montage_timetable_projects")
      .select(
        `
        id,
        institution_id,
        created_by,
        name,
        status,
        academic_year_id,
        source_snapshot,
        engine_input,
        engine_result,
        diagnostics,
        published_at,
        archived_at,
        created_at,
        updated_at
      `
      )
      .eq("institution_id", guard.institutionId)
      .order("updated_at", { ascending: false })
      .limit(30);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "projects_fetch_failed",
          message: error.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      items: data || [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Erreur serveur pendant le chargement des brouillons.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const body = (await req.json().catch(() => ({}))) as ProjectBody;

    const status = body.status || "draft";

    if (!["draft", "ready", "published", "archived"].includes(status)) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_status",
          message: "Statut de brouillon invalide.",
        },
        { status: 400 }
      );
    }

    const payload = {
      institution_id: guard.institutionId,
      created_by: guard.userId,
      name: cleanText(body.name, "Brouillon montage emploi du temps"),
      status,
      academic_year_id: body.academic_year_id || null,
      source_snapshot: toJsonObject(body.source_snapshot),
      engine_input: toJsonObject(body.engine_input),
      engine_result: toJsonObject(body.engine_result),
      diagnostics: toJsonArray(body.diagnostics),
    };

    const { data, error } = await guard.srv
      .from("montage_timetable_projects")
      .insert(payload)
      .select(
        `
        id,
        institution_id,
        created_by,
        name,
        status,
        academic_year_id,
        source_snapshot,
        engine_input,
        engine_result,
        diagnostics,
        published_at,
        archived_at,
        created_at,
        updated_at
      `
      )
      .single();

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "project_create_failed",
          message: error.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      item: data,
      message: "Brouillon créé avec succès.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Erreur serveur pendant la création du brouillon.",
      },
      { status: 500 }
    );
  }
}

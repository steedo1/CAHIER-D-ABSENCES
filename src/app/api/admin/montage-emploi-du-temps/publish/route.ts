import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

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
          message: "Droits insuffisants pour publier l’emploi du temps.",
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

export async function POST(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const body = (await req.json().catch(() => ({}))) as {
      project_id?: string;
    };

    const projectId = String(body.project_id || "").trim();

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

    const { data, error } = await guard.srv.rpc("montage_publish_timetable", {
      p_project_id: projectId,
      p_institution_id: guard.institutionId,
      p_user_id: guard.userId,
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "publish_failed",
          message: error.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      result: data,
      message:
        typeof data?.message === "string"
          ? data.message
          : "Emploi du temps publié officiellement.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Erreur serveur pendant la publication de l’emploi du temps.",
      },
      { status: 500 }
    );
  }
}

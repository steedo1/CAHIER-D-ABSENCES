// src/app/api/super/institutions/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getSupabaseActionClient } from "@/lib/supabase-server";
import { requireSuperAdminAccess } from "@/lib/super-admin-access";
import { mergeGeneralSchoolSettings } from "@/lib/school-settings-write";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/super/institutions/[id]
 * Body (tous optionnels): { name, code_unique, subscription_expires_at, settings_json }
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const access = await requireSuperAdminAccess();
  if ("error" in access) return access.error;
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const { id } = await context.params;
  const supabase = access.srv;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      code_unique?: string;
      subscription_expires_at?: string | null;
      settings_json?: any;
    };

    const update: Record<string, any> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.code_unique !== undefined) update.code_unique = body.code_unique;
    if (body.subscription_expires_at !== undefined)
      update.subscription_expires_at = body.subscription_expires_at;
    let previousSettings: unknown;
    if (body.settings_json !== undefined) {
      const current = await supabase.from("institutions").select("settings_json")
        .eq("id", id).maybeSingle();
      if (current.error) return NextResponse.json({ error: "settings_load_failed" }, { status: 503 });
      if (!current.data) return NextResponse.json({ error: "institution_not_found" }, { status: 404 });
      previousSettings = current.data.settings_json;
      const merged = mergeGeneralSchoolSettings(previousSettings, body.settings_json);
      if (!merged) return NextResponse.json({ error: "use_dedicated_settings_editor" }, { status: 400 });
      update.settings_json = merged;
    }

    if (!Object.keys(update).length) {
      return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
    }

    let query = supabase
      .from("institutions")
      .update(update)
      .eq("id", id);
    if (body.settings_json !== undefined) {
      query = previousSettings == null ? query.is("settings_json", null)
        : query.eq("settings_json", JSON.stringify(previousSettings));
    }
    const { data, error } = await query.select("id").maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "settings_changed_reload_required" }, { status: 409 });

    return NextResponse.json({ ok: true, item: { id: data.id } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN_ERROR" }, { status: 500 });
  }
}

/**
 * DELETE /api/super/institutions/[id]
 * Supprime une institution (protégé : super_admin).
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // Auth + rôle super_admin (client "action" pour cookies côté route handler)
  const s = await getSupabaseActionClient();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: roles } = await s.from("user_roles").select("role").eq("profile_id", user.id);
  if (!(roles ?? []).some((r) => r.role === "super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("institutions")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    const code = (error as any)?.code;
    if (code === "23503") {
      // FK violation: éléments rattachés
      return NextResponse.json(
        {
          error:
            "Suppression impossible : des éléments sont encore rattachés à cet établissement (admins, classes, etc.). Détache/supprime-les d'abord.",
          code,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message, code }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "Institution introuvable" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: data.id }, { status: 200 });
}

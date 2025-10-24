// src/app/api/super/institutions/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getSupabaseActionClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/super/institutions/[id]
 * Body (tous optionnels): { name, code_unique, subscription_expires_at, settings_json }
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = getSupabaseServiceClient();

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
    if (body.settings_json !== undefined) update.settings_json = body.settings_json;

    if (!Object.keys(update).length) {
      return NextResponse.json({ error: "Aucun champ Ã  mettre Ã  jour" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("institutions")
      .update(update)
      .eq("id", id)
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, item: { id: data.id } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "UNKNOWN_ERROR" }, { status: 500 });
  }
}

/**
 * DELETE /api/super/institutions/[id]
 * Supprime une institution (protÃ©gÃ©: super_admin).
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // ðŸ” Auth + rÃ´le super_admin (client "writable" pour cookies cÃ´tÃ© route handler)
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
      // FK violation: Ã©lÃ©ments rattachÃ©s
      return NextResponse.json(
        {
          error:
            "Suppression impossible : des Ã©lÃ©ments sont encore rattachÃ©s Ã  cet Ã©tablissement (admins, classes, etc.). DÃ©tache/supprime-les dâ€™abord.",
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

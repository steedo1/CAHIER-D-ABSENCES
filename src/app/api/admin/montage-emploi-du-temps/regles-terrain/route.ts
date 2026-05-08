import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { DEFAULT_TERRAIN_RULES, normalizeTerrainRules } from "@/modules/montage-emploi-du-temps/scheduler/terrainRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "unauthorized", message: "Utilisateur non connecté." }, { status: 401 }) };
  }
  const { data: me, error: meErr } = await supa.from("profiles").select("id,institution_id").eq("id", user.id).maybeSingle();
  if (meErr) return { ok: false as const, response: NextResponse.json({ ok: false, error: "profile_failed", message: meErr.message }, { status: 400 }) };
  const institutionId = me?.institution_id ? String(me.institution_id) : "";
  if (!institutionId) return { ok: false as const, response: NextResponse.json({ ok: false, error: "no_institution", message: "Aucune institution associée à ce compte." }, { status: 400 }) };
  const { data: roleRow, error: roleErr } = await supa.from("user_roles").select("role").eq("profile_id", user.id).eq("institution_id", institutionId).maybeSingle();
  if (roleErr) return { ok: false as const, response: NextResponse.json({ ok: false, error: "role_failed", message: roleErr.message }, { status: 400 }) };
  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "forbidden", message: "Droits insuffisants." }, { status: 403 }) };
  }
  return { ok: true as const, srv, userId: user.id, institutionId };
}

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;
    const { data, error } = await guard.srv
      .from("montage_timetable_terrain_rules")
      .select("id,rules,updated_at")
      .eq("institution_id", guard.institutionId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: "rules_fetch_failed", message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, rules: normalizeTerrainRules(data?.rules || DEFAULT_TERRAIN_RULES), item: data || null });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;
    const body = (await req.json().catch(() => ({}))) as { rules?: Record<string, unknown> };
    const rules = normalizeTerrainRules(body.rules || DEFAULT_TERRAIN_RULES);
    const { data, error } = await guard.srv
      .from("montage_timetable_terrain_rules")
      .upsert({ institution_id: guard.institutionId, rules, created_by: guard.userId, updated_by: guard.userId }, { onConflict: "institution_id" })
      .select("id,rules,updated_at")
      .single();
    if (error) return NextResponse.json({ ok: false, error: "rules_save_failed", message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, item: data, rules: data.rules, message: "Règles terrain HoraClasse sauvegardées." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

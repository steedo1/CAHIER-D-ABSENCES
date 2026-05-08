import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResourceType = "ordinary" | "pc_lab" | "svt_lab" | "computer_lab" | "sports_field";

type Payload = {
  id?: string;
  name?: string;
  resource_type?: ResourceType | string;
  capacity?: number | string | null;
  is_shared?: boolean;
  is_active?: boolean;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function validResourceType(value: unknown): ResourceType {
  const text = clean(value);
  if (["ordinary", "pc_lab", "svt_lab", "computer_lab", "sports_field"].includes(text)) {
    return text as ResourceType;
  }
  return "ordinary";
}

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

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

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const { data, error } = await guard.srv
      .from("montage_timetable_resources")
      .select("id,institution_id,name,resource_type,capacity,is_shared,is_active,metadata,created_at,updated_at")
      .eq("institution_id", guard.institutionId)
      .order("resource_type", { ascending: true })
      .order("name", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: "resources_fetch_failed", message: error.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      items: data || [],
      totals: {
        resources: data?.length || 0,
        active: (data || []).filter((item: any) => item.is_active).length,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const body = (await req.json().catch(() => ({}))) as Payload;
    const name = clean(body.name);
    if (!name) return NextResponse.json({ ok: false, error: "missing_name", message: "Nom de ressource obligatoire." }, { status: 400 });

    const payload = {
      institution_id: guard.institutionId,
      name,
      resource_type: validResourceType(body.resource_type),
      capacity: toNumberOrNull(body.capacity),
      is_shared: body.is_shared !== false,
      is_active: body.is_active !== false,
      updated_by: guard.userId,
    };

    const query = body.id
      ? guard.srv
          .from("montage_timetable_resources")
          .update(payload)
          .eq("id", body.id)
          .eq("institution_id", guard.institutionId)
          .select()
          .single()
      : guard.srv
          .from("montage_timetable_resources")
          .insert({ ...payload, created_by: guard.userId })
          .select()
          .single();

    const { data, error } = await query;
    if (error) return NextResponse.json({ ok: false, error: "save_failed", message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, item: data, message: "Ressource sauvegardée." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;
    const id = clean(new URL(req.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ ok: false, error: "missing_id", message: "Identifiant manquant." }, { status: 400 });

    const { error } = await guard.srv
      .from("montage_timetable_resources")
      .delete()
      .eq("id", id)
      .eq("institution_id", guard.institutionId);

    if (error) return NextResponse.json({ ok: false, error: "delete_failed", message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: "Ressource supprimée." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." }, { status: 500 });
  }
}

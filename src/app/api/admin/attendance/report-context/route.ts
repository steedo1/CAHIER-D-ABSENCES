import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meError } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meError) return NextResponse.json({ error: meError.message }, { status: 400 });

  const institutionId = String(me?.institution_id || "").trim();
  if (!institutionId) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: institution, error: institutionError } = await srv
    .from("institutions")
    .select("name,logo_url,head_name,head_title,settings_json")
    .eq("id", institutionId)
    .maybeSingle();
  if (institutionError) {
    return NextResponse.json({ error: institutionError.message }, { status: 400 });
  }

  const settings = institution?.settings_json && typeof institution.settings_json === "object"
    ? (institution.settings_json as Record<string, unknown>)
    : {};
  const settingText = (...keys: string[]) => {
    for (const key of keys) {
      const value = String(settings[key] || "").trim();
      if (value) return value;
    }
    return "";
  };

  return NextResponse.json({
    institution_id: institutionId,
    institution_name:
      String(institution?.name || "").trim() ||
      settingText("institution_name", "school_name", "header_title", "name", "label") ||
      "Établissement",
    logo_url: String(institution?.logo_url || "").trim() || null,
    head_name: String(institution?.head_name || "").trim() || null,
    head_title: String(institution?.head_title || "").trim() || null,
  });
}

// src/app/api/institution/settings/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 1) via profiles
  const { data: me } = await supa
    .from("profiles")
    .select("id, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (me?.institution_id as string) || null;

  // 2) fallback via user_roles (au cas où)
  if (!instId) {
    const { data: ur } = await srv
      .from("user_roles")
      .select("institution_id")
      .eq("profile_id", user.id);

    const first = (ur || []).find((r) => r.institution_id);
    if (first?.institution_id) instId = String(first.institution_id);
  }

  if (!instId) return NextResponse.json({ error: "no_institution" }, { status: 404 });

  const { data, error } = await srv
    .from("institutions")
    .select(
      [
        "name",
        "tz",
        "auto_lateness",
        "default_session_minutes",
        "logo_url",
        "phone",
        "email",
        "regional_direction",
        "postal_address",
        "status",
        "head_name",
        "head_title",
        "country_name",
        "country_motto",
        "ministry_name",
        "code",
        "settings_json",
      ].join(",")
    )
    .eq("id", instId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const row: any = data || {};
  const settings_json =
    row.settings_json && typeof row.settings_json === "object" ? row.settings_json : {};

  return NextResponse.json({
    // ✅ le champ le plus important
    institution_name: row.name ?? "",

    // utile aussi pour tes headers & UI
    tz: row.tz ?? "Africa/Abidjan",
    auto_lateness: Boolean(row.auto_lateness ?? true),
    default_session_minutes: Number(row.default_session_minutes ?? 60),

    institution_logo_url: row.logo_url ?? "",
    institution_phone: row.phone ?? "",
    institution_email: row.email ?? "",
    institution_region: row.regional_direction ?? "",
    institution_postal_address: row.postal_address ?? "",
    institution_status: row.status ?? "",
    institution_head_name: row.head_name ?? "",
    institution_head_title: row.head_title ?? "",

    country_name: row.country_name ?? "",
    country_motto: row.country_motto ?? "",
    ministry_name: row.ministry_name ?? "",
    institution_code: row.code ?? "",

    // ✅ pour tes fallbacks front (tu l’utilises déjà)
    settings_json,
  });
}

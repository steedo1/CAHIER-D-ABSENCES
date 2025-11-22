// src/app/api/admin/institution/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = { user: { id: string }; instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

/** Typage minimal des colonnes institutions qu'on utilise ici */
type InstitutionSettingsRow = {
  name: string | null;
  tz: string | null;
  auto_lateness: boolean | null;
  default_session_minutes: number | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  regional_direction: string | null;
  postal_address: string | null;
  status: string | null;
  head_name: string | null;
  head_title: string | null;
};

async function guard(
  supa: SupabaseClient,
  srv: SupabaseClient
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" };

  // 1) Essai via profiles
  const { data: me } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (me?.institution_id as string) || null;
  let roleProfile = String(me?.role || "");

  // 2) Complément via user_roles (admin / super_admin), si besoin
  let roleFromUR: string | null = null;
  if (!instId || !["admin", "super_admin"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role, institution_id")
      .eq("profile_id", user.id);

    const adminRow = (urRows || []).find((r) =>
      ["admin", "super_admin"].includes(String(r.role || ""))
    );
    if (adminRow) {
      roleFromUR = String(adminRow.role);
      if (!instId && adminRow.institution_id)
        instId = String(adminRow.institution_id);
    }
  }

  const isAdmin =
    ["admin", "super_admin"].includes(roleProfile) ||
    ["admin", "super_admin"].includes(String(roleFromUR || ""));
  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

export async function GET() {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
  const g = await guard(supa, srv);
  if ("error" in g)
    return NextResponse.json({ error: g.error }, { status: 403 });

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
      ].join(",")
    )
    .eq("id", g.instId)
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const row = (data ?? {}) as InstitutionSettingsRow;

  return NextResponse.json({
    // ✅ Nom de l'établissement exposé pour le dashboard & autres écrans
    institution_name: row.name ?? "",
    tz: row.tz ?? "Africa/Abidjan",
    auto_lateness: Boolean(row.auto_lateness ?? true),
    default_session_minutes: Number(row.default_session_minutes ?? 60),

    // ✅ mapping vers les clés utilisées côté front
    institution_logo_url: row.logo_url ?? "",
    institution_phone: row.phone ?? "",
    institution_email: row.email ?? "",
    institution_region: row.regional_direction ?? "",
    institution_postal_address: row.postal_address ?? "",
    institution_status: row.status ?? "",
    institution_head_name: row.head_name ?? "",
    institution_head_title: row.head_title ?? "",
  });
}

export async function PUT(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
  const g = await guard(supa, srv);
  if ("error" in g)
    return NextResponse.json({ error: g.error }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  const tz = String(body?.tz || "Africa/Abidjan").trim();
  const auto = !!body?.auto_lateness;

  const defMinRaw = Number(body?.default_session_minutes);
  const defMin =
    Number.isFinite(defMinRaw) && defMinRaw > 0
      ? Math.floor(defMinRaw)
      : 60;

  // ✅ Récupération des infos d'établissement envoyées par la page Paramètres
  const rawLogo =
    typeof body?.institution_logo_url === "string"
      ? body.institution_logo_url
      : "";
  const rawPhone =
    typeof body?.institution_phone === "string"
      ? body.institution_phone
      : "";
  const rawEmail =
    typeof body?.institution_email === "string"
      ? body.institution_email
      : "";
  const rawRegion =
    typeof body?.institution_region === "string"
      ? body.institution_region
      : "";
  const rawPostal =
    typeof body?.institution_postal_address === "string"
      ? body.institution_postal_address
      : "";
  const rawStatus =
    typeof body?.institution_status === "string"
      ? body.institution_status
      : "";
  const rawHeadName =
    typeof body?.institution_head_name === "string"
      ? body.institution_head_name
      : "";
  const rawHeadTitle =
    typeof body?.institution_head_title === "string"
      ? body.institution_head_title
      : "";

  // On trim, et on convertit les vides en null pour la BDD
  const logo_url = rawLogo.trim() || null;
  const phone = rawPhone.trim() || null;
  const email = rawEmail.trim() || null;
  const regional_direction = rawRegion.trim() || null;
  const postal_address = rawPostal.trim() || null;
  const status = rawStatus.trim() || null;
  const head_name = rawHeadName.trim() || null;
  const head_title = rawHeadTitle.trim() || null;

  const { error } = await srv
    .from("institutions")
    .update({
      tz,
      auto_lateness: auto,
      default_session_minutes: defMin,
      logo_url,
      phone,
      email,
      regional_direction,
      postal_address,
      status,
      head_name,
      head_title,
    })
    .eq("id", g.instId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}


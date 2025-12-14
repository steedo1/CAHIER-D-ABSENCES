//src/app/api/admin/institution/settings/route.ts
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

  // 🆕 champs pour l'en-tête officiel du bulletin
  country_name: string | null;
  country_motto: string | null;
  ministry_name: string | null;
  code: string | null; // code MEN / établissement

  // ✅ option signatures électroniques (niveau établissement)
  bulletin_signatures_enabled: boolean | null;

  // ✅ fallback (si name vide)
  settings_json?: any;
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
      if (!instId && adminRow.institution_id) instId = String(adminRow.institution_id);
    }
  }

  const isAdmin =
    ["admin", "super_admin"].includes(roleProfile) ||
    ["admin", "super_admin"].includes(String(roleFromUR || ""));

  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

function pickInstitutionName(row: InstitutionSettingsRow): string {
  const direct = String(row?.name || "").trim();
  if (direct) return direct;

  const sj = row?.settings_json;
  const fallback =
    (sj &&
      typeof sj === "object" &&
      (sj.institution_name ||
        sj.school_name ||
        sj.header_title ||
        sj.name ||
        sj.label)) ||
    "";

  return String(fallback || "").trim();
}

export async function GET() {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const g = await guard(supa, srv);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

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
        "bulletin_signatures_enabled",
        "settings_json",
      ].join(",")
    )
    .eq("id", g.instId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const row = (data ?? {}) as InstitutionSettingsRow;
  const institution_name = pickInstitutionName(row);

  // ✅ fallback si jamais la colonne n'existe pas encore (avant migration)
  const signaturesEnabled =
    typeof row?.bulletin_signatures_enabled === "boolean"
      ? row.bulletin_signatures_enabled
      : Boolean(row?.settings_json?.bulletin_signatures_enabled ?? false);

  return NextResponse.json({
    // ✅ clé principale (celle que tes écrans doivent utiliser)
    institution_name,

    // ✅ aliases compat (au cas où un écran attend encore name/label)
    name: institution_name,
    institution_label: institution_name,

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

    // ✅ toggle signatures bulletin (niveau établissement)
    bulletin_signatures_enabled: signaturesEnabled,

    // ✅ utile si tu fais des fallbacks côté front
    settings_json:
      row.settings_json && typeof row.settings_json === "object" ? row.settings_json : {},
  });
}

export async function PUT(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const g = await guard(supa, srv);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  // ✅ Nom établissement (IMPORTANT)
  const rawInstitutionName =
    typeof body?.institution_name === "string"
      ? body.institution_name
      : typeof body?.name === "string"
      ? body.name
      : typeof body?.institution_label === "string"
      ? body.institution_label
      : "";

  const institution_name = rawInstitutionName.trim();

  const tz = String(body?.tz || "Africa/Abidjan").trim();

  // ⚠️ si non fourni, on évite de forcer à false par erreur
  const auto =
    typeof body?.auto_lateness === "boolean" ? body.auto_lateness : true;

  const defMinRaw = Number(body?.default_session_minutes);
  const defMin =
    Number.isFinite(defMinRaw) && defMinRaw > 0 ? Math.floor(defMinRaw) : 60;

  const rawLogo =
    typeof body?.institution_logo_url === "string" ? body.institution_logo_url : "";
  const rawPhone =
    typeof body?.institution_phone === "string" ? body.institution_phone : "";
  const rawEmail =
    typeof body?.institution_email === "string" ? body.institution_email : "";
  const rawRegion =
    typeof body?.institution_region === "string" ? body.institution_region : "";
  const rawPostal =
    typeof body?.institution_postal_address === "string"
      ? body.institution_postal_address
      : "";
  const rawStatus =
    typeof body?.institution_status === "string" ? body.institution_status : "";
  const rawHeadName =
    typeof body?.institution_head_name === "string" ? body.institution_head_name : "";
  const rawHeadTitle =
    typeof body?.institution_head_title === "string"
      ? body.institution_head_title
      : "";

  const rawCountryName =
    typeof body?.country_name === "string" ? body.country_name : "";
  const rawCountryMotto =
    typeof body?.country_motto === "string" ? body.country_motto : "";
  const rawMinistryName =
    typeof body?.ministry_name === "string" ? body.ministry_name : "";
  const rawInstitutionCode =
    typeof body?.institution_code === "string" ? body.institution_code : "";

  // ✅ toggle signatures bulletin (niveau établissement)
  const signaturesEnabled =
    typeof body?.bulletin_signatures_enabled === "boolean"
      ? body.bulletin_signatures_enabled
      : typeof body?.signatures_enabled === "boolean"
      ? body.signatures_enabled
      : undefined;

  const logo_url = rawLogo.trim() || null;
  const phone = rawPhone.trim() || null;
  const email = rawEmail.trim() || null;
  const regional_direction = rawRegion.trim() || null;
  const postal_address = rawPostal.trim() || null;
  const status = rawStatus.trim() || null;
  const head_name = rawHeadName.trim() || null;
  const head_title = rawHeadTitle.trim() || null;

  const country_name = rawCountryName.trim() || null;
  const country_motto = rawCountryMotto.trim() || null;
  const ministry_name = rawMinistryName.trim() || null;
  const code = rawInstitutionCode.trim() || null;

  // ⚠️ Si on envoie institution_name vide, on n’écrase pas en BDD.
  const updatePayload: any = {
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
    country_name,
    country_motto,
    ministry_name,
    code,
  };

  if (institution_name) updatePayload.name = institution_name;

  // ✅ on ne set le toggle que s'il est fourni
  if (typeof signaturesEnabled === "boolean") {
    updatePayload.bulletin_signatures_enabled = signaturesEnabled;
  }

  const { error } = await srv
    .from("institutions")
    .update(updatePayload)
    .eq("id", g.instId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

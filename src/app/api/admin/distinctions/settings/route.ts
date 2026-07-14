import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  getInstitutionDefaultDistinctionSettings,
  isCSCAForDistinctions,
  normalizeDistinctionSettings,
  validateDistinctionSettings,
} from "@/lib/distinctions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardResult =
  | { ok: true; institutionId: string; userId: string; canWrite: boolean }
  | { ok: false; response: NextResponse };

async function guard(write = false): Promise<GuardResult> {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile } = await supa
    .from("profiles")
    .select("institution_id,role")
    .eq("id", user.id)
    .maybeSingle();

  let institutionId = String((profile as any)?.institution_id || "").trim();
  const roles = new Set<string>();
  if ((profile as any)?.role) roles.add(String((profile as any).role));

  const { data: userRoles } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  for (const row of userRoles || []) {
    const role = String((row as any).role || "");
    const rowInst = String((row as any).institution_id || "").trim();
    if (role) roles.add(role);
    if (!institutionId && rowInst) institutionId = rowInst;
  }

  if (!institutionId) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "no_institution" }, { status: 403 }),
    };
  }

  const canRead = ["admin", "super_admin", "founder", "educator"].some((role) => roles.has(role));
  const canWrite = ["admin", "super_admin"].some((role) => roles.has(role));

  if (!canRead || (write && !canWrite)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, institutionId, userId: user.id, canWrite };
}

export async function GET() {
  const auth = await guard(false);
  if (!auth.ok) return auth.response;

  const srv = getSupabaseServiceClient();
  const { data, error } = await srv
    .from("institutions")
    .select("id,name,code_unique,acronym,settings_json")
    .eq("id", auth.institutionId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message || "institution_not_found" },
      { status: 400 },
    );
  }

  const settingsJson =
    (data as any).settings_json && typeof (data as any).settings_json === "object"
      ? (data as any).settings_json
      : {};

  const institutionMeta = {
    id: data.id,
    name: data.name,
    code_unique: data.code_unique,
    acronym: data.acronym,
  };
  const hasCustomSettings = !!settingsJson.distinction_settings;
  const settings = normalizeDistinctionSettings(
    settingsJson.distinction_settings || getInstitutionDefaultDistinctionSettings(institutionMeta),
  );

  return NextResponse.json({
    ok: true,
    institution: {
      id: data.id,
      name: data.name || "Établissement",
      code_unique: data.code_unique || null,
      acronym: data.acronym || null,
    },
    source: hasCustomSettings
      ? "institution"
      : isCSCAForDistinctions(institutionMeta)
        ? "institution_profile"
        : "default",
    source_label: hasCustomSettings
      ? "Règles personnalisées de l’établissement"
      : isCSCAForDistinctions(institutionMeta)
        ? "Règles prédéfinies du CSCA"
        : "Règles générales Mon Cahier",
    can_write: auth.canWrite,
    settings,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await guard(true);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const settings = normalizeDistinctionSettings(body?.settings ?? body);
  const validationErrors = validateDistinctionSettings(settings);
  if (validationErrors.length > 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_distinction_settings", validation_errors: validationErrors },
      { status: 400 },
    );
  }
  const srv = getSupabaseServiceClient();

  const { data: institution, error: readError } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", auth.institutionId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ ok: false, error: readError.message }, { status: 400 });
  }

  const current =
    (institution as any)?.settings_json && typeof (institution as any).settings_json === "object"
      ? (institution as any).settings_json
      : {};

  const settings_json = {
    ...current,
    distinction_settings: settings,
    distinction_settings_updated_at: new Date().toISOString(),
    distinction_settings_updated_by: auth.userId,
  };

  const { error } = await srv
    .from("institutions")
    .update({ settings_json })
    .eq("id", auth.institutionId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, settings, source: "institution" });
}

export async function DELETE() {
  const auth = await guard(true);
  if (!auth.ok) return auth.response;

  const srv = getSupabaseServiceClient();
  const { data: institution, error: readError } = await srv
    .from("institutions")
    .select("id,name,code_unique,acronym,settings_json")
    .eq("id", auth.institutionId)
    .maybeSingle();

  if (readError || !institution) {
    return NextResponse.json(
      { ok: false, error: readError?.message || "institution_not_found" },
      { status: 400 },
    );
  }

  const current =
    (institution as any).settings_json && typeof (institution as any).settings_json === "object"
      ? { ...(institution as any).settings_json }
      : {};

  delete current.distinction_settings;
  delete current.distinction_settings_updated_at;
  delete current.distinction_settings_updated_by;

  const { error } = await srv
    .from("institutions")
    .update({ settings_json: current })
    .eq("id", auth.institutionId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const meta = {
    id: (institution as any).id,
    name: (institution as any).name,
    code_unique: (institution as any).code_unique,
    acronym: (institution as any).acronym,
  };
  const settings = getInstitutionDefaultDistinctionSettings(meta);
  const csca = isCSCAForDistinctions(meta);

  return NextResponse.json({
    ok: true,
    settings,
    source: csca ? "institution_profile" : "default",
    source_label: csca ? "Règles prédéfinies du CSCA" : "Règles générales Mon Cahier",
  });
}

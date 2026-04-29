// src/app/api/admin/grades/publication-settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SmsDigestMode = "manual" | "weekly" | "disabled";

type PublicationSettingsRow = {
  institution_id: string;
  require_admin_validation: boolean | null;
  auto_push_on_publish: boolean | null;
  sms_digest_mode: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSmsDigestMode(value: unknown): SmsDigestMode {
  const v = cleanText(value).toLowerCase();

  if (v === "weekly") return "weekly";
  if (v === "disabled") return "disabled";

  return "manual";
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const v = cleanText(value).toLowerCase();

  if (["true", "1", "yes", "oui", "on"].includes(v)) return true;
  if (["false", "0", "no", "non", "off"].includes(v)) return false;

  return fallback;
}

function serializeSettingsRow(row: PublicationSettingsRow) {
  return {
    institution_id: row.institution_id,
    require_admin_validation: row.require_admin_validation === true,
    auto_push_on_publish: row.auto_push_on_publish !== false,
    sms_digest_mode: normalizeSmsDigestMode(row.sms_digest_mode),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function getAdminContext() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user?.id) {
    return {
      ok: false as const,
      status: 401,
      error: "UNAUTHENTICATED",
    };
  }

  const srv = getSupabaseServiceClient();

  const { data: profile, error: profileErr } = await srv
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr || !profile?.id || !profile?.institution_id) {
    console.error("[admin/grades/publication-settings] profile error", profileErr);

    return {
      ok: false as const,
      status: 403,
      error: "PROFILE_OR_INSTITUTION_NOT_FOUND",
    };
  }

  const profileRow = profile as unknown as {
    id: string;
    institution_id: string;
  };

  const { data: roles, error: rolesErr } = await srv
    .from("user_roles")
    .select("role")
    .eq("profile_id", profileRow.id)
    .eq("institution_id", profileRow.institution_id);

  if (rolesErr) {
    console.error("[admin/grades/publication-settings] roles error", rolesErr);

    return {
      ok: false as const,
      status: 403,
      error: "ROLES_LOAD_FAILED",
    };
  }

  const roleSet = new Set<string>((roles ?? []).map((r: any) => String(r.role)));

  const allowed =
    roleSet.has("super_admin") ||
    roleSet.has("admin") ||
    roleSet.has("educator");

  if (!allowed) {
    return {
      ok: false as const,
      status: 403,
      error: "FORBIDDEN",
    };
  }

  return {
    ok: true as const,
    srv,
    userId: user.id,
    profileId: String(profileRow.id),
    institutionId: String(profileRow.institution_id),
    roles: roleSet,
  };
}

async function ensureSettingsRow(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string
): Promise<PublicationSettingsRow> {
  const selectColumns = [
    "institution_id",
    "require_admin_validation",
    "auto_push_on_publish",
    "sms_digest_mode",
    "created_at",
    "updated_at",
  ].join(",");

  const { data: existing, error: existingErr } = await srv
    .from("institution_grade_publication_settings")
    .select(selectColumns)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (existingErr) {
    console.error(
      "[admin/grades/publication-settings] existing settings error",
      existingErr
    );

    throw new Error(existingErr.message || "SETTINGS_FETCH_FAILED");
  }

  if (existing) {
    return existing as unknown as PublicationSettingsRow;
  }

  const { data: inserted, error: insertErr } = await srv
    .from("institution_grade_publication_settings")
    .insert({
      institution_id: institutionId,
      require_admin_validation: false,
      auto_push_on_publish: true,
      sms_digest_mode: "manual",
    })
    .select(selectColumns)
    .single();

  if (insertErr || !inserted) {
    console.error(
      "[admin/grades/publication-settings] insert default settings error",
      insertErr
    );

    throw new Error(insertErr?.message || "SETTINGS_CREATE_FAILED");
  }

  return inserted as unknown as PublicationSettingsRow;
}

/* ==========================================
   GET : lire les paramètres de publication
========================================== */
export async function GET() {
  try {
    const ctx = await getAdminContext();

    if (!ctx.ok) return bad(ctx.error, ctx.status);

    const row = await ensureSettingsRow(ctx.srv, ctx.institutionId);

    return NextResponse.json({
      ok: true,
      item: serializeSettingsRow(row),
    });
  } catch (e: any) {
    console.error("[admin/grades/publication-settings] unexpected GET", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}

/* ==========================================
   POST : enregistrer les paramètres
========================================== */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getAdminContext();

    if (!ctx.ok) return bad(ctx.error, ctx.status);

    const body = (await req.json().catch(() => ({}))) as {
      require_admin_validation?: boolean;
      auto_push_on_publish?: boolean;
      sms_digest_mode?: SmsDigestMode | string;
    };

    const current = await ensureSettingsRow(ctx.srv, ctx.institutionId);

    const requireAdminValidation = toBoolean(
      body.require_admin_validation,
      current.require_admin_validation === true
    );

    const autoPushOnPublish = toBoolean(
      body.auto_push_on_publish,
      current.auto_push_on_publish !== false
    );

    const smsDigestMode = normalizeSmsDigestMode(
      body.sms_digest_mode ?? current.sms_digest_mode
    );

    const { data, error } = await ctx.srv
      .from("institution_grade_publication_settings")
      .upsert(
        {
          institution_id: ctx.institutionId,
          require_admin_validation: requireAdminValidation,
          auto_push_on_publish: autoPushOnPublish,
          sms_digest_mode: smsDigestMode,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "institution_id" }
      )
      .select(
        [
          "institution_id",
          "require_admin_validation",
          "auto_push_on_publish",
          "sms_digest_mode",
          "created_at",
          "updated_at",
        ].join(",")
      )
      .single();

    if (error || !data) {
      console.error("[admin/grades/publication-settings] upsert error", error);
      return bad(error?.message || "SETTINGS_SAVE_FAILED", 400);
    }

    const saved = data as unknown as PublicationSettingsRow;

    return NextResponse.json({
      ok: true,
      item: serializeSettingsRow(saved),
    });
  } catch (e: any) {
    console.error("[admin/grades/publication-settings] unexpected POST", e);
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}
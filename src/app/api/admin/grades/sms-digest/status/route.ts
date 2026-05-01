// src/app/api/admin/grades/sms-digest/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SmsDigestMode = "manual" | "weekly" | "disabled";

type UserRoleRow = {
  profile_id: string;
  institution_id: string | null;
  role: string;
};

type PublicationSettingsRow = {
  institution_id: string;
  require_admin_validation: boolean | null;
  auto_push_on_publish: boolean | null;
  sms_digest_mode: SmsDigestMode | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const SETTINGS_TABLE = "grade_publication_settings";

const ADMIN_ROLES = new Set([
  "admin",
  "super_admin",
  "school_admin",
  "institution_admin",
  "admin_etablissement",
]);

function json(status: number, body: Record<string, any>) {
  return NextResponse.json(body, { status });
}

function isSmsDigestMode(value: unknown): value is SmsDigestMode {
  return value === "manual" || value === "weekly" || value === "disabled";
}

function safeIso(value: any): string | null {
  if (!value) return null;

  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function getMonthBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    monthStartIso: start.toISOString(),
    monthEndIso: end.toISOString(),
  };
}

async function getAdminContext(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
    error: userError,
  } = await supa.auth.getUser();

  if (userError || !user) {
    return {
      ok: false as const,
      status: 401,
      error: "Utilisateur non connecté.",
    };
  }

  const { data: roles, error: rolesError } = await srv
    .from("user_roles")
    .select("profile_id,institution_id,role")
    .eq("profile_id", user.id);

  if (rolesError) {
    return {
      ok: false as const,
      status: 500,
      error: rolesError.message || "Impossible de vérifier le rôle utilisateur.",
    };
  }

  const adminRoles = ((roles || []) as UserRoleRow[]).filter((r) =>
    ADMIN_ROLES.has(String(r.role || "").trim())
  );

  if (adminRoles.length === 0) {
    return {
      ok: false as const,
      status: 403,
      error: "Accès réservé à l’administration.",
    };
  }

  const requestedInstitutionId =
    req.nextUrl.searchParams.get("institution_id")?.trim() || null;

  const isSuperAdmin = adminRoles.some((r) => r.role === "super_admin");

  let institutionId: string | null = null;

  if (requestedInstitutionId && isSuperAdmin) {
    institutionId = requestedInstitutionId;
  } else {
    institutionId =
      adminRoles.find((r) => r.institution_id)?.institution_id || null;
  }

  if (!institutionId) {
    return {
      ok: false as const,
      status: 400,
      error: "Institution introuvable pour cet administrateur.",
    };
  }

  return {
    ok: true as const,
    user,
    srv,
    institutionId,
    roles: adminRoles,
    isSuperAdmin,
  };
}

async function getPublicationSettings(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string
) {
  const { data, error } = await srv
    .from(SETTINGS_TABLE)
    .select(
      "institution_id,require_admin_validation,auto_push_on_publish,sms_digest_mode,created_at,updated_at"
    )
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message ||
        "Impossible de charger les paramètres de publication des notes."
    );
  }

  const row = data as PublicationSettingsRow | null;

  const mode: SmsDigestMode = isSmsDigestMode(row?.sms_digest_mode)
    ? row!.sms_digest_mode
    : "weekly";

  return {
    institution_id: institutionId,
    require_admin_validation: Boolean(row?.require_admin_validation),
    auto_push_on_publish: row?.auto_push_on_publish !== false,
    sms_digest_mode: mode,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

async function getLatestBatch(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string
) {
  const { data, error } = await srv
    .from("grade_sms_digest_batches")
    .select(
      "id,trigger_type,status,sent_at,created_at,blocked_reason,total_parents,total_students,total_grades,total_sms,next_allowed_at"
    )
    .eq("institution_id", institutionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message || "Impossible de charger le dernier lot SMS."
    );
  }

  return data || null;
}

async function getOpenBatch(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string
) {
  const { data, error } = await srv
    .from("grade_sms_digest_batches")
    .select("id,trigger_type,status,created_at")
    .eq("institution_id", institutionId)
    .in("status", ["pending", "sending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message || "Impossible de vérifier les lots SMS en cours."
    );
  }

  return data || null;
}

async function getMonthlySentCount(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string
) {
  const { monthStartIso, monthEndIso } = getMonthBounds();

  const { count, error } = await srv
    .from("grade_sms_digest_batches")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", institutionId)
    .eq("status", "sent")
    .gte("sent_at", monthStartIso)
    .lt("sent_at", monthEndIso);

  if (error) {
    throw new Error(
      error.message || "Impossible de compter les envois SMS du mois."
    );
  }

  return count || 0;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAdminContext(req);

    if (!ctx.ok) {
      return json(ctx.status, {
        ok: false,
        error: ctx.error,
      });
    }

    const settings = await getPublicationSettings(ctx.srv, ctx.institutionId);
    const latestBatch = await getLatestBatch(ctx.srv, ctx.institutionId);
    const openBatch = await getOpenBatch(ctx.srv, ctx.institutionId);
    const monthlySentCount = await getMonthlySentCount(
      ctx.srv,
      ctx.institutionId
    );

    if (settings.sms_digest_mode === "disabled") {
      return json(200, {
        ok: true,
        institution_id: ctx.institutionId,
        settings,
        decision: {
          allowed: false,
          reason: "sms_disabled",
          message: "Le digest SMS des notes est désactivé pour cet établissement.",
          last_sent_at: safeIso(latestBatch?.sent_at),
          next_allowed_at: null,
          monthly_count: monthlySentCount,
          monthly_limit: 4,
          min_interval_days: 7,
        },
        latest_batch: latestBatch,
        open_batch: openBatch,
      });
    }

    const { data: decision, error: decisionError } = await ctx.srv.rpc(
      "can_create_grade_sms_digest_batch",
      {
        p_institution_id: ctx.institutionId,
        p_min_interval_days: 7,
        p_monthly_limit: 4,
      }
    );

    if (decisionError) {
      throw new Error(
        decisionError.message ||
          "Impossible de vérifier la règle SMS 7 jours / 4 envois."
      );
    }

    return json(200, {
      ok: true,
      institution_id: ctx.institutionId,
      settings,
      decision,
      latest_batch: latestBatch,
      open_batch: openBatch,
    });
  } catch (e: any) {
    return json(500, {
      ok: false,
      error: e?.message || "Erreur pendant le chargement du statut SMS digest.",
    });
  }
}
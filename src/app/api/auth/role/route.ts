import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { AppRole } from "@/lib/auth/role";
import { ROLE_PRIORITY } from "@/lib/auth/role";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { resolveClassDeviceClassIds } from "@/lib/class-device-identity";
import {
  isOfflineAccessRole,
  issueOfflineAccessGrant,
} from "@/lib/offline-auth-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

async function resolveClassDeviceScope(user: { id: string; phone?: string | null }) {
  try {
    const service = getSupabaseServiceClient();
    const classIds = await resolveClassDeviceClassIds({
      service,
      userId: user.id,
      userPhone: user.phone,
    });
    if (classIds.length !== 1) return null;
    const { data, error } = await service
      .from("classes")
      .select("id,institution_id")
      .eq("id", classIds[0])
      .maybeSingle();
    if (error || !data) return null;
    const classId = String(data.id || "").trim();
    const institutionId = String(data.institution_id || "").trim();
    return classId && institutionId ? { classId, institutionId } : null;
  } catch {
    return null;
  }
}

type InstitutionRelayState = {
  configured: boolean;
  enabled: boolean;
  local_url: string | null;
};

const RELAY_DISABLED: InstitutionRelayState = {
  configured: false,
  enabled: false,
  local_url: null,
};

async function resolveInstitutionRelayState(
  institutionId: string,
): Promise<InstitutionRelayState> {
  const expectedInstitutionId = String(institutionId || "").trim();
  if (!expectedInstitutionId) return RELAY_DISABLED;

  try {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from("institution_attendance_policies")
      .select("enabled,allow_local_relay,relay_local_url")
      .eq("institution_id", expectedInstitutionId)
      .maybeSingle();

    // L'absence de politique signifie explicitement « Cloud/PWA uniquement ».
    // Une erreur de lecture ne doit jamais transformer un établissement normal
    // en établissement relais par défaut.
    if (error || !data) return RELAY_DISABLED;

    const enabled = data.enabled === true && data.allow_local_relay === true;
    const localUrl = enabled
      ? String(data.relay_local_url || "").trim() || null
      : null;

    return {
      configured: true,
      enabled,
      local_url: localUrl,
    };
  } catch {
    return RELAY_DISABLED;
  }
}

export async function GET(request: NextRequest) {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return noStore({ role: null }, 401);
  }

  const { data: rows, error: rolesErr } = await supabase
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (rolesErr) {
    return noStore({ role: null, error: "role_lookup_failed" }, 503);
  }

  const roles = (rows ?? []).map((r: any) => r.role as AppRole);
  const primary = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? roles[0] ?? null;
  const primaryRow =
    (rows ?? []).find((row: any) => row.role === primary && row.institution_id) ||
    (rows ?? []).find((row: any) => row.institution_id) ||
    null;

  let institutionId = primaryRow?.institution_id
    ? String(primaryRow.institution_id)
    : "";
  let classId: string | null = null;
  if (primary === "class_device") {
    const classScope = await resolveClassDeviceScope(user);
    institutionId = classScope?.institutionId || "";
    classId = classScope?.classId || null;
  }

  const relay = await resolveInstitutionRelayState(institutionId);
  const deviceId = String(
    request.headers.get("x-mon-cahier-device-id") || "",
  ).trim();
  const secret =
    process.env.MON_CAHIER_OFFLINE_AUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  let offlineAccess: {
    token: string;
    expires_at: number;
    destination: string;
    role: string;
  } | null = null;

  if (
    primary &&
    isOfflineAccessRole(primary) &&
    institutionId &&
    /^[A-Za-z0-9:_-]{16,128}$/.test(deviceId) &&
    secret.length >= 32
  ) {
    try {
      // Le schéma applicatif versionné ne définit aucun indicateur is_active
      // sur profiles/user_roles. L'autorité disponible est donc ici un jeton
      // Supabase encore valide (getUser) associé à un rôle existant.
      const grant = await issueOfflineAccessGrant({
        secret,
        userId: user.id,
        institutionId,
        classId,
        deviceId,
        role: primary,
      });
      offlineAccess = {
        token: grant.token,
        expires_at: grant.payload.expires_at,
        destination: grant.payload.destination,
        role: grant.payload.role,
      };
    } catch {
      // Une configuration de grant invalide ne doit pas exposer le secret ni
      // casser la session en ligne. L'accès hors ligne reste simplement absent.
    }
  }

  return noStore({
    user_id: user.id,
    role: primary,
    institution_id: institutionId || null,
    relay,
    offline_access: offlineAccess,
  });
}

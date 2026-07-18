import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WRITE_ROLES = new Set(["admin", "super_admin"]);

async function guard() {
  const supa = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" as const, status: 401 };

  const { data: profile } = await service
    .from("profiles")
    .select("id,institution_id,role")
    .eq("id", user.id)
    .maybeSingle();
  const { data: roles } = await service
    .from("user_roles")
    .select("institution_id,role")
    .eq("profile_id", user.id);

  const profileInstitutionId = String(profile?.institution_id || "").trim();
  const profileHasWriteRole = WRITE_ROLES.has(String(profile?.role || ""));
  const roleForProfileInstitution = (roles || []).find(
    (row: any) =>
      WRITE_ROLES.has(String(row.role || "")) &&
      String(row.institution_id || "").trim() === profileInstitutionId,
  );
  const firstWritableRole = (roles || []).find(
    (row: any) => WRITE_ROLES.has(String(row.role || "")) && String(row.institution_id || "").trim(),
  );
  const institutionId =
    (profileInstitutionId && (profileHasWriteRole || roleForProfileInstitution)
      ? profileInstitutionId
      : "") || String(firstWritableRole?.institution_id || "").trim();
  const allowed = Boolean(institutionId);
  if (!institutionId) return { error: "no_institution" as const, status: 403 };
  if (!allowed) return { error: "forbidden" as const, status: 403 };
  return { user, institutionId, service };
}

function defaults() {
  return {
    enabled: false,
    teacher_accounts_only: true,
    allow_local_relay: true,
    allow_gps_fallback: true,
    relay_local_url: null as string | null,
    max_gps_accuracy_m: 60,
    gps_grace_m: 25,
    relay_proof_ttl_seconds: 180,
  };
}

function relayUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.length > 500) throw new Error("L'adresse du relais local est trop longue.");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("L'adresse du relais local est invalide.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new Error("Utilisez une adresse HTTP(S) sans identifiant, par exemple http://192.168.1.20:4317.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export async function GET() {
  const access = await guard();
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const [policyResult, zonesResult] = await Promise.all([
    access.service
      .from("institution_attendance_policies")
      .select(
        "enabled,teacher_accounts_only,allow_local_relay,allow_gps_fallback,relay_local_url,max_gps_accuracy_m,gps_grace_m,relay_proof_ttl_seconds",
      )
      .eq("institution_id", access.institutionId)
      .maybeSingle(),
    access.service
      .from("institution_attendance_zones")
      .select("id,name,latitude,longitude,radius_m,is_active")
      .eq("institution_id", access.institutionId)
      .order("name", { ascending: true }),
  ]);
  if (policyResult.error) {
    return NextResponse.json({ error: policyResult.error.message }, { status: 400 });
  }
  if (zonesResult.error) {
    return NextResponse.json({ error: zonesResult.error.message }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    policy: { ...defaults(), ...(policyResult.data || {}) },
    zones: zonesResult.data || [],
  });
}

export async function PUT(request: NextRequest) {
  const access = await guard();
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const body = await request.json().catch(() => ({}));
  const rawPolicy = body?.policy || {};
  const rawZones = Array.isArray(body?.zones) ? body.zones : [];
  const integer = (value: unknown, fallback: number, min: number, max: number) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  let normalizedRelayUrl: string | null;
  try {
    normalizedRelayUrl = relayUrl(rawPolicy.relay_local_url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Adresse du relais invalide." },
      { status: 422 },
    );
  }
  const policy = {
    institution_id: access.institutionId,
    enabled: rawPolicy.enabled === true,
    teacher_accounts_only: true,
    allow_local_relay: rawPolicy.allow_local_relay !== false,
    allow_gps_fallback: rawPolicy.allow_gps_fallback !== false,
    relay_local_url: normalizedRelayUrl,
    max_gps_accuracy_m: integer(rawPolicy.max_gps_accuracy_m, 60, 10, 500),
    gps_grace_m: integer(rawPolicy.gps_grace_m, 25, 0, 100),
    relay_proof_ttl_seconds: integer(rawPolicy.relay_proof_ttl_seconds, 180, 30, 600),
    updated_at: new Date().toISOString(),
  };

  if (policy.enabled && !policy.allow_local_relay && !policy.allow_gps_fallback) {
    return NextResponse.json(
      { error: "Activez au moins une méthode : relais local ou GPS." },
      { status: 422 },
    );
  }
  if (policy.enabled && policy.allow_local_relay && !policy.allow_gps_fallback && !policy.relay_local_url) {
    return NextResponse.json(
      { error: "Renseignez l'adresse locale du relais avant d'imposer le réseau local." },
      { status: 422 },
    );
  }

  const zones: Array<Record<string, unknown>> = [];
  for (const [index, raw] of rawZones.entries()) {
    const id = String(raw?.id || "").trim();
    const name = String(raw?.name || "").trim() || `Site ${index + 1}`;
    const latitude = Number(raw?.latitude);
    const longitude = Number(raw?.longitude);
    const radius = integer(raw?.radius_m, 150, 30, 5000);
    if (!id || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return NextResponse.json({ error: `Latitude invalide pour ${name}.` }, { status: 422 });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: `Longitude invalide pour ${name}.` }, { status: 422 });
    }
    zones.push({
      id,
      institution_id: access.institutionId,
      name,
      latitude,
      longitude,
      radius_m: radius,
      is_active: raw?.is_active !== false,
      updated_at: new Date().toISOString(),
    });
  }
  if (policy.enabled && policy.allow_gps_fallback && !zones.some((zone) => zone.is_active)) {
    return NextResponse.json(
      { error: "Ajoutez au moins une zone active avant d'autoriser les appels par GPS." },
      { status: 422 },
    );
  }

  const { error: policyError } = await access.service
    .from("institution_attendance_policies")
    .upsert(policy, { onConflict: "institution_id" });
  if (policyError) return NextResponse.json({ error: policyError.message }, { status: 400 });

  const { data: existing, error: existingError } = await access.service
    .from("institution_attendance_zones")
    .select("id")
    .eq("institution_id", access.institutionId);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 400 });

  if (zones.length) {
    const { error: zonesError } = await access.service
      .from("institution_attendance_zones")
      .upsert(zones, { onConflict: "id" });
    if (zonesError) return NextResponse.json({ error: zonesError.message }, { status: 400 });
  }
  const keep = new Set(zones.map((zone) => String(zone.id)));
  const removeIds = (existing || [])
    .map((row: any) => String(row.id))
    .filter((id: string) => !keep.has(id));
  if (removeIds.length) {
    const { error: deleteError } = await access.service
      .from("institution_attendance_zones")
      .delete()
      .eq("institution_id", access.institutionId)
      .in("id", removeIds);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

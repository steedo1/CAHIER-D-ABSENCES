import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { buildRelayBootstrapSnapshot } from "@/lib/relay-bootstrap-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "founder"]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const requestedInstitutionId = text(new URL(request.url).searchParams.get("institution_id"));
  const { data: profile } = await srv
    .from("profiles")
    .select("id,institution_id,role")
    .eq("id", user.id)
    .maybeSingle();
  const { data: roleRows, error: roleError } = await srv
    .from("user_roles")
    .select("profile_id,institution_id,role")
    .eq("profile_id", user.id);
  if (roleError) return NextResponse.json({ error: roleError.message }, { status: 400 });

  const allowedInstitutions = new Set<string>();
  if (ALLOWED_ROLES.has(text((profile as any)?.role)) && text((profile as any)?.institution_id)) {
    allowedInstitutions.add(text((profile as any).institution_id));
  }
  for (const row of roleRows || []) {
    if (ALLOWED_ROLES.has(text((row as any).role)) && text((row as any).institution_id)) {
      allowedInstitutions.add(text((row as any).institution_id));
    }
  }

  const institutionId = requestedInstitutionId || Array.from(allowedInstitutions)[0] || "";
  if (!institutionId) return NextResponse.json({ error: "no_institution" }, { status: 403 });
  if (!allowedInstitutions.has(institutionId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Garde serveur obligatoire : un snapshot relais ne peut être construit que
  // pour un établissement qui a explicitement activé le relais ET possède au
  // moins un PC relais actif enregistré. NULL/false/aucun appareil = interdit.
  const [policyResult, deviceResult] = await Promise.all([
    srv
      .from("institution_attendance_policies")
      .select("allow_local_relay")
      .eq("institution_id", institutionId)
      .maybeSingle(),
    srv
      .from("relay_sync_devices")
      .select("id", { count: "exact", head: true })
      .eq("institution_id", institutionId)
      .eq("is_active", true),
  ]);

  const allowLocalRelay = policyResult.data?.allow_local_relay === true;
  const activeRelayDevices = deviceResult.error
    ? 0
    : Math.max(0, Number(deviceResult.count || 0));
  const relayCapable = allowLocalRelay && activeRelayDevices > 0;

  if (!relayCapable) {
    return NextResponse.json(
      {
        error: "relay_not_enabled",
        message: "Mon Cahier Relais n'est pas activé pour cet établissement.",
        relay_capable: false,
      },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  try {
    const snapshot = await buildRelayBootstrapSnapshot(srv, institutionId);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: String(error?.message || "relay_bootstrap_failed") },
      { status: 400 },
    );
  }
}

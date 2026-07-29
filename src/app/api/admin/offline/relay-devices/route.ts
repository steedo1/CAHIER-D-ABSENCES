import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "super_admin", "founder"]);

function text(value: unknown) {
  return String(value || "").trim();
}

async function adminContext(request: NextRequest) {
  const auth = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const requestedInstitutionId = text(new URL(request.url).searchParams.get("institution_id"));
  const [{ data: profile }, { data: roles, error: rolesError }] = await Promise.all([
    service.from("profiles").select("id,institution_id,role").eq("id", user.id).maybeSingle(),
    service.from("user_roles").select("institution_id,role").eq("profile_id", user.id),
  ]);
  if (rolesError) {
    return { response: NextResponse.json({ error: "role_lookup_failed" }, { status: 503 }) };
  }
  const grants = new Map<string, Set<string>>();
  const add = (institutionId: unknown, role: unknown) => {
    const id = text(institutionId);
    const normalizedRole = text(role);
    if (!id || !ALLOWED_ROLES.has(normalizedRole)) return;
    const set = grants.get(id) || new Set<string>();
    set.add(normalizedRole);
    grants.set(id, set);
  };
  add((profile as any)?.institution_id, (profile as any)?.role);
  for (const row of roles || []) add((row as any).institution_id, (row as any).role);
  const institutionId = requestedInstitutionId || Array.from(grants.keys())[0] || "";
  if (!institutionId || !grants.has(institutionId)) {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  const { data: institution, error: institutionError } = await service
    .from("institutions")
    .select("id,name,code,code_unique")
    .eq("id", institutionId)
    .maybeSingle();
  if (institutionError || !institution) {
    return { response: NextResponse.json({ error: "institution_lookup_failed" }, { status: 503 }) };
  }
  return {
    user,
    service,
    institutionId,
    institution: {
      id: institutionId,
      name: text((institution as any).name) || "Établissement",
      code: text((institution as any).code_unique) || text((institution as any).code),
    },
  };
}

export async function GET(request: NextRequest) {
  const context = await adminContext(request);
  if ("response" in context) return context.response;
  const { data, error } = await context.service
    .from("relay_sync_devices")
    .select("id,institution_id,label,is_active,last_seen_at,revoked_at,created_at,updated_at")
    .eq("institution_id", context.institutionId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, institution: context.institution, items: data || [] }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const context = await adminContext(request);
  if ("response" in context) return context.response;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const bodyInstitutionId = text(body.institution_id);
  if (bodyInstitutionId && bodyInstitutionId !== context.institutionId) {
    return NextResponse.json({ error: "institution_mismatch" }, { status: 403 });
  }
  if (!context.institution.code) {
    return NextResponse.json({ error: "institution_code_missing" }, { status: 409 });
  }
  const label = text(body.label) || "Relais principal";
  if (label.length > 120) {
    return NextResponse.json({ error: "label_too_long" }, { status: 400 });
  }
  const deviceId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `${deviceId}.${secret}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = new Date().toISOString();
  const { error } = await context.service.from("relay_sync_devices").insert({
    id: deviceId,
    institution_id: context.institutionId,
    label,
    token_hash: tokenHash,
    is_active: true,
    created_by: context.user.id,
    created_at: now,
    updated_at: now,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const pushUrl = `${new URL(request.url).origin}/api/relay/sync/push`;
  return NextResponse.json({
    ok: true,
    item: {
      id: deviceId,
      institution_id: context.institutionId,
      institution_code: context.institution.code,
      institution_name: context.institution.name,
      label,
      push_url: pushUrl,
      token,
      token_displayed_once: true,
    },
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const context = await adminContext(request);
  if ("response" in context) return context.response;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const deviceId = text(body.device_id);
  if (!deviceId) return NextResponse.json({ error: "device_id_required" }, { status: 400 });
  const now = new Date().toISOString();
  const { data, error } = await context.service
    .from("relay_sync_devices")
    .update({ is_active: false, revoked_at: now, updated_at: now })
    .eq("id", deviceId)
    .eq("institution_id", context.institutionId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "device_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, device_id: deviceId, revoked_at: now });
}

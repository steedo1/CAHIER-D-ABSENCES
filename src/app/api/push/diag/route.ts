import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sid(x: unknown, n = 16) {
  const s = String(x ?? "");
  return s.length <= n ? s : `${s.slice(0, 6)}…${s.slice(-6)}`;
}

async function parentIdFromDevice(srv: ReturnType<typeof getSupabaseServiceClient>, deviceId: string) {
  try {
    const { data } = await (srv as any).rpc("ensure_parent_profile", { p_device: deviceId }).single();
    return data?.ensure_parent_profile || data?.parent_profile_id || data?.parent_id || data || null;
  } catch {}
  try {
    const { data } = await srv.from("parent_devices").select("parent_profile_id").eq("device_id", deviceId).maybeSingle();
    return data?.parent_profile_id || null;
  } catch {}
  return null;
}

export async function GET() {
  const srv = getSupabaseServiceClient();
  const jar = await cookies();
  const device = jar.get("parent_device")?.value || null;
  const parentId = device ? await parentIdFromDevice(srv, device) : null;

  let subs: any[] = [];
  if (parentId) {
    const { data } = await srv
      .from("push_subscriptions")
      .select("user_id, platform, device_id, created_at")
      .eq("user_id", parentId)
      .order("created_at", { ascending: false });
    subs = data || [];
  }

  return NextResponse.json({
    ok: true,
    cookie_parent_device: device,
    cookie_parent_device_preview: sid(device),
    resolved_parent_id: parentId,
    resolved_parent_id_preview: sid(parentId),
    subs_count_for_parent: subs.length,
    subs_preview: subs.slice(0, 3),
  });
}

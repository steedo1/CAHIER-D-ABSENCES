// src/app/api/parent/notifications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { readParentSessionFromReq } from "@/lib/parent-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PARENT_NOTIFICATION_KIND_FILTER = [
  "payload->>kind.eq.attendance",
  "payload->>kind.eq.penalty",
  "payload->>kind.eq.conduct_penalty",
  "payload->>kind.eq.communication",
  "payload->>kind.eq.finance_reminder",
  "payload->>type.eq.finance_reminder",
  "payload->>event.eq.communication",
  "payload->>event.eq.finance_reminder",
].join(",");

type NotificationScope = {
  parentIds: string[];
  studentIds: string[];
};

function uniq(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((v) => String(v || "").trim()).filter(Boolean)),
  );
}

function buildOwnerOr(scope: NotificationScope) {
  const parts: string[] = [];
  if (scope.parentIds.length === 1) parts.push(`parent_id.eq.${scope.parentIds[0]}`);
  if (scope.parentIds.length > 1) parts.push(`parent_id.in.(${scope.parentIds.join(",")})`);
  if (scope.studentIds.length === 1) parts.push(`student_id.eq.${scope.studentIds[0]}`);
  if (scope.studentIds.length > 1) parts.push(`student_id.in.(${scope.studentIds.join(",")})`);
  return parts.join(",");
}

async function resolveDeviceScope(
  req: NextRequest,
  srv: ReturnType<typeof getSupabaseServiceClient>,
): Promise<NotificationScope | null> {
  const deviceId = req.cookies.get("parent_device")?.value || "";
  if (!deviceId) return null;

  const parentIds: string[] = [];
  try {
    const { data: dev } = await srv
      .from("parent_devices")
      .select("parent_profile_id")
      .eq("device_id", deviceId)
      .maybeSingle();

    if ((dev as any)?.parent_profile_id) parentIds.push(String((dev as any).parent_profile_id));
  } catch {}

  const { data: links, error } = await srv
    .from("parent_device_children")
    .select("student_id")
    .eq("device_id", deviceId);

  if (error) throw error;

  const studentIds = uniq((links || []).map((row: any) => row?.student_id));
  const scope = { parentIds: uniq(parentIds), studentIds };
  return scope.parentIds.length || scope.studentIds.length ? scope : null;
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));
  const claims = user ? null : readParentSessionFromReq(req);

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

  if (user) {
    const { data, error } = await supa
      .from("notifications_queue")
      .select("id,title,body,severity,created_at,read_at,payload")
      .eq("parent_id", user.id)
      .or(PARENT_NOTIFICATION_KIND_FILTER)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ items: data || [] });
  }

  if (claims) {
    const { uid, sid } = claims;
    const { data, error } = await srv
      .from("notifications_queue")
      .select("id,title,body,severity,created_at,read_at,payload")
      .or(`parent_id.eq.${uid},student_id.eq.${sid}`)
      .or(PARENT_NOTIFICATION_KIND_FILTER)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ items: data || [] });
  }

  try {
    const scope = await resolveDeviceScope(req, srv);
    const ownerOr = scope ? buildOwnerOr(scope) : "";
    if (!ownerOr) return NextResponse.json({ items: [] });

    const { data, error } = await srv
      .from("notifications_queue")
      .select("id,title,body,severity,created_at,read_at,payload")
      .or(ownerOr)
      .or(PARENT_NOTIFICATION_KIND_FILTER)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ items: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));
  const claims = user ? null : readParentSessionFromReq(req);

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return NextResponse.json({ ok: true, updated: 0 });

  const nowIso = new Date().toISOString();

  if (user) {
    const { data, error } = await supa
      .from("notifications_queue")
      .update({ read_at: nowIso })
      .in("id", ids)
      .eq("parent_id", user.id)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, updated: data?.length || 0, read_at: nowIso });
  }

  if (claims) {
    const { uid, sid } = claims;
    const { data, error } = await srv
      .from("notifications_queue")
      .update({ read_at: nowIso })
      .in("id", ids)
      .or(`parent_id.eq.${uid},student_id.eq.${sid}`)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, updated: data?.length || 0, read_at: nowIso });
  }

  try {
    const scope = await resolveDeviceScope(req, srv);
    const ownerOr = scope ? buildOwnerOr(scope) : "";
    if (!ownerOr) return NextResponse.json({ ok: true, updated: 0, read_at: nowIso });

    const { data, error } = await srv
      .from("notifications_queue")
      .update({ read_at: nowIso })
      .in("id", ids)
      .or(ownerOr)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, updated: data?.length || 0, read_at: nowIso });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}

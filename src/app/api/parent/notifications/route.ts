import { filterParentConnectNotifications } from "@/lib/parent-connect/server";
import { normalizeParentNotifications } from "@/lib/parent-connect/notification-inbox";
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
  "payload->>kind.eq.infirmary_visit",
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
  // Student-linked searches may only include recipient-less broadcasts.
  // Never fetch other guardians' recipient-specific rows using student_id.
  const studentClause = scope.studentIds.length === 1
    ? `student_id.eq.${scope.studentIds[0]}`
    : scope.studentIds.length > 1
      ? `student_id.in.(${scope.studentIds.join(",")})`
      : "";
  if (studentClause) parts.push(`and(parent_id.is.null,${studentClause})`);
  return parts.join(",");
}

/** Only attendance history may be read via linked student; other messages are recipient-private. */
function buildInboxOr(scope: NotificationScope) {
  const ownerOr = buildOwnerOr(scope);
  const child = scope.studentIds.length === 1
    ? `student_id.eq.${scope.studentIds[0]}`
    : scope.studentIds.length > 1
      ? `student_id.in.(${scope.studentIds.join(",")})`
      : "";
  return [ownerOr, child ? `and(${child},payload->>kind.eq.attendance)` : ""]
    .filter(Boolean).join(",");
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
      .select("id,title,body,severity,created_at,read_at,payload,student_id,institution_id,mark_id,session_id,parent_id")
      .eq("parent_id", user.id)
      .or(PARENT_NOTIFICATION_KIND_FILTER)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const { data: guardians, error: guardianError } = await srv.from("student_guardians").select("student_id").or(`parent_id.eq.${user.id},guardian_profile_id.eq.${user.id}`);
    if (guardianError) return NextResponse.json({ error: "Messages indisponibles." }, { status: 503 });
    try {
      const ownedIds = (guardians || []).map((g) => String(g.student_id));
      const allowedRows = (data || []).filter((row) => !row.student_id || ownedIds.includes(String(row.student_id)));
      const filtered = await filterParentConnectNotifications(srv, allowedRows, ownedIds);
      return NextResponse.json({ items: normalizeParentNotifications(filtered, Date.now(), [user.id]) });
    }
    catch { return NextResponse.json({ error: "Messages indisponibles." }, { status: 503 }); }
  }

  if (claims) {
    const { uid, sid } = claims;
    const { data, error } = await srv
      .from("notifications_queue")
      .select("id,title,body,severity,created_at,read_at,payload,student_id,institution_id,mark_id,session_id,parent_id")
      .or(buildInboxOr({ parentIds: [uid], studentIds: [sid] }))
      .or(PARENT_NOTIFICATION_KIND_FILTER)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    try {
      const allowedRows = (data || []).filter((row) => !row.student_id || String(row.student_id) === sid);
      const filtered = await filterParentConnectNotifications(srv, allowedRows, [sid]);
      return NextResponse.json({ items: normalizeParentNotifications(filtered, Date.now(), [uid]) });
    }
    catch { return NextResponse.json({ error: "Messages indisponibles." }, { status: 503 }); }
  }

  try {
    const scope = await resolveDeviceScope(req, srv);
    const ownerOr = scope ? buildOwnerOr(scope) : "";
    if (!ownerOr) return NextResponse.json({ items: [] });

    const { data, error } = await srv
      .from("notifications_queue")
      .select("id,title,body,severity,created_at,read_at,payload,student_id,institution_id,mark_id,session_id,parent_id")
      .or(buildInboxOr(scope!))
      .or(PARENT_NOTIFICATION_KIND_FILTER)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const ownedIds = scope?.studentIds || [];
    const allowedRows = (data || []).filter((row) => !row.student_id || ownedIds.includes(String(row.student_id)));
    const filtered = await filterParentConnectNotifications(srv, allowedRows, ownedIds);
    return NextResponse.json({ items: normalizeParentNotifications(filtered, Date.now(), scope?.parentIds || []) });
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
      .or(buildOwnerOr({ parentIds: [uid], studentIds: [sid] }))
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

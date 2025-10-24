// src/app/api/parent/notifications/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  const url = new URL(req.url);
  const unread = url.searchParams.get("unread") === "1";

  // Pagination
  const limit  = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit")  || "20", 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

  // Optionnel: filtrage temporel (ex: ?since=2025-10-20T00:00:00Z)
  const since = url.searchParams.get("since");

  let q = srv
    .from("notifications_queue")
    .select("id, payload, created_at, read_at", { count: "exact" })
    .eq("parent_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (unread) q = q.is("read_at", null);
  if (since)  q = q.gte("created_at", since);

  const { data, error, count } = await q;
  if (error) {
    return NextResponse.json({ items: [], error: error.message }, { status: 400 });
  }

  const items = (data || []).map((r: any) => ({
    id: r.id as string,
    title: r.payload?.title ?? "",
    body: r.payload?.body ?? "",
    severity: r.payload?.severity ?? "low",
    created_at: r.created_at as string,
    read_at: r.read_at as string | null,
    payload: r.payload ?? {},
  }));

  const total = count ?? 0;
  const has_more = offset + items.length < total;

  return NextResponse.json({
    items,
    total,
    has_more,
    next_offset: has_more ? offset + items.length : null,
  });
}

export async function PATCH(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];

  // Optionnel : marquer "toutes" comme lues si ids vide et all_unread=1
  const markAllUnread = !ids.length && (body?.all_unread === true || body?.all_unread === 1);

  if (!ids.length && !markAllUnread) {
    return NextResponse.json({ ok: true });
  }

  let q = srv
    .from("notifications_queue")
    .update({ read_at: new Date().toISOString() })
    .eq("parent_id", user.id);

  if (markAllUnread) {
    q = q.is("read_at", null);
  } else {
    q = q.in("id", ids);
  }

  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

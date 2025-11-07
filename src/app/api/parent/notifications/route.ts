//src/app/api/parent/notifications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { readParentSessionFromReq } from "@/lib/parent-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));
  const claims = user ? null : readParentSessionFromReq(req); // { uid, sid } | null

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
  const kindOr = "payload->>kind.eq.attendance,payload->>kind.eq.penalty";

  if (user) {
    // ── Mode A: profil parent Supabase (inchangé)
    const { data, error } = await supa
      .from("notifications_queue")
      .select("id,title,body,severity,created_at,read_at,payload")
      .eq("parent_id", user.id)
      .or(kindOr)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ items: data || [] });
  }

  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { uid, sid } = claims;

  // ── Mode B: session parent via cookie psess (filtre strict: parent_id=uid OU student_id=sid)
  const { data, error } = await srv
    .from("notifications_queue")
    .select("id,title,body,severity,created_at,read_at,payload")
    .or(`parent_id.eq.${uid},student_id.eq.${sid}`)
    .or(kindOr)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ items: data || [] });
}

export async function PATCH(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));
  const claims = user ? null : readParentSessionFromReq(req); // { uid, sid } | null

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return NextResponse.json({ ok: true, updated: 0 });

  const nowIso = new Date().toISOString();

  if (user) {
    // ── Mode A
    const { data, error } = await supa
      .from("notifications_queue")
      .update({ read_at: nowIso })
      .in("id", ids)
      .eq("parent_id", user.id)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, updated: data?.length || 0, read_at: nowIso });
  }

  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { uid, sid } = claims;

  // ── Mode B
  const { data, error } = await srv
    .from("notifications_queue")
    .update({ read_at: nowIso })
    .in("id", ids)
    .or(`parent_id.eq.${uid},student_id.eq.${sid}`)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, updated: data?.length || 0, read_at: nowIso });
}

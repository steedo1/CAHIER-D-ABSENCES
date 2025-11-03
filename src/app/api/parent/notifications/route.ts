// src/app/api/parent/notifications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

  // 👉 on prend attendance **et** penalty
  const orFilter = "payload->>kind.eq.attendance,payload->>kind.eq.penalty";

  const { data, error } = await supa
    .from("notifications_queue")
    .select("id,title,body,severity,created_at,read_at,payload")
    .eq("parent_id", user.id)
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ items: data || [] });
}

export async function PATCH(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return NextResponse.json({ ok: true, updated: 0 });

  const nowIso = new Date().toISOString();
  const { data, error } = await supa
    .from("notifications_queue")
    .update({ read_at: nowIso })
    .in("id", ids)
    .eq("parent_id", user.id)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, updated: data?.length || 0, read_at: nowIso });
}

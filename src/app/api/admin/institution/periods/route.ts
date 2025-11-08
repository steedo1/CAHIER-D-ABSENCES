import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = { user: { id: string }, instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

async function guard(supa: SupabaseClient, srv: SupabaseClient): Promise<GuardOk | GuardErr> {
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" };

  const { data: me } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (me?.institution_id as string) || null;
  let roleProfile = String(me?.role || "");

  if (!instId || !["admin","super_admin"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role, institution_id")
      .eq("profile_id", user.id);

    const adminRow = (urRows || []).find(r => ["admin","super_admin"].includes(String(r.role || "")));
    if (adminRow) {
      if (!instId && adminRow.institution_id) instId = String(adminRow.institution_id);
      roleProfile = roleProfile || String(adminRow.role || "");
    }
  }

  const isAdmin = ["admin","super_admin"].includes(roleProfile);
  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

export async function GET() {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const g = await guard(supa as unknown as SupabaseClient, srv as unknown as SupabaseClient);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

  const { data, error } = await srv
    .from("institution_periods")
    .select("id, weekday, period_no, label, start_time, end_time, duration_min")
    .eq("institution_id", g.instId)
    .order("weekday", { ascending: true })
    .order("period_no", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ periods: data ?? [] });
}

export async function PUT(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const g = await guard(supa as unknown as SupabaseClient, srv as unknown as SupabaseClient);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const input = Array.isArray(body?.periods) ? body.periods : [];
  // Attendu: { weekday:number 0..6, label:string, start_time:'HH:MM', end_time:'HH:MM' }[]

  if (input.length === 0) {
    const { error: delErr } = await srv
      .from("institution_periods")
      .delete()
      .eq("institution_id", g.instId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  const norm = input
    .map((p: any) => ({
      weekday: Math.min(6, Math.max(0, parseInt(p.weekday, 10) || 0)),
      label: String(p.label || "").trim() || "Séance",
      start_time: String(p.start_time || "08:00").slice(0, 5) + ":00",
      end_time: String(p.end_time || "09:00").slice(0, 5) + ":00",
    }))
    .sort((a: any, b: any) =>
      a.weekday - b.weekday || String(a.start_time).localeCompare(String(b.start_time))
    );

  let curDay = -1, idx = 0;
  const rows = norm.map((p: any) => {
    if (p.weekday !== curDay) { curDay = p.weekday; idx = 1; } else { idx += 1; }
    return { ...p, period_no: idx };
  });

  const { error: delErr } = await srv
    .from("institution_periods")
    .delete()
    .eq("institution_id", g.instId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

  const payload = rows.map((r: any) => ({
    institution_id: g.instId,
    weekday: r.weekday,
    period_no: r.period_no,
    label: r.label,
    start_time: r.start_time,
    end_time: r.end_time,
  }));

  const { error: insErr } = await srv.from("institution_periods").insert(payload);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, inserted: payload.length });
}

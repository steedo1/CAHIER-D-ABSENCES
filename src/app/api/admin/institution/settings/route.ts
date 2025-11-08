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

  // 1) Essai via profiles
  const { data: me } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (me?.institution_id as string) || null;
  let roleProfile = String(me?.role || "");

  // 2) Complément via user_roles (admin / super_admin), si besoin
  let roleFromUR: string | null = null;
  if (!instId || !["admin", "super_admin"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role, institution_id")
      .eq("profile_id", user.id);

    const adminRow = (urRows || []).find(r => ["admin", "super_admin"].includes(String(r.role || "")));
    if (adminRow) {
      roleFromUR = String(adminRow.role);
      if (!instId && adminRow.institution_id) instId = String(adminRow.institution_id);
    }
  }

  const isAdmin = ["admin", "super_admin"].includes(roleProfile) || ["admin","super_admin"].includes(String(roleFromUR || ""));
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
    .from("institutions")
    .select("tz, auto_lateness, default_session_minutes")
    .eq("id", g.instId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    tz: data?.tz ?? "Africa/Abidjan",
    auto_lateness: Boolean(data?.auto_lateness ?? true),
    default_session_minutes: Number(data?.default_session_minutes ?? 60),
  });
}

export async function PUT(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();
  const g = await guard(supa as unknown as SupabaseClient, srv as unknown as SupabaseClient);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const tz = String(body?.tz || "Africa/Abidjan").trim();
  const auto = !!body?.auto_lateness;
  const defMinRaw = Number(body?.default_session_minutes);
  const defMin = Number.isFinite(defMinRaw) && defMinRaw > 0 ? Math.floor(defMinRaw) : 60;

  const { error } = await srv
    .from("institutions")
    .update({ tz, auto_lateness: auto, default_session_minutes: defMin })
    .eq("id", g.instId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
